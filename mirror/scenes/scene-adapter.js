// scene-adapter.js: lets the website drive a talk animation from its scroll position.
//
// Every animation page keeps its own timeline: STEPS (beats of tweens and video cues), stateAt(k, tau) and
// apply(st). In the deck, click s starts beat STOPS[s]; a chained beat hands over to the next one partway through
// and its own tweens and videos run on underneath. Here every click becomes one segment of a single continuous
// timeline (as the deck's mp4 export hook did), so the parent page can map scroll to a time T and render it:
//
//   SCENE.ready            -> Promise of { segs: [{ start, dur, names, beats }], total, w, h }
//   SCENE.render(T, ctx)   draws time T (seconds); ctx = { rate: dT/dt of the parent's clock, visible }
//   SCENE.pause()          stops every video (scene scrolled away)
//   SCENE.caption()        the title on screen, as HTML (shown outside the stage on narrow screens)
//   SCENE.setNarrow(b)     hides the in-stage titles
(function () {
  "use strict";
  if (!window.SCENE_SCROLL) return;   // opened on its own: the page steps on clicks and arrow keys, as in the deck
  const SEG_TAIL = 0.5;               // seconds of settled frame at the end of each segment
  const lim = (x, a, b) => Math.min(b, Math.max(a, x));

  // A slow connection: a scene's clips (intro's 17, basalt's 10 MB) don't all download the moment it opens, ahead of
  // what the reader needs first (its opening clips, the next scenes, the gallery's posters). Each loads once the
  // timeline is within a click of it (feed), or at once when a frame wants it (syncVideos).
  const LAZY = new Map();
  // A phone held upright gets the scene's smaller clips where it has them (window.CLIP_PHONE, the tag of the set
  // tools/build_scenes.py encodes at the size the clips are shown there): "_d.mp4" -> "_m.mp4". Tablets (short side
  // over 1400 device px) keep the desktop set.
  const PHONE = window.CLIP_PHONE && window.SCENE_PORTRAIT && Math.min(screen.width, screen.height) * devicePixelRatio <= 1400;
  const pick = src => PHONE && src ? src.replace(/_d\.mp4$/, window.CLIP_PHONE + ".mp4") : src;
  if (typeof SLOT_CLIPS !== "undefined") for (const v of document.querySelectorAll("video[src]")) {
    LAZY.set(v, pick(v.getAttribute("src")));
    v.removeAttribute("src");
    v.load();   // (stops the download it has started)
  }
  const fetchClip = v => { const src = v && LAZY.get(v); if (src) { LAZY.delete(v); v.src = src; } };

  // How each page hands a chained beat over (beat seconds after it starts) and what else it needs per frame.
  // Names inside these functions are the page's own globals.
  const PAGES = {
    intro: {
      // the deck waits 3 s after the data clips start before "Challenge"; here the clips have ended by 2.2 s, and the
      // reader is not left on a still frame for the rest
      handover: k => { const s = STEPS[k];
        return (HANDOVER[s.name] ? s.hold * HANDOVER[s.name] : Math.max(1.0, s.hold * .5))
          + ({ data: 2.2 }[s.name] ?? HANDOVER_DELAY[s.name] ?? 0) * SPEED; },
      chained: k => CHAIN.has(k), stops: () => STOPS, clock: true, videos: true,
      start: .011,   // the opening beat's 0.01 s fades: start on its settled first frame, not a blank one
      after: (st, want) => barsLive(want),
      // the video plan's node fades in holding the plan's first frame (it played as an empty dark square until the
      // clip started at 1.6 s, then popped in)
      setup: () => STEPS.find(s => s.name === "plan").cues.unshift(show("plan", "plan", .5, 0)),
      // ("But the transitions are still valid ..." now stays up through the whole "improve" click: the noise click
      // follows it, so the 1 s this used to add before "Training on its own rollouts ..." is no longer needed)
    },
    // every beat is its own click (the deck fuses them into two), so rewinding and skipping step through each title
    exploration: { handover: k => STEPS[k].hold, chained: () => false, stops: () => STEPS.map((s, i) => i) },
    dreamer: { handover: k => STEPS[k].hold, chained: () => false, stops: () => STEPS.map((s, i) => i),
               setup: () => { const t = document.getElementById("ptitle"); t.classList.add("title-static"); t.style.visibility = "visible"; } },
    basalt: {
      // the three demonstrations loop (wrap: frame = T mod the clip's length) rather than freeze on their last frame
      // for the rest of the click; unlike loop, wrap leaves the click's length (beatEnd) as it was
      setup: () => STEPS.forEach(s => (s.cues || []).forEach(c => { if (c.mode === "play" && /^demo\d$/.test(c.clip)) c.wrap = true; })),
      handover: k => { const s = STEPS[k];
        return Math.max(1.0, s.hold * (HANDOVER[s.name] ?? .5)) + (HANDOVER_DELAY[s.name] || 0) * SPEED; },
      chained: k => CHAIN.has(k), stops: () => STOPS, clock: true, videos: true,
      after: (st, want) => {
        const w = want.env;
        overlays(st, !w ? null : w.mode === "show" ? w.frame
          : lim(Math.floor(VIDS.env.ep5_pov.currentTime * FPS), 0, EP_FRAMES - 1));
      },
    },
    textcond: {
      handover: k => STEPS[k].name === "spawn" ? 0 : Math.max(1.0, STEPS[k].hold * .5),
      chained: k => CHAIN.has(k), stops: () => STOPS, clock: true,
      setup: () => frameStage("Mirror generalizes zero-shot through text conditioning"),
    },
    suites: {
      // "All methods learn from expert videos, ..." (10 words, plus the axes' labels) stays up 1.8 s longer before
      // "No prior method ..." replaces it; in the deck it gave way as soon as the expert lines had drawn
      handover: k => STEPS[k].hold * (HANDOVER[STEPS[k].name] ?? .5) + (STEPS[k].name === "axes" ? 1.8 * SPEED : 0),
      chained: k => chained(k), stops: () => stops(), clock: true, loops: true, ready: () => ready,
    },
  };

  // The text-conditioning page is the 1920x880 area under the deck's title: put it back in a 1920x1080 frame
  // with that title, like the other pages.
  function frameStage(title) {
    const stage = document.getElementById("stage"), frame = document.createElement("div");
    const t = document.createElement("div");
    t.className = "title title-static";
    t.style.cssText = "position:absolute;left:120px;top:58px;width:1680px;height:142px;display:flex;align-items:center;" +
      "font-family:'Source Sans 3','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:49px;line-height:1.08;" +
      "letter-spacing:-0.012em;color:#1c1b1a;white-space:nowrap";   // the theme's caption type (tools/theme.py)
    t.innerHTML = "<div>" + title + "</div>";
    if (window.PORTRAIT) { stage.append(t); return; }   // portrait: the stage is the whole frame; the title only feeds caption()
    frame.id = "frame";
    frame.style.cssText = "position:relative;width:1920px;height:1080px;flex:none;overflow:hidden;background:#f5f5f4";   // css/theme.css --bg-2
    stage.parentNode.insertBefore(frame, stage);
    frame.append(t, stage);
    Object.assign(stage.style, { position: "absolute", left: "0px", top: "200px" });
    const fitFrame = () => { stage.style.zoom = 1; frame.style.zoom = Math.min(innerWidth / 1920, innerHeight / 1080); };
    fitFrame();
    addEventListener("resize", fitFrame);
  }

  let P = null, SEGS = null, TOTAL = 0, lastT = null, resolveReady;
  const readyP = new Promise(r => { resolveReady = r; });

  // beat seconds after it starts at which every tween and (non-looping) video of beat k has finished
  function beatEnd(k) {
    let e = 0;
    for (const t of STEPS[k].tw) e = Math.max(e, t[3] + t[4]);
    for (const c of STEPS[k].cues || []) {
      e = Math.max(e, c.mode === "play" && !c.loop ? c.at + CLIPS[c.clip].frames / FPS / c.rate : c.at);
    }
    return e;
  }
  function buildSegments() {
    const segs = [];
    let G = 0;
    for (const b of P.stops()) {
      const beats = [];
      let k = b, start = 0;
      for (;;) {
        beats.push([k, start]);
        if (!P.chained(k) || k + 1 >= STEPS.length) break;
        start += P.handover(k) / SPEED;
        k++;
      }
      const end = Math.max(...beats.map(([kk, st]) => st + beatEnd(kk) / SPEED));
      segs.push({ beats, first: beats[0][0], start: G, dur: end + SEG_TAIL, names: beats.map(([kk]) => STEPS[kk].name) });
      G += end + SEG_TAIL;
    }
    SEGS = segs;
    TOTAL = G;
  }

  // ---------------------------------------------------------------- videos, synced to the timeline
  // Playing forward at a sane rate, a clip plays natively (with drift correction); otherwise it is paused and seeked
  // to the frame the timeline wants (scrubbing, rewinding, jumping).
  function syncVideos(want, ctx) {
    const playing = ctx.visible && ctx.rate > .45 && ctx.rate < 4.5;
    for (const slot in SLOT_CLIPS) {
      const w = want[slot];
      for (const clip in VIDS[slot]) {
        const v = VIDS[slot][clip], on = !!w && w.clip === clip;
        v.style.visibility = on ? "visible" : "hidden";
        if (!on && !v.paused) v.pause();
      }
      if (!w) continue;
      const v = VIDS[slot][w.clip], n = CLIPS[w.clip].frames, dur = n / FPS;
      fetchClip(v);
      let target, play = false, rate = 1;
      if (w.mode === "show") target = (w.frame + .5) / FPS;
      else {
        const wrap = w.loop || w.wrap, t = wrap ? ((w.t % dur) + dur) % dur : w.t;
        if (!wrap && t >= dur - .5 / FPS) target = (n - .5) / FPS;
        else { target = Math.max(t, 0); play = playing; rate = w.rate * SPEED * ctx.rate; }
      }
      if (play) {
        const r = lim(rate, .25, 8);
        if (Math.abs(v.playbackRate - r) > .02) v.playbackRate = r;
        if (v.paused) {
          if (Math.abs(v.currentTime - target) > .04) v.currentTime = target;
          v.play().catch(() => {});
        } else if (Math.abs(v.currentTime - target) > .25 * Math.max(1, r)) v.currentTime = target;
      } else {
        // iOS Safari decodes no frame of a paused video that hasn't played: a moment of playing makes it draw one
        if (v.readyState < 2 && !v.primed && v.currentSrc) {
          v.primed = v.priming = true;
          v.muted = true;
          v.play().then(() => { v.priming = false; v.pause(); }, () => { v.priming = false; });
        } else if (!v.paused && !v.priming) v.pause();
        if (!v.seeking && Math.abs(v.currentTime - target) > .6 / FPS) v.currentTime = target;
      }
    }
  }
  // with reduced motion the looping clips (suites) hold still on their first frame
  const STILL = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function loopVideos(on) {
    for (const v of document.querySelectorAll("video")) {
      if (STILL) { v.autoplay = false; if (!v.paused) v.pause(); continue; }
      if (on && v.paused) v.play().catch(() => {});
      else if (!on && !v.paused) v.pause();
    }
  }

  // every clip cued up to the end of the click after s (slotsAt carries a clip on through the later beats)
  let fed = -1;
  function feed(s) {
    if (!LAZY.size || s <= fed) return;
    fed = s;
    const last = SEGS[Math.min(s + 1, SEGS.length - 1)].beats.slice(-1)[0][0];
    for (let k = 0; k <= last; k++) for (const c of STEPS[k].cues || []) fetchClip(VIDS[c.slot] && VIDS[c.slot][c.clip]);
  }

  // ---------------------------------------------------------------- render
  function segAt(T) {
    let s = 0;
    while (s < SEGS.length - 1 && T >= SEGS[s + 1].start) s++;
    return s;
  }
  let lastState = null;
  function render(T, ctx = { rate: 0, visible: true }) {
    if (!SEGS) return;
    T = lim(T, 0, TOTAL);
    const s = segAt(T), sg = SEGS[s];
    feed(s);
    let t = T - sg.start;
    if (s === 0 && P.start) t = Math.max(t, P.start);
    let k = sg.first, tau = 0;
    for (const [kk, st] of sg.beats) if (t >= st) { k = kk; tau = (t - st) * SPEED; }
    if (P.clock) {
      // the page's tauOf(i) reads (now - BT[i]) / 1000 * SPEED for earlier beats of a running chain
      const now = performance.now();
      BT = [];
      for (const [kk, st] of sg.beats) if (kk < k) BT[kk] = now - (t - st) * 1000;
    }
    if (T !== lastT) {
      lastState = stateAt(k, tau);
      apply(lastState);
      lastT = T;
    }
    let want = null;
    if (P.videos) {
      want = slotsAt(k, tau);
      syncVideos(want, ctx);
      if (P.after) P.after(lastState, want);
    }
    window.SCENE.last = { T, s, k, tau, want };   // for debugging from the parent's console
    if (P.loops) loopVideos(ctx.visible);
  }
  function pause() {
    for (const v of document.querySelectorAll("video")) if (!v.paused) v.pause();
  }

  // ---------------------------------------------------------------- captions (narrow screens)
  let TITLES = null, CALLOUTS = null;
  function mostVisible(els) {
    let best = null, bo = .02;
    for (const el of els) {
      if (el.style.visibility === "hidden") continue;
      const o = el.classList.contains("title-static") ? 1 : parseFloat(el.style.opacity || "0");
      if (o > bo) { best = el; bo = o; }
    }
    return best;
  }
  const inner = el => (el.firstElementChild && el.firstElementChild.tagName === "DIV" ? el.firstElementChild : el).innerHTML.trim();
  const opacity = el => el.classList.contains("title-static") ? 1 : lim(parseFloat(el.style.opacity || "0"), 0, 1);
  // A cross-fade can leave every title (or every note) under the cutoff for a moment of T. Through such a gap, up to
  // GAP seconds of scene time, the last one seen stays, at its own (faint) opacity, so the page's caption never blanks
  // for a frame, whichever way T is moving (a jump further than GAP still finds no caption where there is none).
  const GAP = .35;
  let seenT = null, seenC = null;
  function caption() {
    if (!TITLES) {
      TITLES = [...document.querySelectorAll(".title, #ptitle")];
      CALLOUTS = [...document.querySelectorAll(".callout")];   // the Dreamer chart's notes beside its title
    }
    const T = lastT ?? 0;
    let t = mostVisible(TITLES), c = mostVisible(CALLOUTS);
    if (t) seenT = { el: t, T }; else if (seenT && Math.abs(T - seenT.T) < GAP) t = seenT.el;
    if (c) seenC = { el: c, T }; else if (seenC && Math.abs(T - seenC.T) < GAP) c = seenC.el;
    if (!t) return null;
    // o, so: how visible the title and the note are in the scene, so the page's caption fades with them
    return { html: inner(t), o: opacity(t), sub: c ? inner(c).replace(/<br\s*\/?>/g, " ") : null,
             subColor: c ? c.style.color : null, so: c ? opacity(c) : 0 };   // the note keeps its colour from the chart
  }
  // every title the scene can show, and every note beside one: the page sizes its caption block for the longest
  function captions() {
    caption();
    return { titles: TITLES.map(inner), subs: CALLOUTS.map(el => inner(el).replace(/<br\s*\/?>/g, " ")) };
  }

  window.SceneAdapter = {
    init(name) {
      P = PAGES[name];
      if (!P) { console.error("scene-adapter: unknown page", name); return; }
      const loaded = new Promise(r => document.readyState === "complete" ? r() : addEventListener("load", r, { once: true }));
      Promise.all([loaded, document.fonts.ready, P.ready ? P.ready() : null])
        .then(() => new Promise(r => setTimeout(r, 0)))          // let the page's own boot run first
        .then(() => document.fonts.ready)
        .then(() => {
          if (P.setup) P.setup();
          if (typeof fitTitles === "function") fitTitles();
          buildSegments();
          lastT = null;
          render(0, { rate: 0, visible: false });
          // the frame the page should give it: the deck's 16:9, or the tall stage of a portrait layout
          const PT = window.PORTRAIT;
          // beats: when each of the click's beats starts (seconds into it). The deck chains some beats into one click; the
          // page lets a tap step through them one at a time, as the animation's original clicks.
          resolveReady({ name, segs: SEGS.map(s => ({ start: s.start, dur: s.dur, names: s.names, beats: s.beats.map(b => b[1]) })),
                         total: TOTAL,
                         w: PT ? PT.W : 1920, h: PT ? PT.H : 1080, fill: PT && PT.FILL || null });
        })
        .catch(e => { console.error(e); resolveReady(null); });
    },
  };
  window.SCENE = {
    ready: readyP,
    render, pause, caption, captions,
    setNarrow: b => document.documentElement.classList.toggle("narrow", !!b),
    get total() { return TOTAL; },
  };
})();
