"use strict";
// The episode player of the viewers (eval/, basalt/), built as the page's survival screen
// (index.html #survival, js/survival.js) but live, on an episode streamed whole: the video plan beside the execution
// (plan above execution on a phone held upright), each with the survival tags, the speed in the execution's tag and a
// note as each milestone is first reached. Under the screen: a scrub line, the goal and the game clock, the twelve
// milestones lighting up as they are reached (each a jump) and Hide plan; then a caption. On the screen, beside the
// round play button, a speed pill that each tap moves on: 1x (to start), 2x, 4x, 8x, 16x, then Auto (fast-forward
// between milestones: 16x between, 1x around each), and round again. The execution is the episode's recording; the plan is cut from its
// plan_idm video (the right half below the label row, as tools/build_survival.py does). Nothing is built from data as
// HTML: every value is set with textContent or an attribute.
//
// Each video can come in sped-up copies, a k-times copy keeping every k-th frame (tools/mirror_fast/), so its time t
// is the episode's time k*t: at 4x and up the player plays the fastest copy no faster than the speed, at the rest of
// the speed (8x is the 4x copy at 2x), since streaming and decoding a whole video at 16x is more than most connections
// and phones keep up with. Each copy has its own video element; in fast-forward the copy needed next waits, already
// seeked, behind the one playing, so the switch at each milestone is seamless.
//
//   const player = createWatchPlayer(figure, { planLag: 0.05 });
//   player.load({ exec: { 1: url, 4: url, 16: url } (or just a url), plan (the same, or null), duration, startAt,
//                 milestones: [{ t, icon, title }], ticks: [{ t, title, icon, gold }],
//                 toasts: [{ t, icon, text, death }], windows: [[start, end], …], auto, goal: (t) => text, caption });
// x positions (px) for icons at xs (sorted) on a line `width` wide: each at least `gap` past the one before, so
// crowded ones overlap but all show, pulled back from the right end when they would run off it
function spread(xs, width, gap) {
  const out = [];
  xs.forEach((x, i) => out.push(i ? Math.max(x, out[i - 1] + gap) : x));
  for (let i = out.length - 1; i >= 0; i--) out[i] = Math.max(0, Math.min(out[i], i < out.length - 1 ? out[i + 1] - gap : width));
  return out;
}

function createWatchPlayer(root, { planLag = 0, autoNote = "16× between milestones, 1× at each" } = {}) {
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
  // one element per copy (1x, 4x, 16x), stacked; exec and plan are the ones of the copy playing (state.k)
  const COPIES = [1, 4, 16];
  const video = (props) => { const v = el("video", { playsinline: "", muted: "", disablepictureinpicture: "", ...props }); v.muted = true; return v; };
  const execs = Object.fromEntries(COPIES.map((k) => [k, video({ class: "w-video w-exec", preload: k === 1 ? "metadata" : "auto" })]));
  // (the plan loads with the episode and follows it even while hidden, so "Show plan" is instant: the user, 10-16)
  const plans = Object.fromEntries(COPIES.map((k) => [k, video({ class: "w-plan", preload: "auto", tabindex: "-1" })]));
  let exec = execs[1], plan = plans[1];
  const planBox = el("div", { class: "w-plan-box" }, ...COPIES.map((k) => plans[k]));
  const speedEl = el("span", { class: "sv-speed" }), toastEl = el("span", { class: "sv-toast" });
  const icon = svg("g", { fill: "currentColor" });
  const ring = svg("circle", { class: "vbtn-ring", cx: 18, cy: 18, r: R, "stroke-dasharray": C.toFixed(2), "stroke-dashoffset": C.toFixed(2) });
  const speedBtn = el("button", { class: "w-speed", type: "button" });
  const vbtn = el("button", { class: "vbtn", type: "button", "aria-label": "Play" },
    svg("svg", { viewBox: "0 0 36 36", "aria-hidden": "true" }, svg("circle", { class: "vbtn-track", cx: 18, cy: 18, r: R }), ring, icon));
  const screen = el("div", { class: "cinema-screen" },
    el("div", { class: "sv-film" }, planBox, ...COPIES.map((k) => execs[k]),
      el("div", { class: "sv-pane sv-plan", "aria-hidden": "true" }, el("span", { class: "sv-tag", text: "Video plan" })),
      el("div", { class: "sv-pane sv-exec", "aria-hidden": "true" }, el("span", { class: "sv-tag" }, "Execution", speedEl), toastEl)),
    el("div", { class: "w-spinner", "aria-hidden": "true" }), speedBtn, vbtn);
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
    toasts: [], goal: () => null, load: 0, dragging: false, lastT: 0, toastTimer: 0, shown: {},
    k: 1, rate: 1, srcs: { exec: { 1: "" }, plan: null } };

  const clock = (s) => {
    if (s == null || !isFinite(s)) return "–";
    const w = Math.max(0, Math.floor(s)), h = Math.floor(w / 3600), m = Math.floor((w % 3600) / 60), sec = w % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
  };
  // the episode's time: the copy's time times its speed-up
  const now = () => state.pending ?? (exec.currentTime || 0) * state.k;
  const planOn = () => state.hasPlan && !state.planOff;
  const pct = (t) => `${(100 * Math.min(Math.max(t, 0), state.duration)) / state.duration}%`;

  // ---------------------------------------------------------------- the screen's shape: plan | execution, or the
  // execution alone (no plan, or Hide plan); plan above execution on a phone held upright
  const tall = matchMedia("(max-width: 699px)");
  function shape() {
    screen.style.setProperty("--ar", planOn() ? (tall.matches ? "16 / 18" : "32 / 9") : "16 / 9");
    root.classList.toggle("plan-off", state.hasPlan && state.planOff);
    root.classList.toggle("no-plan", !state.hasPlan);
    toggle.setAttribute("aria-pressed", String(state.planOff));
    toggle.lastChild.textContent = state.planOff ? "Show plan" : "Hide plan";
  }
  tall.addEventListener("change", shape);
  toggle.addEventListener("click", () => {
    state.planOff = !state.planOff;
    shape();
    if (planOn()) follow(true); else if (state.gated) resume();   // (hidden, the plan no longer holds the execution back)
  });

  // ---------------------------------------------------------------- the plan follows the execution
  // It follows whether shown or not (hidden, it keeps loading, so showing it is instant). The two play the same copy
  // (1x, 4x or 16x) at the same rate, at most 2x on its own clock, so the plan just plays along: drift past two frames is
  // taken up by playing it a few percent faster or slower until it is back within one, and only a jump or a drift of
  // half a second seeks it. While it is shown and seeking or stalled, the execution waits for it (state.gated: paused,
  // with the spinner) and goes on once it can play, so the two stay together (the user, 10-16).
  function follow(force = false) {
    if (!state.hasPlan || plan.readyState < 1 || state.pending != null) return;
    const target = Math.max(0, exec.currentTime - planLag / state.k), rate = exec.playbackRate, drift = plan.currentTime - target;
    if (!plan.seeking && Math.abs(drift) > (force ? 0.03 : 0.5)) plan.currentTime = target;
    if (Math.abs(drift) > 0.1) state.nudge = true; else if (Math.abs(drift) < 0.05) state.nudge = false;
    const want = state.nudge && !plan.seeking ? rate * (drift > 0 ? 0.97 : 1.03) : rate;
    if (plan.playbackRate !== want) plan.playbackRate = want;
    const running = !exec.paused || state.gated;
    if (!running && !plan.paused) plan.pause();
    if (running && plan.paused && !plan.seeking) plan.play().catch(() => {});
    if (planOn() && !exec.paused && plan.seeking) hold();
  }
  // the execution waits for the plan, and goes on once the plan can play
  // (it checks again every quarter second too: a plan already loaded fires no event to say it can play)
  let gateTimer = 0;
  function hold() {
    if (state.gated) return;
    state.gated = true;
    exec.pause();
    screen.classList.add("w-waiting");
    clearInterval(gateTimer);
    gateTimer = setInterval(ready, 250);
  }
  function resume() {
    if (!state.gated) return;
    state.gated = false;
    clearInterval(gateTimer);
    screen.classList.remove("w-waiting");
    play();
  }
  // (no forced seek here or on "playing": each would start the plan seeking again, and the execution waiting again)
  const ready = () => { if (state.gated && (!planOn() || (plan.readyState >= 3 && !plan.seeking))) { follow(); if (!plan.seeking) resume(); } else if (!state.gated) clearInterval(gateTimer); };
  // (each copy's element hears its own events; only the one playing counts)
  const on = (els, type, fn) => { for (const v of Object.values(els)) v.addEventListener(type, (e) => { if (e.target === (els === execs ? exec : plan)) fn(e); }); };
  for (const type of ["canplay", "canplaythrough", "seeked", "playing"]) on(plans, type, ready);
  on(plans, "waiting", () => { if (planOn() && !exec.paused) hold(); });
  on(plans, "loadedmetadata", () => { planBox.style.setProperty("--plan-h", String(plan.videoHeight || 274)); follow(true); });

  function seek(t) {
    const target = Math.max(0, Math.min(t, state.duration));
    if (exec.readyState >= 1) exec.currentTime = target / state.k; else state.pending = target;
    state.lastT = target;   // (a jump is not playing past the notes in between)
    follow(true);
    paint(target);
  }
  const play = () => exec.play().catch(() => {});
  const pause = () => exec.pause();
  // (while the execution waits for the plan, a tap means "stop": it stays paused and stops waiting)
  const toggleplay = () => { if (state.gated) { state.gated = false; clearInterval(gateTimer); screen.classList.remove("w-waiting"); paint(now()); return; } if (exec.paused) play(); else pause(); };

  // ---------------------------------------------------------------- speed: fast-forward between milestones, or 1-16x
  const rateAt = (t) => {
    const next = state.windows.find(([, end]) => t < end);
    if (!next) return FAST;
    return t >= next[0] - FAST * 0.05 ? 1 : FAST;   // a hair early: at 16x a few frames pass before a rate takes hold
  };
  // the copy for a speed: the fastest no faster than it
  const copyFor = (rate) => Math.max(1, ...Object.keys(state.srcs.exec).map(Number).filter((k) => k <= rate));
  function ensure(k) {
    for (const [v, src] of [[execs[k], state.srcs.exec[k]], [plans[k], state.srcs.plan?.[k]]]) {
      if (src && v.getAttribute("src") !== src) v.src = src;
    }
  }
  // the copy in front is the one playing, once it has a frame to show (until then the last one's frame stays)
  // (the plan and the execution change copy together, so the two on screen are always one copy)
  function reveal() {
    const has = (v) => v.readyState >= 2 && !v.seeking;
    if (!has(exec) || (state.hasPlan && plan.getAttribute("src") && !has(plan))) return;
    for (const [els, active] of [[execs, exec], [plans, plan]]) for (const v of Object.values(els)) v.style.visibility = v === active ? "" : "hidden";
  }
  function switchCopy(k) {
    const t = now(), playing = !exec.paused || state.gated, before = [exec, plan];
    ensure(k);
    state.k = k;
    exec = execs[k];
    plan = plans[k];
    for (const v of before) v.pause();
    if (exec.readyState < 1) { state.pending = t; state.startPlay = playing; }
    else {
      // (a copy made ready for this switch is within a second of it: it plays on from there rather than seek again)
      if (Math.abs(exec.currentTime * k - t) > 1.5) exec.currentTime = t / k;
      exec.playbackRate = state.rate / k;
      if (playing) play();
    }
    follow();
    reveal();
  }
  function applyRate(rate) {
    state.rate = rate;
    const k = copyFor(rate);
    if (k !== state.k) switchCopy(k);
    else { exec.playbackRate = rate / k; follow(); }
  }
  // fast-forward: the copy for the next switch (into the next milestone's 1x stretch, or out of this one) waits there
  function prewarm() {
    const t = now(), w = state.windows.find(([, end]) => t < end);
    if (!w) return;
    const [at, rate] = t < w[0] - FAST * 0.05 ? [w[0] - FAST * 0.05, 1] : [w[1], FAST], k = copyFor(rate);
    if (k === state.k) return;
    ensure(k);
    for (const [v, time] of [[execs[k], at], ...(state.hasPlan ? [[plans[k], at - planLag]] : [])]) {
      if (v.readyState >= 1 && !v.seeking && Math.abs(v.currentTime * k - time) > 0.25) v.currentTime = Math.max(0, time) / k;
    }
  }
  // a missing copy is not played (the plan and the execution play the same copy, so both go)
  for (const els of [execs, plans]) {
    for (const [k, v] of Object.entries(els)) {
      v.addEventListener("error", () => {
        if (Number(k) === 1 || !v.getAttribute("src")) return;
        delete state.srcs.exec[k];
        if (state.srcs.plan) delete state.srcs.plan[k];
        for (const x of [execs[k], plans[k]]) { x.removeAttribute("src"); x.load(); }
        if (state.k === Number(k)) applyRate(state.rate);
      });
    }
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
    const playing = !exec.paused || state.gated;
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
    if (state.auto && !exec.paused && !exec.seeking && state.pending == null) {
      const r = rateAt(now());
      if (state.rate !== r) applyRate(r);
      prewarm();
    }
    if (!state.dragging) paint(now());
    follow();
    if (!exec.paused && !exec.ended) raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  for (const type of ["timeupdate", "play", "pause", "seeked", "loadedmetadata", "ratechange", "ended"]) on(execs, type, kick);
  // a copy's first data: where the episode is, at the speed it plays at (a load resets the rate)
  on(execs, "loadedmetadata", () => {
    if (state.pending != null) { exec.currentTime = Math.min(state.pending, state.duration) / state.k; state.pending = null; }
    exec.playbackRate = state.rate / state.k;
    if (state.startPlay) { state.startPlay = false; play(); }
    follow(true);
  });
  on(execs, "pause", () => follow(true));
  on(execs, "seeked", () => { state.lastT = now(); });
  on(execs, "waiting", () => { screen.classList.add("w-waiting"); if (!plan.paused) plan.pause(); });   // (the plan waits for the execution too)
  on(execs, "playing", () => follow());
  for (const type of ["playing", "canplay", "seeked"]) on(execs, type, () => { if (!state.gated) screen.classList.remove("w-waiting"); });
  for (const type of ["loadeddata", "canplay", "seeked", "playing"]) { on(execs, type, reveal); on(plans, type, reveal); }

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
  let wasPlaying = false, scrubTimer = 0, scrubLast = 0;
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
    wasPlaying = !exec.paused;
    if (wasPlaying) pause();
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
      if (wasPlaying) play();
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
    if (e.ctrlKey || e.metaKey || e.altKey || !exec.src || root.offsetParent === null) return;
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
  function load({ exec: execSrc, plan: planSrc, duration, startAt = 0, milestones = [], ticks = [], toasts = [], windows = [], auto, goal, caption: cap = [] }) {
    state.duration = Math.max(1, duration);
    state.hasPlan = !!planSrc;
    const copies = (src) => (src == null ? null : typeof src === "string" ? { 1: src } : { ...src });
    state.srcs = { exec: copies(execSrc), plan: copies(planSrc) };
    // (the two play one copy, so a copy the plan lacks is not played)
    for (const k of Object.keys(state.srcs.exec)) if (state.srcs.plan && !state.srcs.plan[k]) delete state.srcs.exec[k];
    state.gated = false;
    clearInterval(gateTimer);
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
    state.pending = startAt;
    paint(startAt);
    screen.classList.add("w-waiting");
    state.load++;
    clear();
    state.rate = state.auto ? rateAt(startAt) : state.speed;
    state.k = copyFor(state.rate);
    exec = execs[state.k];
    plan = plans[state.k];
    for (const els of [execs, plans]) for (const v of Object.values(els)) v.style.visibility = v === exec || v === plan ? "" : "hidden";
    // (the loadedmetadata listener above takes it to startAt, at the speed, and plays)
    state.startPlay = true;
    ensure(state.k);
  }
  function clear() {
    for (const els of [execs, plans]) for (const v of Object.values(els)) { v.pause(); if (v.getAttribute("src")) { v.removeAttribute("src"); v.load(); } }
  }
  function unload() {
    state.load++;
    state.gated = false;
    clearInterval(gateTimer);
    state.startPlay = false;
    clear();
    screen.classList.remove("w-waiting");
    clearTimeout(state.toastTimer);
    toastEl.classList.remove("on");
  }

  renderRate();
  shape();
  return { load, unload, seek, play, pause, skip, clock, extra, now };
}
