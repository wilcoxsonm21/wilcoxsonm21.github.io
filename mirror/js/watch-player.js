"use strict";
// The episode player of the viewers (eval/, basalt/), built as the page's survival screen
// (index.html #survival, js/survival.js) but live, on an episode streamed whole: the video plan beside the execution
// (plan above execution on a phone held upright), each with the survival tags, the speed in the execution's tag and a
// note as each milestone is first reached. Under the screen: a scrub line, the goal and the game clock, the twelve
// milestones lighting up as they are reached (each a jump) and Hide plan; then a caption. On the screen, beside the
// round play button, a speed pill that each tap moves on: 1x (to start), 2x, 4x, 8x, 16x, then Auto (fast-forward
// between milestones: 16x between, 1x around each), and round again. Nothing is built from data as HTML: every value
// is set with textContent or an attribute.
//
// One video plays at a time (tools/mirror_fast/). With the plan shown it is a video holding both, the plan (cut from
// the plan_idm video, as tools/build_survival.py does) beside the execution, or above it on a phone held upright, so
// the two can never drift apart; with the plan hidden it is the execution alone. Each comes in sped-up copies, a
// k-times copy keeping every k-th frame, so its time t is the episode's time k*t: the player plays the fastest copy no
// faster than the speed, at the rest of the speed (8x is the 4x copy at 2x), since streaming and decoding a whole video
// at 16x is more than most connections and phones keep up with. Each video has its own element, made when first
// needed; in fast-forward the one needed next waits, already seeked, behind the one playing, so the switch at each
// milestone is seamless. Whether it plays is the reader's choice (state.intent), which a check every quarter second
// holds the video to, so no switch or seek can leave it stopped.
//
//   const player = createWatchPlayer(figure);
//   player.load({ exec: { 1: url, 4: url, 16: url } (or just a url), both: { side: copies, stack: copies } or null,
//                 duration, startAt, milestones: [{ t, icon, title }], ticks: [{ t, title, icon, gold }],
//                 toasts: [{ t, icon, text, death }], windows: [[start, end], …], auto, goal: (t) => text, caption });
// x positions (px) for icons at xs (sorted) on a line `width` wide: each at least `gap` past the one before, so
// crowded ones overlap but all show, pulled back from the right end when they would run off it
function spread(xs, width, gap) {
  const out = [];
  xs.forEach((x, i) => out.push(i ? Math.max(x, out[i - 1] + gap) : x));
  for (let i = out.length - 1; i >= 0; i--) out[i] = Math.max(0, Math.min(out[i], i < out.length - 1 ? out[i + 1] - gap : width));
  return out;
}

function createWatchPlayer(root, { autoNote = "16× between milestones, 1× at each" } = {}) {
  const NS = "http://www.w3.org/2000/svg";
  const SPEEDS = [1, 2, 4, 8, 16];
  const FAST = 16;            // (browsers play at most 16x; the survival clips go to 32x)
  const TOAST = 2200;         // ms a note stays
  const R = 15.5, C = 2 * Math.PI * R;   // the site's round button (js/controls.js)
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  };
  const svg = (tag, attrs = {}, ...children) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    node.append(...children);
    return node;
  };
  const ff = () => svg("svg", { viewBox: "0 0 14 10", "aria-hidden": "true" }, svg("path", { d: "M0 0l7 5-7 5zM7 0l7 5-7 5z" }));
  const PLAY = () => svg("path", { d: "M14.6 11.7v12.6c0 .7.8 1.1 1.4.7l10-6.3c.5-.4.5-1.1 0-1.4l-10-6.3c-.6-.4-1.4 0-1.4.7z" });
  const PAUSE = () => [svg("rect", { x: 13.2, y: 11.5, width: 3.2, height: 13, rx: 1 }), svg("rect", { x: 19.6, y: 11.5, width: 3.2, height: 13, rx: 1 })];


  // ---------------------------------------------------------------- markup
  const film = el("div", { class: "sv-film" });
  const speedEl = el("span", { class: "sv-speed" }), toastEl = el("span", { class: "sv-toast" });
  const icon = svg("g", { fill: "currentColor" });
  const ring = svg("circle", { class: "vbtn-ring", cx: 18, cy: 18, r: R, "stroke-dasharray": C.toFixed(2), "stroke-dashoffset": C.toFixed(2) });
  const speedBtn = el("button", { class: "w-speed", type: "button" });
  const vbtn = el("button", { class: "vbtn", type: "button", "aria-label": "Play" },
    svg("svg", { viewBox: "0 0 36 36", "aria-hidden": "true" }, svg("circle", { class: "vbtn-track", cx: 18, cy: 18, r: R }), ring, icon));
  film.append(el("div", { class: "sv-pane sv-plan", "aria-hidden": "true" }, el("span", { class: "sv-tag", text: "Video plan" })),
    el("div", { class: "sv-pane sv-exec", "aria-hidden": "true" }, el("span", { class: "sv-tag" }, "Execution", speedEl), toastEl));
  const screen = el("div", { class: "cinema-screen" }, film, el("div", { class: "w-spinner", "aria-hidden": "true" }), speedBtn, vbtn);
  const fill = el("div", { class: "w-fill" }), ticksBox = el("div", { class: "w-ticks" }), tip = el("div", { class: "w-tip", "aria-hidden": "true" });
  const rail = el("div", { class: "w-rail" }, fill, ticksBox);
  const scrub = el("div", { class: "w-scrub", role: "slider", tabindex: "0", "aria-label": "Episode time", "aria-valuemin": "0" }, rail, tip);
  const goalEl = el("p", { class: "sv-goal", "aria-live": "off" });
  const list = el("ol", { class: "sv-milestones", "aria-label": "Milestones: each lights up when reached; click to jump there" });
  const extra = el("div", { class: "w-extra" });
  const toggle = el("button", { class: "sv-toggle", type: "button", "aria-pressed": "false" },
    svg("svg", { viewBox: "0 0 20 14", "aria-hidden": "true" }, svg("rect", { class: "sv-toggle-plan", x: 1, y: 1, width: 8, height: 12, rx: 2 }),
      svg("rect", { x: 11, y: 1, width: 8, height: 12, rx: 2 })), el("span", { text: "Hide plan" }));
  const caption = el("p", { class: "cinema-caption" });
  root.classList.add("cinema-figure", "w-figure");
  root.replaceChildren(screen, scrub,
    el("div", { class: "sv-strip" }, goalEl, list, extra, toggle), caption);

  // the plan starts hidden (the user, 10-16: "Show plan" brings it in, and it stays for the next episodes)
  const state = { duration: 1, hasPlan: false, planOff: true, pending: null, speed: 1, auto: false, windows: [], milestones: [], ticks: [],
    toasts: [], goal: () => null, dragging: false, lastT: 0, toastTimer: 0, shown: {},
    intent: false, rate: 1, view: "exec", k: 1, srcs: { exec: {} } };

  const clock = (s) => {
    if (s == null || !isFinite(s)) return "–";
    const w = Math.max(0, Math.floor(s)), h = Math.floor(w / 3600), m = Math.floor((w % 3600) / 60), sec = w % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
  };
  const planOn = () => state.hasPlan && !state.planOff;
  const pct = (t) => `${(100 * Math.min(Math.max(t, 0), state.duration)) / state.duration}%`;

  // ---------------------------------------------------------------- the videos: one element per video and copy
  // (exec:1, side:4, …), made when first needed. The execution alone sits in the execution's half of the strip; a video
  // with both fills the strip, and the screen shows the whole of it. Only `video` (state.view at state.k) plays.
  const pool = new Map();
  let video = null;
  function element(view, k) {
    const key = `${view}:${k}`;
    if (!pool.has(key)) {
      const v = el("video", { playsinline: "", muted: "", preload: "auto", disablepictureinpicture: "", tabindex: "-1",
        class: view === "exec" ? "w-video w-exec" : "w-video" });
      v.muted = true;
      if (view !== "exec") Object.assign(v.style, { left: "0", top: "0", width: "100%", height: "100%" });
      v.style.visibility = "hidden";
      v.dataset.view = view;
      v.dataset.k = String(k);
      for (const type of ["loadedmetadata", "loadeddata", "canplay", "seeked", "playing", "waiting", "pause", "play", "ended", "error"]) {
        v.addEventListener(type, (e) => onMedia(v, e.type));
      }
      film.prepend(v);
      pool.set(key, v);
    }
    const v = pool.get(key), src = state.srcs[view]?.[k];
    if (src && v.getAttribute("src") !== src) v.src = src;
    return v;
  }
  const kOf = (v) => Number(v.dataset.k);
  // the episode's time: the copy's time times its speed-up
  const now = () => state.pending ?? (video ? video.currentTime * state.k : 0);
  const viewWanted = () => (planOn() ? (tall.matches ? "stack" : "side") : "exec");
  // the copy for a speed: the fastest no faster than it
  const copyFor = (view, rate) => Math.max(1, ...Object.keys(state.srcs[view] ?? {}).map(Number).filter((k) => k <= rate));

  // the video in front is the one playing, once it has a frame to show (until then the last one's frame stays); the
  // rest let go of their files, so nothing off screen takes the connection from it, but for the copy fast-forward
  // switches to next
  function reveal() {
    if (!video || video.readyState < 2 || video.seeking) return;
    const keep = new Set([video, ...(state.auto ? [1, FAST].map((r) => pool.get(`${state.view}:${copyFor(state.view, r)}`)) : [])]);
    for (const v of pool.values()) {
      v.style.visibility = v === video ? "" : "hidden";
      if (!keep.has(v) && v.getAttribute("src")) { v.pause(); v.removeAttribute("src"); v.load(); }
    }
  }
  // play view at copy k from episode time t (a video made ready for this, within a second of t, plays on from there)
  function show(view, k, t = now()) {
    const next = element(view, k);
    if (next === video) return;
    const before = video;
    video = next;
    state.view = view;
    state.k = k;
    before?.pause();
    if (video.readyState >= 1) {
      if (Math.abs(video.currentTime * k - t) > 1.5) video.currentTime = t / k;
      state.pending = null;
    } else state.pending = t;
    video.playbackRate = state.rate / k;
    hold();
    reveal();
  }
  // the video does what the reader asked for: plays (from where it is, at the speed) or not; a jump past its end stops
  function hold() {
    if (!video) return;
    if (state.pending != null && video.readyState >= 1) {
      video.currentTime = Math.min(state.pending, state.duration) / state.k;
      state.pending = null;
    }
    if (video.readyState >= 1 && video.playbackRate !== state.rate / state.k) video.playbackRate = state.rate / state.k;
    const play = state.intent && !state.dragging && !(video.ended && now() >= state.duration - 0.5);
    if (play && video.paused) video.play().catch(() => {});
    else if (!play && !video.paused) video.pause();
    // the spinner: the reader wants it playing, and it cannot yet
    screen.classList.toggle("w-waiting", play && (video.readyState < 3 || video.seeking || state.pending != null));
  }
  function onMedia(v, type) {
    if (type === "error") return lost(v);
    if (v !== video) return;
    if (type === "ended") { state.intent = false; paint(now()); }
    if (type === "seeked") state.lastT = now();
    hold();
    reveal();
    kick();
  }
  // a video that will not load is not played again: a missing sped-up copy falls back to a slower one, and without the
  // plan's videos the execution plays alone
  function lost(v) {
    const view = v.dataset.view, k = kOf(v);
    if (!v.getAttribute("src") || !state.srcs[view]?.[k]) return;
    delete state.srcs[view][k];
    v.removeAttribute("src");
    v.load();
    if (view !== "exec" && !state.srcs[view][1]) { state.hasPlan = false; shape(); }
    if (v === video) { video = null; show(viewWanted(), copyFor(viewWanted(), state.rate), state.lastT); }
  }
  setInterval(() => { if (video && root.offsetParent !== null) hold(); }, 250);

  // ---------------------------------------------------------------- the screen's shape: plan | execution, or the
  // execution alone (no plan, or Hide plan); plan above execution on a phone held upright
  const tall = matchMedia("(max-width: 699px)");
  function shape() {
    // (on the figure: the scrub line, the strip and the caption under the screen take its width too, css/watch.css)
    root.style.setProperty("--ar", planOn() ? (tall.matches ? "16 / 18" : "32 / 9") : "16 / 9");
    root.classList.toggle("plan-off", state.hasPlan && state.planOff);
    root.classList.toggle("no-plan", !state.hasPlan);
    toggle.setAttribute("aria-pressed", String(state.planOff));
    toggle.lastChild.textContent = state.planOff ? "Show plan" : "Hide plan";
  }
  function reshape() {
    shape();
    if (video) show(viewWanted(), copyFor(viewWanted(), state.rate));
  }
  tall.addEventListener("change", reshape);
  toggle.addEventListener("click", () => { state.planOff = !state.planOff; reshape(); });

  function seek(t) {
    const target = Math.max(0, Math.min(t, state.duration));
    if (video?.readyState >= 1) { video.currentTime = target / state.k; state.pending = null; } else state.pending = target;
    state.lastT = target;   // (a jump is not playing past the notes in between)
    hold();
    paint(target);
  }
  const play = () => { state.intent = true; if (video?.ended) seek(0); hold(); paint(now()); };
  const pause = () => { state.intent = false; hold(); paint(now()); };
  const toggleplay = () => (state.intent ? pause() : play());

  // ---------------------------------------------------------------- speed: fast-forward between milestones, or 1-16x
  const rateAt = (t) => {
    const next = state.windows.find(([, end]) => t < end);
    if (!next) return FAST;
    return t >= next[0] - FAST * 0.05 ? 1 : FAST;   // a hair early: a frame or two pass before a switch takes hold
  };
  function applyRate(rate) {
    state.rate = rate;
    const k = copyFor(state.view, rate);
    if (k !== state.k) show(state.view, k); else hold();
  }
  // fast-forward: the video for the next switch (into the next milestone's 1x stretch, or out of this one) waits there
  function prewarm() {
    const t = now(), w = state.windows.find(([, end]) => t < end);
    if (!w) return;
    const [at, rate] = t < w[0] - FAST * 0.05 ? [w[0] - FAST * 0.05, 1] : [w[1], FAST], k = copyFor(state.view, rate);
    if (k === state.k) return;
    const v = element(state.view, k);
    if (v.readyState >= 1 && !v.seeking && Math.abs(v.currentTime * k - at) > 0.25) v.currentTime = at / k;
  }
  function setAuto(on) {
    state.auto = on && state.windows.length > 0;
    applyRate(state.auto ? rateAt(now()) : state.speed);
    renderRate();
  }
  function setSpeed(s) { state.speed = s; state.auto = false; applyRate(s); renderRate(); }
  // the pill shows the mode it is in; a tap moves to the next: fast-forward (where there are milestones), 1x … 16x
  function renderRate() {
    speedBtn.replaceChildren(...(state.auto ? [ff(), "Auto"] : [`${state.speed}×`]));
    speedBtn.classList.toggle("w-auto", state.auto);
    speedBtn.setAttribute("aria-label", `Speed: ${state.auto ? `fast-forward between milestones (${autoNote})` : `${state.speed}×`}. Tap for the next speed`);
    speedBtn.title = state.auto ? `Fast-forward between milestones: ${autoNote}` : `${state.speed}×`;
  }
  speedBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // 1x first, so the pill reads as a speed you can raise (the user, 10-16); fast-forward between milestones comes last
    const modes = [...SPEEDS, ...(state.windows.length ? ["auto"] : [])];
    const next = modes[(modes.indexOf(state.auto ? "auto" : state.speed) + 1) % modes.length];
    if (next === "auto") setAuto(true); else setSpeed(next);
  });

  // ---------------------------------------------------------------- what follows the time
  function set(key, value, apply) { if (state.shown[key] !== value) { state.shown[key] = value; apply(value); } }
  function toast(item) {
    toastEl.replaceChildren(...(item.icon ? [el("img", { src: item.icon, alt: "" })] : []),
      el("span", {}, ...(item.death ? [] : [el("span", { class: "sv-check", text: "✓" }), " "]), item.text));
    toastEl.classList.toggle("death", !!item.death);
    toastEl.classList.add("on");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toastEl.classList.remove("on"), TOAST);
  }
  function paint(t) {
    t = Math.min(t, state.duration);
    fill.style.width = pct(t);
    scrub.setAttribute("aria-valuenow", String(Math.round(t)));
    scrub.setAttribute("aria-valuetext", clock(t));
    ring.setAttribute("stroke-dashoffset", (C * (1 - t / state.duration)).toFixed(2));
    const playing = state.intent;
    set("playing", playing, (p) => { icon.replaceChildren(...(p ? PAUSE() : [PLAY()])); vbtn.setAttribute("aria-label", p ? "Pause" : "Play"); });
    const rate = playing ? state.rate : 1;
    set("rate", rate, (r) => { speedEl.replaceChildren(...(r > 1 ? [ff(), `${r}×`] : ["1×"])); speedEl.classList.toggle("fast", r > 1); });
    const goal = state.goal(t);
    set("goal", `${goal}|${clock(t)}`, () => goalEl.replaceChildren(...(goal ? ["Goal: ", el("b", { text: goal })] : []),
      el("span", { class: "sv-clock", text: `${clock(t)} in game` })));
    state.milestones.forEach((m, i) => set(`m${i}`, m.t != null && m.t <= t, (got) => {
      const li = list.children[i];
      li.classList.toggle("got", got);
      if (got && playing) { li.classList.add("pop"); setTimeout(() => li.classList.remove("pop"), 450); }
    }));
    for (const tick of ticksBox.children) set(`k${tick.dataset.t}`, Number(tick.dataset.t) <= t, (v) => tick.classList.toggle("w-passed", v));
    // a note for each moment played past (not jumped past)
    if (playing && t > state.lastT && t - state.lastT < 3 * FAST) {
      const crossed = state.toasts.filter((x) => x.t > state.lastT && x.t <= t);
      if (crossed.length) toast(crossed[crossed.length - 1]);
    }
    state.lastT = t;
  }
  let raf = 0;
  const loop = () => {
    raf = 0;
    if (state.auto && video && !video.paused && !video.seeking && state.pending == null) {
      const r = rateAt(now());
      if (state.rate !== r) applyRate(r);
      prewarm();
    }
    if (!state.dragging) paint(now());
    if (video && !video.paused && !video.ended) raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  // ---------------------------------------------------------------- the moments on the scrub line: tiny item icons
  // (the user, 10-16), faded until played past; a dot where a moment has no icon. Icons too close for one each (an
  // hour-long episode's first minute: log, planks, sticks, crafting table) fan out to the right, overlapping, so every
  // one still shows (the user, 10-16); each names its own moment and a click jumps just before it.
  const ICON = 16;
  function drawTicks() {
    const width = rail.getBoundingClientRect().width || 600, sorted = [...state.ticks].sort((a, b) => a.t - b.t);
    const icons = sorted.filter((k) => k.icon), xs = spread(icons.map((k) => (k.t / state.duration) * width), width, ICON * 0.85);
    ticksBox.replaceChildren(...sorted.filter((k) => !k.icon).map((k) =>
      el("i", { class: `w-tick${k.gold ? " w-gold" : ""}`, "data-t": String(k.t), style: `left:${pct(k.t)}` })),
    ...icons.map((k, i) => el("button", { class: "w-mark", type: "button", tabindex: "-1", title: k.title, "aria-hidden": "true",
      "data-t": String(k.t), "data-jump": String(k.t), "data-x": String(xs[i]), style: `left:${xs[i]}px` }, el("img", { src: k.icon, alt: "" }))));
    state.shown = Object.fromEntries(Object.entries(state.shown).filter(([key]) => !key.startsWith("k")));
  }
  new ResizeObserver(() => { if (state.ticks.length) drawTicks(); }).observe(rail);

  // ---------------------------------------------------------------- the scrub line
  const timeAt = (x) => { const b = rail.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - b.left) / b.width)) * state.duration; };
  const tickAt = (x) => {
    const b = rail.getBoundingClientRect();
    let best = null, d0 = 7;
    for (const k of state.ticks) { const d = Math.abs(b.left + (k.t / state.duration) * b.width - x); if (d < d0) { best = k; d0 = d; } }
    return best;
  };
  let scrubTimer = 0, scrubLast = 0;
  const scrubTo = (t, final) => {
    fill.style.width = pct(t);
    clearTimeout(scrubTimer);
    const wait = final ? 0 : 120 - (performance.now() - scrubLast);
    if (wait <= 0) { scrubLast = performance.now(); seek(t); } else scrubTimer = setTimeout(() => scrubTo(t, true), wait);
  };
  scrub.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    const mark = e.target.closest(".w-mark");
    if (mark) { e.preventDefault(); seek(Math.max(0, Number(mark.dataset.jump) - 3)); play(); return; }
    state.dragging = true;
    hold();   // (it waits while dragged, and plays on after if it was playing)
    root.classList.add("w-dragging");
    scrub.setPointerCapture(e.pointerId);
    scrubTo(timeAt(e.clientX), true);
  });
  scrub.addEventListener("pointermove", (e) => {
    const mark = e.target.closest(".w-mark"), k = mark ? null : tickAt(e.clientX), t = k ? k.t : timeAt(e.clientX);
    tip.textContent = mark ? mark.title : k ? k.title : clock(t);
    tip.style.left = mark ? `${mark.dataset.x}px` : pct(t);
    if (state.dragging) scrubTo(timeAt(e.clientX), false);
  });
  for (const type of ["pointerup", "pointercancel"]) {
    scrub.addEventListener(type, (e) => {
      if (!state.dragging) return;
      state.dragging = false;
      root.classList.remove("w-dragging");
      if (type === "pointerup") scrubTo(timeAt(e.clientX), true);
      hold();
    });
  }
  scrub.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -5, ArrowRight: 5, PageDown: -60, PageUp: 60 }[e.key];
    if (step) { e.preventDefault(); e.stopPropagation(); seek(now() + step); }
  });

  // ---------------------------------------------------------------- the rest
  vbtn.addEventListener("click", (e) => { e.stopPropagation(); toggleplay(); });
  screen.addEventListener("click", (e) => { if (!e.target.closest("button")) toggleplay(); });
  // skip to the previous or next milestone (also the [ and ] keys)
  function skip(dir) {
    const t = now(), times = state.milestones.filter((m) => m.t != null).map((m) => m.t).sort((a, b) => a - b);
    const target = dir > 0 ? times.find((x) => x - 3 > t + 0.5) : [...times].reverse().find((x) => x - 3 < t - 1.5);
    if (target !== undefined) { seek(Math.max(0, target - 3)); play(); }
  }
  // keys, wherever the focus is but in a field: Space plays, ←/→ 5 s, [ ] the previous or next milestone, 1-5 a speed,
  // F fast-forward between milestones, P the plan
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !video || root.offsetParent === null) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    const onButton = ["BUTTON", "A"].includes(document.activeElement?.tagName) && !root.contains(document.activeElement);
    if (e.key === " " && !onButton) { e.preventDefault(); toggleplay(); }
    else if (e.key === "ArrowLeft" && document.activeElement !== scrub) { e.preventDefault(); seek(now() - 5); }
    else if (e.key === "ArrowRight" && document.activeElement !== scrub) { e.preventDefault(); seek(now() + 5); }
    else if (e.key === "[") skip(-1);
    else if (e.key === "]") skip(1);
    else if (/^[1-5]$/.test(e.key)) setSpeed(SPEEDS[Number(e.key) - 1]);
    else if ((e.key === "f" || e.key === "F") && state.windows.length) setAuto(!state.auto);
    else if ((e.key === "p" || e.key === "P") && state.hasPlan) toggle.click();
  });

  // ---------------------------------------------------------------- an episode
  function load({ exec: execSrc, both, duration, startAt = 0, milestones = [], ticks = [], toasts = [], windows = [], auto, goal, caption: cap = [] }) {
    clear();
    const copies = (src) => (typeof src === "string" ? { 1: src } : { ...src });
    state.srcs = { exec: copies(execSrc), ...(both ? { side: copies(both.side), stack: copies(both.stack) } : {}) };
    state.duration = Math.max(1, duration);
    state.hasPlan = !!both;
    state.milestones = milestones;
    state.ticks = ticks;
    state.toasts = toasts.sort((a, b) => a.t - b.t);
    state.windows = windows;
    state.goal = goal ?? (() => null);
    state.shown = {};
    state.lastT = startAt;
    if (auto !== undefined) state.auto = auto && windows.length > 0;
    else if (!windows.length) state.auto = false;
    shape();
    list.replaceChildren(...milestones.map((m) => el("li", {}, el("button", {
      type: "button", title: m.t != null ? m.title : `${m.name}: not reached`, "aria-label": m.t != null ? `Jump to ${m.title}` : `${m.name}: not reached`,
      ...(m.t == null ? { disabled: "" } : {}), onclick: () => { seek(Math.max(0, m.t - 3)); play(); },
    }, el("img", { src: m.icon, alt: "" })))));
    list.hidden = !milestones.length;
    drawTicks();
    caption.replaceChildren(...(cap[0] ? [el("strong", { text: cap[0] }), " "] : []), cap[1] ?? "");
    toastEl.classList.remove("on");
    renderRate();
    scrub.setAttribute("aria-valuemax", String(Math.round(state.duration)));
    state.intent = true;
    state.rate = state.auto ? rateAt(startAt) : state.speed;
    show(viewWanted(), copyFor(viewWanted(), state.rate), startAt);
    paint(startAt);
  }
  // every video of the last episode stops and lets go of its file
  function clear() {
    for (const v of pool.values()) { v.pause(); v.style.visibility = "hidden"; if (v.getAttribute("src")) { v.removeAttribute("src"); v.load(); } }
    video = null;
    state.pending = null;
  }
  function unload() {
    state.intent = false;
    clear();
    screen.classList.remove("w-waiting");
    clearTimeout(state.toastTimer);
    toastEl.classList.remove("on");
  }

  renderRate();
  shape();
  return { load, unload, seek, play, pause, skip, clock, extra, now, debug: () => ({ view: state.view, k: state.k, rate: state.rate, intent: state.intent, pending: state.pending, auto: state.auto }) };
}
