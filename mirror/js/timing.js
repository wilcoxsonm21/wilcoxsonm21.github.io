// ?timing: set when each click of the animations moves on, by hand, and try it out (loaded by js/site.js).
//
// Record: the animation holds its opening until you tap it (or press →, or the panel's Start); that wait is how long
//   its opening holds once it is in focus (data-wait). Then each click plays and holds until you tap the animation (or press →, or the panel's Next); that moment is
//   its dwell, in seconds from the click's start. A tap while it is still playing starts the next click at once, and
//   the click's own videos and moves play on under it (a dwell shorter than the click; scenes whose beats keep their own
//   clocks only: elsewhere it moves on as soon as the click has played).
// Test: the page plays with your dwells (a click you haven't set keeps the site's timing).
// Site: the page's own timing (READ_WPS and data-read, or data-dwell where set).
// "Split beats" (per chapter; the intro's is on to start with) makes each beat of the scene's chained clicks a step of its
// own, so the changes the scene used to play straight through can be timed too (data-beats; scene-adapter.js ?beats).
// The dwells are kept in localStorage, and sent to the preview server's /__log (tools/serve.py) as you go. "Copy" gives
// each chapter's data-dwell for index.html, which bakes them in (Chapter.dwellAt in js/site.js).
(() => {
  const KEY = "mirror.timing.v1";
  let st = {};
  try { st = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
  st = Object.assign({ mode: "record", rec: {}, wait: {}, site: {}, beats: { intro: true }, open: true }, st);
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
    clearTimeout(save.t);
    save.t = setTimeout(() => {
      fetch("/__log", {
        method: "POST", body: JSON.stringify({ type: "timing", at: new Date().toISOString(), rec: st.rec, wait: st.wait, site: st.site }),
      }).catch(() => {});
    }, 800);
  };
  const go = new Map();   // chapter -> the click the reader asked to leave (Record)
  // (times are kept per layout: split into beats or not)
  const split = c => !c.inline && (st.beats[c.el.dataset.scene] ?? c.el.hasAttribute("data-beats"));
  const name = c => c.el.dataset.scene + (split(c) ? "+beats" : "");
  const r2 = x => Math.round(x * 100) / 100;
  const chapters = () => (window.MIRROR || {}).chapters || [];
  let last = null;        // the chapter last played

  window.MIRROR_TIMING = {
    beats: split,
    // the dwell of click k (seconds from its start), or null for the site's reading rule
    dwell(c, k) {
      if (st.mode === "record") return go.get(c) === k ? -Infinity : Infinity;
      if (st.mode === "test") { const r = st.rec[name(c)]; if (r && r[k] != null) return r[k]; }
      return c.dwell[k] ?? null;
    },
    recording: () => st.mode === "record",
    // the dwell that cuts click k short, starting the next one over its end (Chapter.retime): recording, only the clicks
    // before the one on screen keep theirs
    cut(c, k) {
      const r = st.rec[name(c)] || [];
      if (st.mode === "record") return k < c.k ? r[k] ?? null : null;
      if (st.mode === "test" && r[k] != null) return r[k];
      return c.dwell[k] ?? null;
    },
    // how long the opening holds before the first click plays, or null to play at once
    wait(c) {
      if (st.mode === "record") return go.get(c) === "start" ? 0 : Infinity;
      // (the recorded waits aren't played back: they caught the reaction to the stage settling, 10-17; the opening plays
      // at once, as on the site, unless the chapter has a data-wait)
      return c.wait;
    },
    started(c, t) {
      if (st.mode !== "record") return;
      st.wait[name(c)] = r2(t);
      go.delete(c);
      save();
    },
    // the reader asks for the next click, or to start (Record only; on the last click a tap pauses as usual)
    next(c) {
      const r = ask(c);
      // (each tap goes to the preview server's log, with what it did: false is a pause)
      const g = c.segs[c.k] || {};
      fetch("/__log", { method: "POST", body: JSON.stringify({ type: "timing-tap", at: new Date().toISOString(), mode: st.mode,
        scene: name(c), k: c.k, n: c.segs.length, T: r2(c.T), end: r2((g.start || 0) + (g.dur || 0)), opening: c.opening,
        ended: c.ended, held: c.held, overlaps: !!c.api?.overlaps?.(), result: r }) }).catch(() => {});
      return r;
    },
  };
  function ask(c) {
    {   // (Record only)
      if (st.mode !== "record" || c.ended) return false;
      if (c.opening) { go.set(c, "start"); return true; }
      if (c.k >= c.segs.length - 1) return false;
      const g = c.segs[c.k];
      if (c.T < g.start + g.dur - .02 && c.api?.overlaps?.()) return "cut";
      go.set(c, c.k);
      return true;
    }
  }
  Object.assign(window.MIRROR_TIMING, {
    // click k moved on after t seconds; the site's timing would have taken site
    advanced(c, k, t, site) {
      const n = name(c);
      (st.site[n] = st.site[n] || [])[k] = r2(site);
      if (st.mode === "record") { (st.rec[n] = st.rec[n] || [])[k] = r2(t); go.delete(c); }
      save();
    },
  });

  // ------------------------------------------------------------------ the panel
  const css = document.createElement("style");
  css.textContent = `
  .tm { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; width: 290px; max-height: calc(100vh - 24px);
        overflow: auto; background: rgba(20, 19, 18, .92); color: #f4f2ee; border-radius: 14px; padding: 12px 14px;
        font: 13px/1.35 "Source Sans 3", system-ui, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.3);
        -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
  .tm.shut { width: auto; padding: 8px 12px; }
  .tm.shut > :not(.tm-top) { display: none; }
  .tm-top { display: flex; align-items: center; gap: 8px; }
  .tm-top b { font-weight: 700; flex: 1; }
  .tm button { font: inherit; color: inherit; background: rgba(255,255,255,.12); border: 0; border-radius: 8px;
               padding: 4px 9px; cursor: pointer; }
  .tm button:hover { background: rgba(255,255,255,.2); }
  .tm-seg { display: flex; gap: 2px; background: rgba(255,255,255,.1); border-radius: 9px; padding: 2px; margin: 10px 0 6px; }
  .tm-seg button { flex: 1; background: none; }
  .tm-seg button.on { background: #f4f2ee; color: #1c1b1a; font-weight: 600; }
  .tm-note { color: #b5b1aa; font-size: 12px; margin-bottom: 8px; }
  .tm-now { display: flex; justify-content: space-between; align-items: baseline; margin: 6px 0 4px; }
  .tm-now .w { color: #ffd25c; font-variant-numeric: tabular-nums; }
  .tm-next { width: 100%; padding: 9px !important; margin: 4px 0 8px; background: #ffd25c !important; color: #1c1b1a !important;
             font-weight: 700 !important; }
  .tm-next[disabled] { opacity: .35; cursor: default; }
  .tm table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .tm th { font-weight: 600; color: #b5b1aa; text-align: right; padding: 2px 4px; }
  .tm td { text-align: right; padding: 2px 4px; }
  .tm th:first-child, .tm td:first-child { text-align: left; }
  .tm tr.cur td { background: rgba(255, 210, 92, .16); }
  .tm td.mine { color: #ffd25c; }
  .tm td.off { color: #77736d; }
  .tm-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .tm-split { display: flex; gap: 6px; align-items: center; font-size: 12px; margin: 0 0 8px; cursor: pointer; }
  .tm-split.na { display: none; }
  .tm-msg { color: #8fd6a8; font-size: 12px; min-height: 1em; margin-top: 6px; }`;
  document.head.append(css);

  const el = document.createElement("div");
  el.className = "tm" + (st.open ? "" : " shut");
  el.innerHTML = `
    <div class="tm-top"><b>Timing</b><button data-a="fold" title="Fold">${st.open ? "–" : "+"}</button></div>
    <div class="tm-seg">
      <button data-mode="record">Record</button><button data-mode="test">Test</button><button data-mode="site">Site</button>
    </div>
    <div class="tm-note"></div>
    <div class="tm-now"><span class="c"></span><span class="w"></span></div>
    <button class="tm-next" data-a="next">Next step &nbsp;→</button>
    <label class="tm-split" title="Each change the animation plays straight through gets its own step"><input type="checkbox"> Split into beats</label>
    <table><thead><tr><th>Step</th><th>Yours</th><th>Site</th></tr></thead><tbody></tbody></table>
    <div class="tm-row">
      <button data-a="replay">Replay chapter</button><button data-a="clear">Clear chapter</button>
      <button data-a="copy">Copy</button><button data-a="clearall">Clear all</button>
    </div>
    <div class="tm-msg"></div>`;
  document.body.append(el);
  const $ = s => el.querySelector(s);
  const NOTES = {
    record: "The animation waits for you to start it; then each step plays and waits for you. Tap the animation, press →, or the button below. Tap while a step plays and the next starts right away, over its end.",
    test: "Plays your times. Steps you haven't recorded keep the site's.",
    site: "The site's own timing, as published.",
  };
  let msgT = 0;
  const msg = t => { $(".tm-msg").textContent = t; clearTimeout(msgT); msgT = setTimeout(() => { $(".tm-msg").textContent = ""; }, 4000); };

  // the chapter in view: the one playing, else the one whose stage is most forward
  function current() {
    const cs = chapters();
    const live = cs.find(c => c.live);
    if (live) return (last = live);
    const best = cs.filter(c => c.stageO > .5).sort((a, b) => b.stageO - a.stageO)[0];
    return best || last;
  }
  const fmt = x => x == null ? "–" : x.toFixed(1);

  let shown = "";
  function draw() {
    for (const b of el.querySelectorAll("[data-mode]")) b.classList.toggle("on", b.dataset.mode === st.mode);
    $(".tm-note").textContent = NOTES[st.mode];
    const c = current();
    if (!c) { $(".tm-now .c").textContent = "Scroll to an animation"; $(".tm-now .w").textContent = ""; return; }
    const n = name(c), nk = c.segs.length, k = Math.max(0, c.cur);
    const inStep = Math.max(0, c.clock - c.curAt);
    const waiting = st.mode === "record" && !c.ended && k < nk - 1 && c.T >= c.segs[k].start + c.segs[k].dur - 1e-3;
    const where = c.opening ? "opening" : `step ${k + 1} of ${nk}`;
    $(".tm-now .c").textContent = `${c.el.id || n} · ${where}${c.ended ? " (ended)" : c.held ? " (paused)" : ""}`;
    $(".tm-now .w").textContent = c.ended ? "" : c.opening ? `${c.waited.toFixed(1)} s${st.mode === "record" ? " · waiting" : ""}`
      : `${inStep.toFixed(1)} s${go.get(c) === c.k ? " · next" : waiting ? " · waiting" : ""}`;
    $(".tm-split").classList.toggle("na", c.inline);
    $(".tm-split input").checked = split(c);
    const nb = $(".tm-next");
    nb.disabled = st.mode !== "record" || c.ended || !c.opening && c.k >= nk - 1;
    const label = c.opening ? "Start &nbsp;▸" : "Next step &nbsp;→";
    if (nb.dataset.l !== label) { nb.dataset.l = label; nb.innerHTML = label; }
    const rec = st.rec[n] || [], site = st.site[n] || [], wt = st.wait[n];
    const key = [n, k, c.opening, st.mode, wt, JSON.stringify(rec), JSON.stringify(site)].join("|");
    if (key === shown) return;
    shown = key;
    // (the last click has no dwell: the chapter ends on it)
    $(".tm tbody").innerHTML = `<tr class="${c.opening ? "cur" : ""}"><td>Start</td><td class="${wt != null ? "mine" : ""}">${fmt(wt)}</td>` +
      `<td class="${st.mode === "test" && wt != null ? "off" : ""}">${fmt(c.wait ?? 0)}</td></tr>` +
      Array.from({ length: nk - 1 }, (_, i) => {
      const used = st.mode === "test" && rec[i] != null;
      return `<tr class="${i === k && !c.opening ? "cur" : ""}"><td>${i + 1} → ${i + 2}</td>` +
        `<td class="${rec[i] != null ? "mine" : ""}">${fmt(rec[i])}</td>` +
        `<td class="${used ? "off" : ""}">${fmt(c.dwell[i] ?? site[i])}</td></tr>`;
    }).join("");
  }
  setInterval(draw, 100);

  // splitting a chapter into beats, or joining them again, reloads its scene in that layout from its start
  $(".tm-split input").addEventListener("change", e => {
    e.target.blur();
    const c = current();
    if (!c || c.inline) return;
    st.beats[c.el.dataset.scene] = e.target.checked;
    save();
    relayer(c);
  });
  function relayer(c) {
    go.delete(c);
    c.reset();
    Object.assign(c, { T: 0, k: 0, cur: -1, doneAt: null, ended: false, held: false });
    shown = "";
  }
  // (a scene that loaded before this file did, in the other layout)
  for (const c of chapters()) if (!c.inline && c.state !== "idle" && !!c.split !== split(c)) relayer(c);
  el.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    b.blur();   // (Space or Enter would press it again; the arrows go to the animation)
    const c = current();
    if (b.dataset.mode) {
      st.mode = b.dataset.mode;
      go.clear();
      save();
      // the clicks are cut for the new mode's dwells, and the one on screen starts its dwell over
      for (const x of chapters()) x.retime();
      if (c && !c.ended) c.goto(c.k);
    } else if (b.dataset.a === "fold") {
      st.open = !st.open;
      el.classList.toggle("shut", !st.open);
      b.textContent = st.open ? "–" : "+";
      save();
    } else if (b.dataset.a === "next") {
      if (c) c.step(1);
    } else if (b.dataset.a === "replay") {
      if (c) { go.delete(c); c.goto(0); }
    } else if (b.dataset.a === "clear") {
      if (c && confirm(`Clear your times for ${c.el.id || name(c)}?`)) { delete st.rec[name(c)]; delete st.wait[name(c)]; save(); }
    } else if (b.dataset.a === "clearall") {
      if (confirm("Clear all your times?")) { st.rec = {}; st.wait = {}; save(); }
    } else if (b.dataset.a === "copy") {
      // (split into beats, the chapter also needs data-beats, and data-segs for its new steps so the page doesn't jump)
      const lines = chapters().filter(c => st.rec[name(c)] || st.wait[name(c)] != null).map(c => {
        const r = st.rec[name(c)] || [], nk = c.segs.length - 1, wt = st.wait[name(c)];
        const dw = `data-dwell="${Array.from({ length: nk }, (_, i) => r[i] == null ? "" : r[i].toFixed(2)).join(",")}"`;
        const sp = split(c) ? ` data-beats data-segs="${c.segs.map(g => g.dur.toFixed(2)).join(",")}"` : "";
        return `${(c.el.id || name(c)).padEnd(12)}${sp}${wt != null ? ` data-wait="${wt.toFixed(2)}"` : ""} ${dw}`;
      });
      const text = lines.length ? lines.join("\n") : "(nothing recorded yet)";
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
        () => msg("Copied. Paste it to Claude to bake in."), () => { prompt("Copy:", text); });
    }
  });
  draw();
})();
