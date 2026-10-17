// Loaded only with ?debug in the address (index.html). Records what a real phone does, so it can be read on the
// preview machine: each touch gesture (its moves, whether the page took it, what the page then did), where the page
// came to rest after each scroll and where it settled a moment later, every resource fetched (from the page and from
// each scene), the videos' buffering, and the viewport's height. Posts batches to tools/serve.py's /__log.
(() => {
  const T0 = performance.now(), now = () => Math.round(performance.now() - T0);
  const sid = Math.random().toString(36).slice(2, 8);
  let queue = [];
  const log = (type, data) => queue.push({ sid, t: now(), type, ...data });
  const flush = () => {
    if (!queue.length) return;
    const body = queue.map(o => JSON.stringify(o)).join("\n");
    queue = [];
    fetch("/__log", { method: "POST", body, keepalive: body.length < 60000 }).catch(() => {});
  };
  setInterval(flush, 2000);
  addEventListener("pagehide", () => { const body = queue.map(o => JSON.stringify(o)).join("\n"); queue = []; if (body) navigator.sendBeacon("/__log", body); });

  const chapters = () => (window.MIRROR && MIRROR.chapters) || [];
  const where = () => {
    const sy = scrollY;
    for (const c of chapters()) {
      const top = c.el.getBoundingClientRect().top + sy, y = sy - top;
      if (y > -innerHeight && y < (c.pinLen || 0) + innerHeight)
        return { ch: c.el.id, y: Math.round(y), a: c.headLen ? +(y / c.headLen).toFixed(2) : null, pin: Math.round(c.pinLen || 0),
                 cur: c.cur, k: c.k, sel: !!c.selected, held: !!c.held, api: !!c.api };
    }
    return { ch: null, sy: Math.round(sy) };
  };
  log("start", { ua: navigator.userAgent, w: innerWidth, h: innerHeight, vv: visualViewport && Math.round(visualViewport.height),
                 dpr: devicePixelRatio, conn: navigator.connection && navigator.connection.effectiveType, cls: document.documentElement.className });

  // errors, the page's and its scenes'
  const onErr = (where_, e) => log("error", { in: where_, msg: String(e.message || e.reason || e), src: e.filename, line: e.lineno, stack: e.error && String(e.error.stack).slice(0, 600) });
  addEventListener("error", e => onErr("page", e), true);
  addEventListener("unhandledrejection", e => onErr("page", e));
  const hooked = new WeakSet();
  setInterval(() => { for (const f of document.querySelectorAll("iframe")) { try { const w = f.contentWindow; if (w && !hooked.has(w)) { hooked.add(w); w.addEventListener("error", e => onErr(f.getAttribute("src"), e), true); w.addEventListener("unhandledrejection", e => onErr(f.getAttribute("src"), e)); } } catch (e) {} } }, 500);
  const oldErr = console.error;
  console.error = (...a) => { log("console", { msg: a.map(String).join(" ").slice(0, 400) }); oldErr.apply(console, a); };

  // touch gestures
  let g = null;
  addEventListener("touchstart", e => {
    const t = e.touches[0], box = e.target.closest && e.target.closest(".ctl-box, .chapter, figure, section");
    g = { x: Math.round(t.clientX), y: Math.round(t.clientY), n: e.touches.length, on: box ? (box.closest("section") || box).id || box.className : null,
          sy0: Math.round(scrollY), at0: where(), moves: [], t0: now() };
  }, { capture: true, passive: true });
  addEventListener("touchmove", e => {
    if (!g) return;
    const t = e.touches[0];
    if (g.moves.length < 6 || g.moves.length % 5 === 0)
      g.moves.push([Math.round(t.clientX - g.x), Math.round(t.clientY - g.y), e.defaultPrevented ? 1 : 0, e.cancelable ? 1 : 0, now() - g.t0]);
    g.last = [Math.round(t.clientX - g.x), Math.round(t.clientY - g.y), e.defaultPrevented ? 1 : 0];
    g.nmoves = (g.nmoves || 0) + 1;
    g.prevented = (g.prevented || 0) + (e.defaultPrevented ? 1 : 0);
  }, { passive: true });   // (bubbling, after the page's own handlers: defaultPrevented is theirs)
  addEventListener("touchend", () => {
    if (!g) return;
    const s = g;
    g = null;
    s.dur = now() - s.t0;
    s.sy1 = Math.round(scrollY);
    setTimeout(() => { s.sy2 = Math.round(scrollY); s.at2 = where(); log("gesture", s); }, 700);
  }, { capture: true, passive: true });
  addEventListener("touchcancel", () => { if (g) { g.cancelled = true; log("gesture", g); g = null; } }, { capture: true, passive: true });

  // where the page rests after a scroll, and where it is a moment later (a snap or glide in between)
  let st = 0;
  addEventListener("scroll", () => {
    clearTimeout(st);
    st = setTimeout(() => {
      const a = where(), sy = Math.round(scrollY);
      setTimeout(() => { const b = where(); if (Math.round(scrollY) !== sy || b.ch !== a.ch) log("rest", { from: a, to: b, sy, sy2: Math.round(scrollY) }); else log("rest", { at: a, sy }); }, 1500);
    }, 250);
  }, { passive: true });

  // viewport height changes (toolbars)
  let lastH = innerHeight, lastVV = visualViewport && visualViewport.height;
  const vp = () => {
    const vv = visualViewport && visualViewport.height;
    if (innerHeight !== lastH || Math.abs((vv || 0) - (lastVV || 0)) > 1) { log("viewport", { h: innerHeight, vv: Math.round(vv), w: innerWidth, sy: Math.round(scrollY) }); lastH = innerHeight; lastVV = vv; }
  };
  addEventListener("resize", vp);
  visualViewport && visualViewport.addEventListener("resize", vp);

  // fetches: the page's, and each same-origin scene's
  const seen = new WeakMap();
  const docs = () => [window, ...[...document.querySelectorAll("iframe")].map(f => { try { return f.contentWindow; } catch (e) { return null; } }).filter(Boolean)];
  const pollFetches = () => {
    for (const w of docs()) {
      let perf; try { perf = w.performance; } catch (e) { continue; }
      if (!perf) continue;
      const n = seen.get(w) || 0, es = perf.getEntriesByType("resource");
      for (const e of es.slice(n)) {
        const name = e.name.replace(location.origin, "");
        if (name.includes("/__log")) continue;
        log("fetch", { doc: w === window ? "page" : (w.location.pathname.split("/").pop()), name, start: Math.round(e.startTime), dur: Math.round(e.duration),
                       kb: Math.round((e.transferSize || e.encodedBodySize || 0) / 1024), init: e.initiatorType, at: where().ch });
      }
      seen.set(w, es.length);
    }
  };
  // videos: how much each has buffered against where it plays
  const pollVideos = () => {
    const vids = [];
    for (const w of docs()) {
      let d; try { d = w.document; } catch (e) { continue; }
      for (const v of d.querySelectorAll("video")) {
        if (!v.currentSrc) continue;
        const b = v.buffered, end = b.length ? b.end(b.length - 1) : 0;
        vids.push([v.currentSrc.split("/").pop(), v.readyState, +v.currentTime.toFixed(1), +end.toFixed(1), +(v.duration || 0).toFixed(1), v.paused ? 0 : 1]);
      }
    }
    log("videos", { at: where(), v: vids,
                    ch: chapters().map(c => { const f = c.el.querySelector("iframe"); return [c.el.id, c.state || null, !!c.api, f ? (f.getAttribute("src") || "-") : null, c.shown]; }) });
  };
  // smoothness: frame intervals of the page's own frame loop, per 3 s
  let fr = [], fl = performance.now();
  const frame = t => { fr.push(t - fl); fl = t; requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  setInterval(() => {
    if (!fr.length) return;
    const s = fr.slice().sort((a, b) => a - b), q = p => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
    log("frames", { at: where().ch, n: fr.length, p50: q(.5), p95: q(.95), max: q(1), over50: fr.filter(x => x > 50).length });
    fr = [];
  }, 3000);

  // ?glasstest: stripes wherever the page is blank (glass toolbar shows them, a painted strip hides them), and on every
  // scroll stop Safari's own rule for that strip (WebKit LocalFrameView::fixedContainerEdges) run here, on the phone
  if (/[?&]glasstest\b/.test(location.search)) {
    document.head.appendChild(document.createElement("style")).textContent =
      "html,body{background:repeating-linear-gradient(45deg,#e33 0 14px,#36f 14px 28px) fixed !important}";
    const probe = (css) => { const d = document.body.appendChild(document.createElement("div"));
      d.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:" + css;
      const h = d.offsetHeight; d.remove(); return h; };
    const edge = () => {
      const pe = document.head.appendChild(document.createElement("style"));
      pe.textContent = "*{pointer-events:auto !important}";
      const vw = innerWidth, vh = innerHeight, x = vw / 2, y = vh - 4;
      const pinned = el => { for (let a = el; a && a.nodeType === 1; a = a.parentElement) { const p = getComputedStyle(a).position; if (p === "fixed" || p === "sticky") return true; } return false; };
      const all = document.elementsFromPoint(x, y), hit = all.find(pinned);
      pe.remove();
      const nm = a => a ? (a.id ? "#" + a.id : a.tagName.toLowerCase() + (a.classList[0] ? "." + a.classList[0] : "")) : null;
      let verdict = "glass";
      if (hit) for (let a = hit; a && a.nodeType === 1; a = a.parentElement) {
        const cs = getComputedStyle(a), p = cs.position;
        if (p !== "fixed" && p !== "sticky") continue;
        const r = a.getBoundingClientRect(), bg = !/rgba\(.*, 0\)$/.test(cs.backgroundColor) || cs.backgroundImage !== "none";
        if (cs.visibility === "hidden" || +cs.opacity < .1 || (!bg && cs.backdropFilter === "none" && !a.firstChild)) continue;
        const c = (l, v) => l < v * .9 ? "S" : l < v * 1.05 ? "M" : "L", w = c(r.width, vw), h = c(r.height, vh);
        if (w === "S") { if (h !== "S") { verdict = "strip:" + nm(a); break; } continue; }
        if (h === "L" || (w === "M" && h === "M" && parseInt(cs.zIndex) < 0)) continue;
        verdict = "strip:" + nm(a) + " " + cs.backgroundColor; break;
      }
      const sec = [...document.querySelectorAll("main > section, body > section, section[id]")].find(s => { const r = s.getBoundingClientRect(); return r.top <= vh / 2 && r.bottom > vh / 2; });
      log("glass", { section: nm(sec), verdict, top: nm(hit), under: all.slice(0, 3).map(nm), sy: Math.round(scrollY),
        inner: vh, svh: probe("100svh"), lvh: probe("100lvh"), dvh: probe("100dvh"), vv: visualViewport && Math.round(visualViewport.height), screen: screen.height });
    };
    // and every clip: visible text that runs past an ancestor that clips it (overflow, clip-path, contain), with both boxes
    const clips = () => {
      const nm = a => a.id ? "#" + a.id : a.tagName.toLowerCase() + (a.classList[0] ? "." + a.classList[0] : "");
      const box = r => [Math.round(r.top), Math.round(r.bottom)];
      const out = [];
      for (const el of document.querySelectorAll("h2, h3, h4, p, .eyebrow, figure")) {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!r.height || r.bottom < 0 || r.top > innerHeight + 200 || cs.visibility === "hidden") continue;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const c = getComputedStyle(a), q = a.getBoundingClientRect();
          const clipsY = c.overflowY !== "visible" || c.clipPath !== "none" || /paint|strict|content/.test(c.contain)
            || (c.maskImage || c.webkitMaskImage || "none") !== "none";
          if (clipsY && r.bottom > q.bottom + 1 && r.top < q.bottom) {
            out.push({ el: nm(el), elBox: box(r), by: nm(a), byBox: box(q), ov: c.overflowX + "/" + c.overflowY, clip: c.clipPath, contain: c.contain, mask: (c.maskImage || c.webkitMaskImage || "").slice(0, 60), h: c.height });
            break;
          }
        }
      }
      log("clips", { inner: innerHeight, sy: Math.round(scrollY), cut: out.slice(0, 8) });
    };
    let t; addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(() => { edge(); clips(); }, 250); }, { passive: true });
    addEventListener("load", () => setTimeout(edge, 500));
  }
  // each animation's first showing: "waited", the seconds its stage was on the screen before the scene showed (0: it was
  // ready before the reader got there), and meanwhile, once a second, what it waits for (its state; Chapter.seeking: the
  // scene's fonts, an image on show, a clip on show seeking or without its size; each clip as [name, readyState, seeking,
  // paused, priming, on show, currentTime])
  const shownOnce = new Set(), stageAt = new Map(), askedAt = new Map();
  const pollReveal = () => {
    for (const c of chapters()) {
      const id = c.el.id;
      if (c.inline || shownOnce.has(id)) continue;
      const up = c.stageO > .3;
      if (up && !stageAt.has(id)) stageAt.set(id, now());
      if (c.api && c.shown >= 1 && !c.swap) {
        shownOnce.add(id);
        log("reveal", { ch: id, waited: stageAt.has(id) ? +((now() - stageAt.get(id)) / 1000).toFixed(2) : 0, at: where().ch });
        continue;
      }
      if (!up || now() - (askedAt.get(id) || -1e9) < 1000) continue;
      askedAt.set(id, now());
      const w = c.swap || {};
      let d = null; try { d = c.iframe.contentDocument; } catch (e) {}
      const vids = d ? [...d.querySelectorAll("video")].filter(v => v.currentSrc).map(v => [v.currentSrc.split("/").pop(),
        v.readyState, v.seeking ? 1 : 0, v.paused ? 1 : 0, v.priming || v.starting ? 1 : 0, v.style.visibility === "hidden" ? 0 : 1, +v.currentTime.toFixed(2)]) : [];
      log("waiting", { ch: id, state: c.state, ready: w.at != null, on: +(w.on || 0).toFixed(2), fonts: d && d.fonts && d.fonts.status,
                       img: !!(c.api && c.api.waiting && c.api.waiting()), seeking: c.api ? c.seeking(w.first) : null,
                       frame: c.iframe.style.opacity, poster: c.poster && c.poster.style.opacity, vids });
    }
  };
  setInterval(pollFetches, 1000);
  setInterval(pollVideos, 3000);
  setInterval(pollReveal, 100);
})();
