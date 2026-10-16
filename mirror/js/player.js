"use strict";
// The redesigned episode viewers' video player (eval/v2.html, basalt/v2.html), in the manner of Apple's: the video
// first, and under it one row of controls: play, the elapsed time, a scrubber with the episode's moments marked on it,
// the time left, a playback menu and full screen. An episode can have two videos (the recording, and the executed
// actions beside the video plan); both play together, the hidden one transparent behind the shown one, so a switch is
// instant. Every value from the data files is set with textContent or an attribute: no HTML is built from data.
//
//   const player = createPlayer(document.getElementById("player"), { lag: { plan_idm: 0.05 }, onTime });
//   player.load({ sources: { raw, plan_idm }, duration, startAt, marks, bands, windows, autoplay });
//
// marks:   [{ t, kind: "item" | "death" | "success" | "end", icon?, label?, title }]  (items cluster when they crowd)
// bands:   [{ from, to, kind: "done" | "failed" }]                                    (tints on the rail)
// windows: [[start, end], …] the key moments: with "Skim" on, 1x inside them and 16x between (none: no Skim)
function createPlayer(root, { lag = {}, onTime = () => {}, onView = () => {}, skimLabel = "Skim to key moments" } = {}) {
  const VIEWS = ["raw", "plan_idm"];
  const SPEEDS = [1, 2, 4, 8, 16];
  const FAST = 16;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const q = (sel) => root.querySelector(sel);
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
  const icon = (d, cls = "") => {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    if (cls) s.setAttribute("class", cls);
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    s.append(p);
    return s;
  };
  const GLYPH = {
    play: "M8 5.2v13.6c0 .8.9 1.3 1.6.8l10.4-6.8c.6-.4.6-1.2 0-1.6L9.6 4.4C8.9 3.9 8 4.4 8 5.2z",
    pause: "M7 4.5h3.2c.4 0 .8.4.8.8v13.4c0 .4-.4.8-.8.8H7c-.4 0-.8-.4-.8-.8V5.3c0-.4.4-.8.8-.8zm6.8 0H17c.4 0 .8.4.8.8v13.4c0 .4-.4.8-.8.8h-3.2c-.4 0-.8-.4-.8-.8V5.3c0-.4.4-.8.8-.8z",
    full: "M4 9V5.5C4 4.7 4.7 4 5.5 4H9M15 4h3.5c.8 0 1.5.7 1.5 1.5V9M20 15v3.5c0 .8-.7 1.5-1.5 1.5H15M9 20H5.5C4.7 20 4 19.3 4 18.5V15",
    skim: "M3.5 6.6v10.8c0 .7.8 1.1 1.4.7L12 13v4.4c0 .7.8 1.1 1.4.7l7.6-5.4c.5-.4.5-1.1 0-1.4L13.4 5.9c-.6-.4-1.4 0-1.4.7V11L4.9 5.9c-.6-.4-1.4 0-1.4.7z",
    check: "M5 12.5l4.5 4.5L19 7.5",
  };

  // ---------------------------------------------------------------- markup
  root.classList.add("pl");
  root.replaceChildren(
    el("div", { class: "pl-screen" },
      el("video", { class: "pl-video", "data-view": "raw", playsinline: "", muted: "", preload: "metadata", disablepictureinpicture: "" }),
      el("video", { class: "pl-video pl-back", "data-view": "plan_idm", playsinline: "", muted: "", preload: "metadata", disablepictureinpicture: "", tabindex: "-1" }),
      el("div", { class: "pl-spinner", "aria-hidden": "true" }),
      el("button", { class: "pl-bigplay", type: "button", "aria-label": "Play" }, icon(GLYPH.play)),
      el("div", { class: "pl-overlay" })),
    el("div", { class: "pl-bar" },
      el("button", { class: "pl-play pl-icon", type: "button", "aria-label": "Play" }, icon(GLYPH.play)),
      el("span", { class: "pl-time pl-elapsed", text: "0:00" }),
      el("div", { class: "pl-scrub", role: "slider", tabindex: "0", "aria-label": "Episode time", "aria-valuemin": "0" },
        el("div", { class: "pl-marks" }),
        el("div", { class: "pl-rail" }, el("div", { class: "pl-bands" }), el("div", { class: "pl-fill" }), el("div", { class: "pl-ticks" }), el("div", { class: "pl-knob" })),
        el("div", { class: "pl-hover", "aria-hidden": "true" })),
      el("span", { class: "pl-time pl-total", text: "0:00" }),
      el("div", { class: "pl-menu-wrap" },
        el("button", { class: "pl-rate", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", text: "1×" }),
        el("div", { class: "pl-menu", role: "menu", hidden: "" })),
      el("button", { class: "pl-full pl-icon", type: "button", "aria-label": "Full screen" }, icon(GLYPH.full, "pl-stroke"))));

  const screen = q(".pl-screen");
  const videos = { raw: q('video[data-view="raw"]'), plan_idm: q('video[data-view="plan_idm"]') };
  for (const video of Object.values(videos)) video.muted = true;   // (the attribute alone doesn't mute in every browser)
  const scrub = q(".pl-scrub"), rail = q(".pl-rail"), fill = q(".pl-fill"), knob = q(".pl-knob"), hover = q(".pl-hover");
  const marksBox = q(".pl-marks"), bandsBox = q(".pl-bands"), ticksBox = q(".pl-ticks");
  const playBtn = q(".pl-play"), bigPlay = q(".pl-bigplay"), rateBtn = q(".pl-rate"), menu = q(".pl-menu");
  // the Recording / Video plan switch: the viewer puts it where it likes (the plan view is a wide side-by-side with
  // labels in its corners, so nothing sits on the video)
  const viewsBox = el("div", { class: "pl-views", role: "tablist", "aria-label": "Video", hidden: "" },
    el("button", { role: "tab", type: "button", "data-view": "raw", "aria-selected": "true", text: "Recording" }),
    el("button", { role: "tab", type: "button", "data-view": "plan_idm", "aria-selected": "false", text: "Video plan" }));

  const state = { view: "raw", sources: {}, duration: 1, pending: null, speed: 1, skim: false, windows: [], marks: [], load: 0, dragging: false };

  // ---------------------------------------------------------------- time
  const clock = (seconds) => {
    if (seconds == null || !isFinite(seconds)) return "–";
    const whole = Math.max(0, Math.floor(seconds));
    const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`;
  };
  const lagOf = (view) => lag[view] ?? 0;
  const toVideo = (view, t) => Math.max(0, t - lagOf(view));
  const toEpisode = (view, t) => t + lagOf(view);
  const shown = () => videos[state.view];
  const other = (view) => (view === "raw" ? "plan_idm" : "raw");
  const behind = () => videos[other(state.view)];
  const has = (view) => !!state.sources[view];
  const now = () => state.pending ?? toEpisode(state.view, shown().currentTime || 0);

  // ---------------------------------------------------------------- the two videos, kept in step
  function syncBehind(force = false) {
    const front = shown(), back = behind();
    if (!has(other(state.view)) || back.readyState < 1) return;
    if (front.playbackRate > 4) { if (!back.paused) back.pause(); return; }   // fast: only the shown one streams
    const target = toVideo(other(state.view), toEpisode(state.view, front.currentTime));
    if (force || (!back.seeking && Math.abs(back.currentTime - target) > 0.35)) back.currentTime = target;
    if (back.playbackRate !== front.playbackRate) back.playbackRate = front.playbackRate;
    if (front.paused && !back.paused) back.pause();
    if (!front.paused && back.paused) back.play().catch(() => {});
  }

  function setView(view) {
    if (view === state.view || !has(view)) return;
    const t = now(), playing = !shown().paused, rate = shown().playbackRate;
    state.view = view;
    for (const v of VIEWS) videos[v].classList.toggle("pl-back", v !== view);
    const front = shown();
    front.playbackRate = rate;
    if (front.readyState >= 1 && Math.abs(toEpisode(view, front.currentTime) - t) > 0.25) front.currentTime = toVideo(view, t);
    if (playing && front.paused) front.play().catch(() => {});
    syncBehind();
    for (const b of viewsBox.children) b.setAttribute("aria-selected", String(b.dataset.view === view));
    onView(view);
  }

  function seek(t) {
    const target = Math.max(0, Math.min(t, state.duration));
    for (const v of VIEWS) if (has(v) && videos[v].readyState >= 1) videos[v].currentTime = toVideo(v, target);
    if (shown().readyState < 1) state.pending = target;
    paint(target);
  }

  function play() { shown().play().catch(() => {}); }
  function pause() { shown().pause(); }
  function toggle() { if (shown().paused) play(); else pause(); }

  // ---------------------------------------------------------------- speed and skim
  function rateAt(t) {
    const next = state.windows.find(([, end]) => t < end);
    if (!next) return FAST;
    return t >= next[0] - FAST * 0.05 ? 1 : FAST;   // a hair early: at 16x a few frames pass before a rate takes hold
  }
  function applyRate(rate) {
    for (const v of VIEWS) videos[v].playbackRate = rate;
    syncBehind(true);
  }
  function skimTick() {
    if (!state.skim) return;
    const video = shown();
    if (!video.paused && !video.seeking && state.pending == null) {
      const rate = rateAt(now());
      if (video.playbackRate !== rate) applyRate(rate);
    }
    requestAnimationFrame(skimTick);
  }
  function setSkim(on) {
    state.skim = on && state.windows.length > 0;
    if (state.skim) { applyRate(rateAt(now())); requestAnimationFrame(skimTick); } else applyRate(state.speed);
    renderRate();
    paint(now());
  }
  function setSpeed(speed) {
    state.speed = speed;
    state.skim = false;
    applyRate(speed);
    renderRate();
  }
  function renderRate() {
    rateBtn.replaceChildren(...(state.skim ? [icon(GLYPH.skim, "pl-fill-icon"), "Skim"] : [`${state.speed}×`]));
    rateBtn.classList.toggle("pl-on", state.skim);
    rateBtn.setAttribute("aria-label", state.skim ? `Playback: ${skimLabel}` : `Playback speed ${state.speed}×`);
    const options = [];
    if (state.windows.length) {
      options.push(el("button", { role: "menuitemradio", type: "button", class: "pl-menu-skim", "aria-checked": String(state.skim),
        onclick: () => { setSkim(true); closeMenu(); } }, icon(GLYPH.check, "pl-check"),
      el("span", {}, el("strong", { text: "Skim" }), el("small", { text: skimLabel }))));
      options.push(el("hr"));
    }
    for (const speed of SPEEDS) {
      options.push(el("button", { role: "menuitemradio", type: "button", "aria-checked": String(!state.skim && state.speed === speed),
        onclick: () => { setSpeed(speed); closeMenu(); } }, icon(GLYPH.check, "pl-check"), el("span", { text: `${speed}×` })));
    }
    menu.replaceChildren(...options);
  }
  function openMenu() {
    menu.hidden = false;
    rateBtn.setAttribute("aria-expanded", "true");
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector("button"))?.focus({ preventScroll: true });
  }
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    rateBtn.setAttribute("aria-expanded", "false");
  }
  rateBtn.addEventListener("click", () => (menu.hidden ? openMenu() : closeMenu()));
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".pl-menu-wrap")) closeMenu(); });
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll("button")], i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); rateBtn.focus(); }
  });

  // ---------------------------------------------------------------- the scrubber and its marks
  const pct = (t) => `${(100 * Math.min(Math.max(t, 0), state.duration)) / state.duration}%`;
  function paint(t) {
    t = Math.min(t, state.duration);   // (a video can run a frame past the episode's end)
    fill.style.width = pct(t);
    knob.style.left = pct(t);
    q(".pl-elapsed").textContent = clock(t);
    scrub.setAttribute("aria-valuenow", String(Math.round(t)));
    scrub.setAttribute("aria-valuetext", clock(t));
    const playing = !shown().paused;
    playBtn.replaceChildren(icon(playing ? GLYPH.pause : GLYPH.play));
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    root.classList.toggle("pl-playing", playing);
    const rate = shown().playbackRate;
    if (playing && rate > 1) screen.dataset.rate = `${rate}×`; else delete screen.dataset.rate;
    onTime(t);
  }

  // item marks crowd at the start of a long episode (log, planks, stick… in the first minute): marks closer than an
  // icon share one place, showing the furthest of them and naming all in its tooltip
  function drawMarks() {
    const width = scrub.getBoundingClientRect().width || 600;
    const ICON = 18;
    marksBox.replaceChildren();
    ticksBox.replaceChildren();
    const items = state.marks.filter((m) => m.kind === "item").sort((a, b) => a.t - b.t);
    const groups = [];
    for (const m of items) {
      const x = (m.t / state.duration) * width, g = groups[groups.length - 1];
      if (g && x - g.x < ICON + 2) { g.items.push(m); g.x = x; } else groups.push({ x, items: [m] });
    }
    for (const g of groups) {
      const last = g.items[g.items.length - 1], first = g.items[0];
      const title = g.items.map((m) => m.title).join("\n");
      marksBox.append(el("button", { class: "pl-mark pl-item", type: "button", title, "aria-label": title,
        style: `left:${pct(last.t)}`, onclick: (e) => { e.stopPropagation(); seek(first.t - 4); play(); } },
      el("img", { src: last.icon, alt: "" })));
    }
    for (const m of state.marks.filter((m) => m.kind !== "item")) {
      if (m.kind === "death") { ticksBox.append(el("i", { class: "pl-tick pl-death", style: `left:${pct(m.t)}`, title: m.title })); continue; }
      // success / end: a flag above the rail with its label, which jumps there
      const flag = el("button", { class: `pl-mark pl-flag pl-${m.kind}`, type: "button", title: m.title, style: `left:${pct(m.t)}`,
        onclick: (e) => { e.stopPropagation(); seek(m.jump ?? m.t - 6); play(); } }, el("span", { text: m.label }));
      marksBox.append(flag);
      ticksBox.append(el("i", { class: `pl-tick pl-${m.kind}`, style: `left:${pct(m.t)}` }));
    }
    // a flag near either end opens toward the middle
    for (const flag of marksBox.querySelectorAll(".pl-flag")) {
      const at = parseFloat(flag.style.left);
      flag.classList.toggle("pl-flag-start", at < 12);
      flag.classList.toggle("pl-flag-end", at > 88);
    }
  }
  function drawBands(bands) {
    bandsBox.replaceChildren(...bands.map((b) => el("i", { class: `pl-band pl-${b.kind}`, style: `left:${pct(b.from)};width:${pct(b.to - b.from)}` })));
  }
  new ResizeObserver(() => drawMarks()).observe(scrub);

  const timeAt = (clientX) => {
    const box = rail.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * state.duration;
  };
  let scrubTimer = 0, scrubLast = 0, wasPlaying = false;
  const scrubTo = (t, final) => {
    fill.style.width = pct(t);
    knob.style.left = pct(t);
    q(".pl-elapsed").textContent = clock(t);
    clearTimeout(scrubTimer);
    const wait = final ? 0 : 120 - (performance.now() - scrubLast);
    if (wait <= 0) { scrubLast = performance.now(); seek(t); } else scrubTimer = setTimeout(() => scrubTo(t, true), wait);
  };
  scrub.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || e.target.closest(".pl-mark")) return;
    state.dragging = true;
    wasPlaying = !shown().paused;
    if (wasPlaying) shown().pause();
    root.classList.add("pl-dragging");
    scrub.setPointerCapture(e.pointerId);
    scrubTo(timeAt(e.clientX), true);
  });
  scrub.addEventListener("pointermove", (e) => {
    const t = timeAt(e.clientX);
    hover.textContent = clock(t);
    hover.style.left = `${(100 * t) / state.duration}%`;
    if (state.dragging) scrubTo(t, false);
  });
  for (const type of ["pointerup", "pointercancel"]) {
    scrub.addEventListener(type, (e) => {
      if (!state.dragging) return;
      state.dragging = false;
      root.classList.remove("pl-dragging");
      if (type === "pointerup") scrubTo(timeAt(e.clientX), true);
      if (wasPlaying) play();
    });
  }
  scrub.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -5, ArrowRight: 5, PageDown: -60, PageUp: 60 }[e.key];
    if (step) { e.preventDefault(); e.stopPropagation(); seek(now() + step); }
    else if (e.key === "Home") { e.preventDefault(); seek(0); }
    else if (e.key === "End") { e.preventDefault(); seek(state.duration); }
  });

  // ---------------------------------------------------------------- the rest of the controls
  playBtn.addEventListener("click", toggle);
  bigPlay.addEventListener("click", (e) => { e.stopPropagation(); play(); });
  screen.addEventListener("click", (e) => { if (!e.target.closest("button")) toggle(); });
  for (const b of viewsBox.children) b.addEventListener("click", (e) => { e.stopPropagation(); setView(b.dataset.view); });
  q(".pl-full").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (screen.requestFullscreen) screen.requestFullscreen().catch(() => {});
    else if (shown().webkitEnterFullscreen) shown().webkitEnterFullscreen();   // iPhone: only a video goes full screen
  });
  for (const view of VIEWS) {
    const video = videos[view], front = () => view === state.view;
    video.addEventListener("timeupdate", () => { if (front() && !state.dragging) { paint(now()); syncBehind(); } });
    video.addEventListener("seeked", () => { if (front() && !state.dragging) { paint(now()); syncBehind(true); } });
    video.addEventListener("play", () => { if (front()) { paint(now()); syncBehind(); } });
    video.addEventListener("pause", () => { if (front()) { paint(now()); syncBehind(); } });
    video.addEventListener("ratechange", () => { if (front()) paint(now()); });
    video.addEventListener("waiting", () => { if (front()) screen.classList.add("pl-waiting"); });
    for (const type of ["playing", "canplay", "seeked"]) video.addEventListener(type, () => { if (front()) screen.classList.remove("pl-waiting"); });
  }

  // keys, wherever the focus is but in a field: Space plays, ←/→ 5 s, 1-5 a speed, F skim, V the other video
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !state.sources.raw || root.offsetParent === null) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    if (!menu.hidden) return;
    const onButton = ["BUTTON", "A"].includes(document.activeElement?.tagName) && !root.contains(document.activeElement);
    if (e.key === " " && !onButton) { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowLeft" && document.activeElement !== scrub) { e.preventDefault(); seek(now() - 5); }
    else if (e.key === "ArrowRight" && document.activeElement !== scrub) { e.preventDefault(); seek(now() + 5); }
    else if (/^[1-5]$/.test(e.key)) setSpeed(SPEEDS[Number(e.key) - 1]);
    else if ((e.key === "f" || e.key === "F") && state.windows.length) { if (state.skim) setSpeed(state.speed); else setSkim(true); }
    else if ((e.key === "v" || e.key === "V") && has("plan_idm")) setView(other(state.view));
  }
  document.addEventListener("keydown", onKey);

  // ---------------------------------------------------------------- loading an episode
  function load({ sources, duration, startAt = 0, marks = [], bands = [], windows = [], autoplay = true, skim }) {
    state.sources = sources;
    state.duration = Math.max(1, duration);
    state.marks = marks;
    state.windows = windows;
    if (skim !== undefined) state.skim = skim && windows.length > 0;
    else if (!windows.length) state.skim = false;
    if (!has(state.view)) setView("raw");
    viewsBox.hidden = !has("plan_idm");
    q(".pl-total").textContent = clock(state.duration);
    scrub.setAttribute("aria-valuemax", String(Math.round(state.duration)));
    drawMarks();
    drawBands(bands);
    renderRate();
    state.pending = startAt;
    paint(startAt);
    screen.classList.add("pl-waiting");
    const ticket = ++state.load;
    for (const view of VIEWS) {
      const video = videos[view];
      video.pause();
      if (!has(view)) { video.removeAttribute("src"); video.load(); continue; }
      video.src = sources[view];
      video.addEventListener("loadedmetadata", () => {
        if (ticket !== state.load) return;
        video.currentTime = toVideo(view, Math.min(startAt, video.duration || startAt));
        video.playbackRate = state.skim ? rateAt(startAt) : state.speed;
        if (view === state.view) {
          state.pending = null;
          if (autoplay) play();
          if (state.skim) requestAnimationFrame(skimTick);
        }
      }, { once: true });
    }
  }

  function unload() {
    state.load++;
    state.sources = {};
    closeMenu();
    for (const video of Object.values(videos)) { video.pause(); video.removeAttribute("src"); video.load(); }
    screen.classList.remove("pl-waiting");
  }

  renderRate();
  return {
    load, unload, seek, play, pause, toggle, setView, setSkim, setSpeed, now, clock,
    get view() { return state.view; },
    get paused() { return shown().paused; },
    overlay: q(".pl-overlay"),
    views: viewsBox,
    screen,
  };
}
