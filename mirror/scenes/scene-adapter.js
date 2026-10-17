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
//   SCENE.more()           the page shows the scene's opening: fetch the rest of its images
//   SCENE.pending()        how many clips and images its frame needs and hasn't got (not what it fetches ahead); it
//                          also starts the next clip of its queue (pump)
//   SCENE.waiting()        an image the frame on screen shows is still loading
//   SCENE.park(), resume() the clips on their way give way to other downloads, and go on (parked(): how many)
//   SCENE.busy()           something is on its way
//   SCENE.unlock()         within the reader's tap: lets clips Low Power Mode refused play (true if it did)
(function () {
  "use strict";
  if (!window.SCENE_SCROLL) {         // opened on its own: the page steps on clicks and arrow keys, as in the deck
    document.querySelectorAll("img[data-src]").forEach(im => { im.src = im.dataset.src; });
    return;
  }
  const SEG_TAIL = 0.5;               // seconds of settled frame at the end of each segment
  const PENDING_MAX = 6;              // seconds a clip or image counts as pending, at most (pending)
  const lim = (x, a, b) => Math.min(b, Math.max(a, x));

  // A slow connection: a scene's clips (intro's 17, basalt's 10 MB) don't all download the moment it opens, ahead of
  // what the reader needs first (its opening clips, the next scenes, the gallery's posters). Each loads once the
  // timeline is within a click of it (feed), one at a time in the timeline's order (pump), or at once when a frame
  // wants it (syncVideos).
  const LAZY = new Map();
  // A phone held upright gets the scene's smaller clips where it has them (window.CLIP_PHONE, the tag of the set
  // tools/build_scenes.py encodes at the size the clips are shown there): "_d.mp4" -> "_m.mp4". Tablets (short side
  // over 1400 device px) keep the desktop set.
  const PHONE = window.CLIP_PHONE && window.SCENE_PORTRAIT && Math.min(screen.width, screen.height) * devicePixelRatio <= 1400;
  const pick = src => PHONE && src ? src.replace(/_d\.mp4$/, window.CLIP_PHONE + ".mp4") : src;
  if (typeof SLOT_CLIPS !== "undefined") for (const v of document.querySelectorAll("video[src]")) {
    LAZY.set(v, pick(v.getAttribute("src")));
    v.removeAttribute("src");
    v.load();   // (stops the download it has started; in scroll mode the scenes make their clips with preload none)
  }
  // What the frame on screen needs and hasn't got yet (pending): the page holds the next scene's load until it is in
  // (js/site.js), so on a slow connection a scene further down doesn't share the line with this scene's opening or the
  // click it is playing. What is fetched ahead (the next click's clips, the later clicks' images) doesn't hold it. Each
  // counts for PENDING_MAX at most: a phone that fetches only a clip's metadata until it plays would never finish it.
  const asked = new Map();   // clip or image -> when it was asked for
  const fetchClip = (v, ahead) => {
    const src = v && LAZY.get(v);
    if (!src) return;
    LAZY.delete(v);
    if (drawing && drawing.ok) {
      drawing.clips.set(v, new SceneDraw.Clip(src));
      if (!ahead) asked.set(v, performance.now());
      return;
    }
    // (from 0: the deck shows its opening frame, (frame + .5) / FPS, before the clip has its file, and a time set then is
    // kept as the clip's start and seeked to once the file comes, through a load() too. On an iPhone that seek, on a clip
    // that hadn't played, never finished while its first play() waited: the intro sat behind its poster until the page
    // gave up on it, every visit. The timeline seeks it where it wants once it can (seekable).)
    v.currentTime = 0;
    v.preload = "auto";
    v.src = src;
    if (!ahead) asked.set(v, performance.now());
  };
  for (const v of document.querySelectorAll("video[src]")) asked.set(v, performance.now());   // (a scene's own: suites)
  // A clip is in: its file has arrived, or as much of it as the browser fetches ahead (its download is idle). iOS Safari
  // doesn't say so the usual way: a clip that hasn't played stays at readyState 1, with nothing buffered and its download
  // "loading", however much it has fetched; its resource timing entries do (one per range it asked for; the first, a
  // 2-byte probe, doesn't count). On an iPhone every clip used to count as on its way for PENDING_MAX.
  const clipIn = v => drawing && drawing.clips.has(v) ? drawing.clips.get(v).state !== "loading"
    : !!v.error || v.readyState >= 4 || v.networkState === HTMLMediaElement.NETWORK_IDLE
    || !!v.currentSrc && performance.getEntriesByName(v.currentSrc).some(e => (e.encodedBodySize || e.transferSize || 0) > 1000);
  // The clips the timeline will want load one at a time, in its order (feed), so a click's first clip isn't sharing the
  // line with its later ones (intro's opening clip took 1.5 s at 700 kbps beside its two big ones, against 0.4 s alone):
  // the next starts once the one before it is in, or after CLIP_GAP seconds. A clip a frame wants starts at once
  // (syncVideos), and those of the next click wait until this one's are in (pending).
  const CLIP_GAP = 2;
  const clipQ = [];          // [clip, the beat that first cues it], in the timeline's order
  let needTo = -1;           // beats up to this one are the click being played's (feed): their clips are needed now
  let flight = null, flightAt = 0;   // the clip the queue last started, and when
  function pump() {
    // (one is on its way: the one it started last, or one a frame asked for)
    const now = performance.now();
    if (flight && !clipIn(flight) && now - flightAt < CLIP_GAP * 1e3) return;
    for (const [el, at] of asked) if (el.tagName === "VIDEO" && !clipIn(el) && now - at < CLIP_GAP * 1e3) return;
    flight = null;
    while (clipQ.length && !LAZY.has(clipQ[0][0])) clipQ.shift();   // (asked for already, by a frame)
    if (!clipQ.length) return;
    const [v, k] = clipQ[0], ahead = k > needTo;
    if (ahead && need() > 0) return;
    clipQ.shift();
    fetchClip(v, ahead);
    flight = v;
    flightAt = performance.now();
  }
  // The scene's images wait too (data-src in scroll mode, tools/build_scenes.py), so its opening doesn't wait for what
  // its later clicks show: each loads as soon as a frame shows it (showImages), and the rest once the page has shown
  // the scene's opening (SCENE.more).
  const LAZY_IMG = [...document.querySelectorAll("img[data-src]")];
  const onShow = new Set();  // images a frame showed before they had loaded (waiting)
  function fetchImg(im, ahead) {
    const i = LAZY_IMG.indexOf(im);
    if (i < 0) return;
    LAZY_IMG.splice(i, 1);
    im.src = im.dataset.src;
    if (!ahead) asked.set(im, performance.now());
  }
  const shows = el => {
    if (!el.getClientRects().length || getComputedStyle(el).visibility === "hidden") return false;
    for (let e = el; e && e !== document.body; e = e.parentElement) if (+getComputedStyle(e).opacity < .01) return false;
    return true;
  };
  function showImages() {
    for (const im of [...LAZY_IMG]) if (shows(im)) { fetchImg(im); onShow.add(im); }
  }
  // (need: the count, with the click's clips still waiting their turn in the queue; pending also starts the next one,
  // as the page asks it every frame or so, whether or not the scene is on the screen and drawing)
  function need() {
    const now = performance.now();
    for (const [el, at] of asked) {
      const busy = el.tagName === "IMG" ? !el.complete : !clipIn(el);
      if (!busy || now - at > PENDING_MAX * 1e3) asked.delete(el);
    }
    return asked.size + clipQ.filter(([v, k]) => k <= needTo && LAZY.has(v)).length;
  }
  function pending() {
    pump();
    return need();
  }
  // What is fetched ahead waits until what the frame needs is in (pending), so the two never share the line
  const aheadQ = [];
  function fetchAhead() {
    if (aheadQ.length && need() === 0) for (const f of aheadQ.splice(0)) f();
  }
  function more() {
    for (const im of LAZY_IMG) aheadQ.push(() => fetchImg(im, true));
    fetchAhead();
  }
  // The reader has scrolled past the scene (js/site.js): the clips still on their way give way to what the reader is
  // on and coming to (park), and pick up again once that is in, or as soon as the reader is back (resume). The page
  // decides when; the browser keeps what they had (HTTP ranges), so they go on from there.
  const PARKED = new Map(), CUED = new Set(LAZY.keys());   // (CUED: the clips the timeline asks for itself)
  const RESUME = new Set();
  function park() {
    if (drawing) return;
    for (const v of document.querySelectorAll("video[src]")) {
      if (clipIn(v)) continue;
      const src = v.getAttribute("src");
      v.removeAttribute("src");
      v.load();
      asked.delete(v);
      if (CUED.has(v)) { LAZY.set(v, src); RESUME.add(v); } else PARKED.set(v, src);
    }
    fed = -1;
    aheadQ.length = clipQ.length = 0;   // (fed again when the reader is back)
    flight = null;
  }
  function resume() {
    if (drawing) return;
    for (const v of RESUME) fetchClip(v, true);
    RESUME.clear();
    for (const [v, src] of PARKED) v.src = src;
    PARKED.clear();
  }
  const parked = () => RESUME.size + PARKED.size;
  // something is on its way: a clip or an image, or what the frame on screen fetches ahead next (on an iPhone a clip that
  // hadn't played kept this true for good, and what had given way while the reader was on the scene never went on)
  const busy = () => aheadQ.length > 0 || clipQ.some(([v]) => LAZY.has(v))
    || [...document.querySelectorAll("video[src]")].some(v => !clipIn(v))
    || [...document.images].some(im => im.getAttribute("src") && !im.complete);
  function waiting() {
    for (const im of onShow) if (im.complete) onShow.delete(im);
    // (and while drawing, a slot on show that has drawn nothing yet, unless its clip failed)
    return onShow.size > 0 || !!drawing && Object.values(drawing.canvases).some(c => c.style.visibility === "visible"
      && c.ts == null && !(c.clip && drawing.clips.get(c.clip) && drawing.clips.get(c.clip).state === "failed"));
  }

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
  // A clip is seeked once it has its size (a time set before is kept as its start, fetchClip) and not while a play() of
  // it is under way (priming, starting): on iOS a seek then, on a clip that hadn't played yet, never finished
  const seekable = v => v.readyState >= 1 && !v.priming && !v.starting;
  // Low Power Mode, and iOS's mitigation for a hot phone, refuse a clip the page plays by itself (NotAllowedError) until
  // the reader taps: the clip then draws nothing. The first refusal tells the page (MIRROR_REFUSED, js/site.js), which
  // holds the animation on its poster with the play glyph; within the reader's tap it calls unlock, and a play() then
  // lifts the refusal, clip by clip (whether it did: the play() left the clip playing). Until then nothing is retried.
  let refused = false;
  const refusal = e => {
    if (!e || e.name !== "NotAllowedError" || refused || drawing) return;
    if (CAN_DRAW) { startDrawing(); return; }
    refused = true;
    // (a scene of its own videos, suites's, shows their posters meanwhile; one of slots holds on the page's poster)
    if (typeof SLOT_CLIPS !== "undefined") try { parent.MIRROR_REFUSED && parent.MIRROR_REFUSED(window); } catch (x) {}
  };
  // Where WebCodecs can decode the clips (iOS Safari 16.4 on), a refused scene draws them itself instead, and nothing waits
  // for a tap (scene-draw.js, loaded then): a canvas in each slot shows the frame the timeline wants, from the clip's own
  // decoded MP4. The clip elements stay, paused and hidden, keeping the time drawn as their currentTime (the scenes read
  // it: intro's action bars, BASALT's overlays). A tap later changes nothing: the scene goes on drawing.
  const CAN_DRAW = typeof SLOT_CLIPS !== "undefined" && typeof VideoDecoder === "function" && typeof EncodedVideoChunk === "function";
  let drawing = null;   // once drawing: { ok: scene-draw.js is in, canvases: slot -> canvas, clips: clip element -> its SceneDraw.Clip }
  function startDrawing() {
    drawing = { ok: false, canvases: {}, clips: new Map() };
    const sc = document.createElement("script");
    sc.src = "scene-draw.js";
    sc.onload = () => { drawing.ok = !!window.SceneDraw; };
    sc.onerror = () => {   // (no drawing after all: the page holds the animation on its poster)
      drawing = null;
      refused = true;
      try { parent.MIRROR_REFUSED && parent.MIRROR_REFUSED(window); } catch (x) {}
    };
    document.head.append(sc);
    for (const slot in SLOT_CLIPS) {
      const first = Object.values(VIDS[slot])[0], c = document.createElement("canvas");
      c.style.objectFit = "cover";
      c.style.visibility = "hidden";
      first.parentNode.insertBefore(c, first);   // (where the clips are: under whatever the slot lays over them)
      drawing.canvases[slot] = c;
    }
    for (const slot in VIDS) for (const clip in VIDS[slot]) {
      const v = VIDS[slot][clip];
      let t = 0;
      Object.defineProperty(v, "currentTime", { configurable: true, get: () => t, set: x => { t = +x || 0; } });
      if (!v.paused) v.pause();
      v.style.visibility = "hidden";
    }
  }
  // a slot's clip, drawn at the time the timeline wants (as syncVideos would have the clip play or show it)
  function drawSlot(slot, w) {
    const c = drawing.canvases[slot];
    for (const clip in VIDS[slot]) VIDS[slot][clip].style.visibility = "hidden";
    c.style.visibility = w ? "visible" : "hidden";
    if (!w) return;
    const v = VIDS[slot][w.clip], n = CLIPS[w.clip].frames, dur = n / FPS;
    let t;
    if (w.mode === "show") t = (w.frame + .5) / FPS;
    else {
      const wrap = w.loop || w.wrap, tt = wrap ? ((w.t % dur) + dur) % dur : w.t;
      t = !wrap && tt >= dur - .5 / FPS ? (n - .5) / FPS : Math.max(tt, 0);
    }
    v.currentTime = t;
    if (!drawing.ok) return;
    let d = drawing.clips.get(v);
    if (!d) {
      const src = LAZY.get(v) || v.getAttribute("src");
      if (!src) return;
      LAZY.delete(v);
      drawing.clips.set(v, d = new SceneDraw.Clip(src));
    }
    d.used = performance.now();
    if (c.clip !== v) {   // (the slot's other clip: nothing until its frame is in, as for a clip loading)
      c.clip = v;
      c.ts = null;
      c.getContext("2d").clearRect(0, 0, c.width, c.height);
    }
    const f = d.frame(t);
    if (!f || f.timestamp === c.ts) return;
    if (c.width !== d.width || c.height !== d.height) { c.width = d.width; c.height = d.height; }
    c.getContext("2d").drawImage(f, 0, 0, c.width, c.height);
    c.ts = f.timestamp;
  }
  // (a clip not drawn for a while lets go of its decoder and frames; its file stays)
  function idle(now) {
    for (const d of drawing.clips.values()) if (d.dec && now - (d.used || 0) > 4000) d.release();
  }
  function unlock() {
    if (drawing) return true;   // (nothing to unlock: the scene draws its clips itself)
    let ok = false;
    for (const v of document.querySelectorAll("video")) {
      if (!v.paused) { ok = true; continue; }
      const p = v.play();
      if (p) p.catch(() => {});
      if (!v.paused) ok = true;
      v.pause();
      v.primed = false;   // (its refused priming drew nothing)
    }
    if (ok) refused = false;
    return ok;
  }
  function syncVideos(want, ctx) {
    const playing = ctx.visible && ctx.rate > .45 && ctx.rate < 4.5;
    if (drawing) {
      for (const slot in SLOT_CLIPS) drawSlot(slot, want[slot]);
      if (drawing.ok) idle(performance.now());
      return;
    }
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
          if (seekable(v) && Math.abs(v.currentTime - target) > .04) v.currentTime = target;
          if (!refused) {
            v.starting = true;
            v.play().then(() => { v.starting = false; }, e => { v.starting = false; refusal(e); });
          }
        } else if (seekable(v) && Math.abs(v.currentTime - target) > .25 * Math.max(1, r)) v.currentTime = target;
      } else {
        // iOS Safari decodes no frame of a paused video that hasn't played: a moment of playing makes it draw one
        if (v.readyState < 2 && !v.primed && v.currentSrc && !refused) {
          v.primed = v.priming = true;
          v.muted = true;
          v.play().then(() => { v.priming = false; v.pause(); }, e => { v.priming = false; refusal(e); });
        } else if (!v.paused && !v.priming) v.pause();
        if (!v.seeking && seekable(v) && Math.abs(v.currentTime - target) > .6 / FPS) v.currentTime = target;
      }
    }
  }
  // with reduced motion the looping clips (suites) hold still on their first frame
  const STILL = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // ... and a clip moved out of the frame (on a phone the summary table pushes the plots and their tiles out the top)
  // stops decoding until it is back (looked at every 0.25 s at most)
  const onStage = v => {
    const r = v.getBoundingClientRect();
    return r.width > 1 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  let loopAt = 0, wasOn = null;
  function loopVideos(on) {
    const now = performance.now();
    if (on === wasOn && now - loopAt < 250) return;
    wasOn = on; loopAt = now;
    for (const v of document.querySelectorAll("video")) {
      if (STILL) { v.autoplay = false; if (!v.paused) v.pause(); continue; }
      const play = on && onStage(v);
      if (play && v.paused && !refused) v.play().catch(refusal);
      else if (!play && !v.paused) v.pause();
    }
  }

  // every clip cued up to the end of the click after s (slotsAt carries a clip on through the later beats), queued in
  // the order they are cued (pump); the next click's are fetched ahead
  let fed = -1;
  function feed(s) {
    if (!LAZY.size || s <= fed) return;
    fed = s;
    const lastOf = i => SEGS[Math.min(i, SEGS.length - 1)].beats.slice(-1)[0][0];
    const now = lastOf(s), last = lastOf(s + 1);
    needTo = now;
    for (let k = 0; k <= last; k++) for (const c of STEPS[k].cues || []) {
      const v = VIDS[c.slot] && VIDS[c.slot][c.clip];
      if (v && LAZY.has(v) && !clipQ.some(q => q[0] === v)) clipQ.push([v, k]);
    }
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
    pump();
    let t = T - sg.start;
    if (s === 0 && P.start) t = Math.max(t, P.start);
    fetchAhead();
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
      if (LAZY_IMG.length) showImages();
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
    if (drawing && drawing.ok) for (const d of drawing.clips.values()) d.release();   // (off the screen: decoders and frames go)
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
    render, pause, caption, captions, more, pending, waiting, park, resume, parked, busy, unlock,
    setNarrow: b => document.documentElement.classList.toggle("narrow", !!b),
    get total() { return TOTAL; },
  };
})();
