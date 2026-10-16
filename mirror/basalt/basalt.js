"use strict";
// The BASALT episode viewer: FindCave and MakeWaterfall, each with the supervised and the self-improving V2A model on
// the same 11 worlds. Every value from the data file is set with textContent or an SVG attribute: no HTML is ever
// built from data. On MakeWaterfall both videos of an episode play together (the side-by-side one transparent behind
// the shown one), so switching views is instant.

const VIDEO_BASE = "https://huggingface.co/datasets/hwryu/mirror_diamond_eval/resolve/main";
// the task and its success rule, in the paper's words (Appendix: BASALT)
const TASKS = {
  findcave: { title: "FindCave", goal: "Find a cave and go inside.", rule: "Success: the agent enters a cave or ravine. Up to 3 minutes." },
  waterfall: { title: "MakeWaterfall", goal: "Build a waterfall, then take a picture of it.",
    rule: "Success: the agent places the water bucket and ends the episode facing the waterfall. Up to 5 minutes." },
};
const VERSIONS = { supervised: "Supervised", self_improving: "Self-improving" };
// what each version used: [label, used, detail]
// (neither used task rewards: that is said once, under the goal, rather than as a row in both)
const FACTS = {
  supervised: [["Expert action labels", true, "VPT human gameplay"], ["Environment interaction", false, ""]],
  self_improving: [["Expert action labels", false, "video only"], ["Environment interaction", true, "~5 hours of self-play"]],
};
const SPEEDS = [1, 2, 4, 8, 16];
const VIEWS = ["raw", "plan_idm"];
const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
  index: null, tab: "findcave", version: "supervised", number: null, episode: null, view: "raw", speed: 1,
  timeline: null, pendingStart: null, sort: { findcave: { column: 0, ascending: true }, waterfall: { column: 0, ascending: true } },
};
const $ = (id) => document.getElementById(id);
const videos = { raw: $("video-raw"), plan_idm: $("video-plan_idm") };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function svg(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function clock(seconds) {
  if (seconds == null || !isFinite(seconds)) return "–";
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
const worldLabel = (n) => `World ${String(n + 1).padStart(2, "0")}`;
// (PR #4) MakeWaterfall: where the agent counts as having pressed Esc (a gray screen of its video plan after a second of
// movement input, or the time limit); success is judged on the frame before it. The video may go on past it.
const endsEarly = (episode) => episode.end != null && episode.end < episode.seconds - 0.1;

// ------------------------------------------------------------------ the videos, kept in step
const otherView = (view) => (view === "raw" ? "plan_idm" : "raw");
const shown = () => videos[state.view];
const behind = () => videos[otherView(state.view)];
const views = () => state.episode?.views ?? ["raw"];
const now = () => state.pendingStart ?? (shown().currentTime || 0);

function syncBehind(force = false) {
  const front = shown(), back = behind();
  if (!back.src || back.readyState < 1) return;
  if (front.playbackRate > 4) {  // fast playback: only the shown video streams; the other catches up on a switch
    if (!back.paused) back.pause();
    return;
  }
  if (force || (!back.seeking && Math.abs(back.currentTime - front.currentTime) > 0.35)) back.currentTime = front.currentTime;
  if (back.playbackRate !== front.playbackRate) back.playbackRate = front.playbackRate;
  if (front.paused && !back.paused) back.pause();
  if (!front.paused && back.paused) back.play().catch(() => {});
}

function setView(view) {
  if (view === state.view) return;
  const t = now(), playing = !shown().paused, rate = shown().playbackRate;
  state.view = view;
  for (const v of VIEWS) {
    const video = videos[v], front = v === view;
    video.classList.toggle("ev-back", !front);
    video.controls = front;
    video.muted = !front;
    video.tabIndex = front ? 0 : -1;
  }
  const front = shown();
  front.playbackRate = rate;
  if (front.readyState >= 1 && Math.abs(front.currentTime - t) > 0.25) front.currentTime = t;
  if (playing && front.paused) front.play().catch(() => {});
  syncBehind();
  for (const button of document.querySelectorAll("#view-toggle button")) {
    button.setAttribute("aria-selected", String(button.dataset.view === view));
  }
}

function seek(t) {
  const episode = state.episode;
  if (!episode) return;
  const target = Math.max(0, Math.min(t, episode.seconds));
  for (const video of Object.values(videos)) if (video.readyState >= 1) video.currentTime = target;
  if (shown().readyState < 1) state.pendingStart = target;
  updateNow();
}

function setSpeed(speed) {
  state.speed = speed;
  for (const video of Object.values(videos)) video.playbackRate = speed;
  syncBehind(true);
  for (const button of $("speeds").children) button.classList.toggle("ev-on", Number(button.dataset.speed) === speed);
}

function loadVideos(startAt) {
  const folder = state.index[state.tab][state.version].folder;
  const number = String(state.number).padStart(2, "0");
  if (!views().includes(state.view)) setView("raw");
  $("view-toggle").hidden = views().length < 2;
  state.pendingStart = startAt;
  const screen = document.querySelector(".ev-screen");
  screen.classList.add("ev-loading");
  // a load superseded by a quicker switch (another world or model) must not seek or reveal the new one
  const load = state.load = (state.load || 0) + 1;
  for (const view of VIEWS) {
    const video = videos[view];
    video.pause();
    if (!views().includes(view)) {
      video.removeAttribute("src");
      video.load();
      continue;
    }
    video.src = `${VIDEO_BASE}/${folder}/${view}/${number}.mp4`;
    video.playbackRate = state.speed;
    video.addEventListener("loadedmetadata", () => {
      if (load !== state.load) return;
      video.currentTime = Math.min(startAt, video.duration || startAt);
      video.playbackRate = state.speed;
      if (view === state.view) state.pendingStart = null;
    }, { once: true });
    video.addEventListener("loadeddata", () => { if (load === state.load && view === state.view) screen.classList.remove("ev-loading"); }, { once: true });
  }
}

function unloadVideos() {
  for (const video of Object.values(videos)) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

// ------------------------------------------------------------------ tabs, the two versions and the table
function showTab(tab) {
  state.tab = tab;
  for (const button of document.querySelectorAll(".ev-tabs button")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  }
  $("goal").replaceChildren(el("strong", { text: TASKS[tab].goal }), ` ${TASKS[tab].rule} Neither model is given a task reward.`);
  renderVersions();
  renderTable();
}

// (PR #4) the two versions as cards; the selected one is the table's (the user, 10-15: click a card to switch, never
// mixed). Each card is a tab of the "Version" tablist: a click, or Enter / Space when it has the focus, selects it.
function renderVersions() {
  const tab = state.tab;
  $("versions").replaceChildren(...Object.entries(VERSIONS).map(([version, title]) => {
    const episodes = state.index[tab][version].episodes;
    const wins = episodes.filter((e) => e.success).length;
    const bar = el("span");
    bar.style.width = `${(100 * wins) / episodes.length}%`;
    // (PR #4) each fact on one line; on a narrower card its detail moves under the name whole (basalt.css)
    return el("div", {
      class: `ev-version ev-tile ev-${version}`, role: "tab", tabindex: "0", "aria-selected": String(version === state.version),
      onclick: () => selectVersion(version),
      onkeydown: (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectVersion(version); }
      },
    },
      el("h2", { text: title }),
      el("div", { class: "ev-count" }, String(wins), el("small", { text: ` of ${episodes.length} worlds` })),
      el("div", { class: "ev-bar" }, bar),
      el("ul", { class: "ev-facts" }, ...factItems(version)));
  }));
  // (cards 10-16) on phones the cards are a two-up switch without their checklists; the selected one's shows under them
  $("version-facts").replaceChildren(...factItems(state.version));
}

function factItems(version) {
  return FACTS[version].map(([name, used, detail]) => el("li", {
    class: used ? "ev-yes" : "ev-no", "aria-label": `${name}: ${used ? "yes" : "no"}${detail ? `, ${detail}` : ""}`,
  }, el("span", { class: "ev-fact-name", text: name }), ...(detail ? [el("span", { class: "ev-fact-detail", text: detail })] : [])));
}

function selectVersion(version) {
  if (version === state.version) return;
  state.version = version;
  const focused = $("versions").contains(document.activeElement);   // (keyboard: the new card keeps the focus)
  renderVersions();
  renderTable();
  if (focused) $("versions").querySelector(`.ev-${version}`).focus({ preventScroll: true });
  if ($("viewer").hidden) EMBED.setHash(`#${state.tab}/${version}`);
}

// (PR #4) the selected version's 11 episodes, sortable; fixed column widths (basalt.css), the same on both tabs and
// versions. Headings are buttons and rows take the focus, as in the Diamond table.
const outcomeCell = (r) => [el("span", { class: `ev-outcome ${r.success ? "ev-success" : "ev-failure"}` },
  el("span", { class: "ev-glyph", "aria-hidden": "true", text: r.success ? "✓" : "✗" }), r.success ? " Success" : " No success")];
const COLUMNS = [
  { label: "World", value: (r) => r.n, cell: (r) => [el("span", { class: "ev-long", text: "World " }), String(r.n + 1).padStart(2, "0")] },
  { label: "Outcome", value: (r) => (r.success ? 0 : 1), cell: outcomeCell },
  { label: "Success at", number: true, value: (r) => r.success_time ?? Infinity, text: (r) => (r.success_time != null ? clock(r.success_time) : "–") },
  { label: "Length", number: true, value: (r) => r.seconds, text: (r) => clock(r.seconds) },
];

function rowsOf(tab) {
  return state.index[tab][state.version].episodes.map((e) => ({ ...e, version: state.version }));
}

function renderTable() {
  const sort = state.sort[state.tab];
  const column = COLUMNS[sort.column];
  const rows = rowsOf(state.tab).sort((a, b) => {
    const va = column.value(a), vb = column.value(b);
    const order = va === vb ? 0 : va < vb ? -1 : 1;
    return (sort.ascending ? order : -order) || a.n - b.n;
  });
  $("episodes-head").replaceChildren(el("tr", {}, ...COLUMNS.map((c, index) => {
    const sorted = index === sort.column;
    const th = el("th", {
      class: [c.number ? "ev-number" : "", sorted ? `ev-sorted${sort.ascending ? " ev-ascending" : ""}` : ""].join(" ").trim(),
    }, el("button", { class: "ev-sort", type: "button", "aria-label": c.label, onclick: () => {
      state.sort[state.tab] = { column: index, ascending: sorted ? !sort.ascending : true };
      renderTable();
    } }, c.label));
    if (sorted) th.setAttribute("aria-sort", sort.ascending ? "ascending" : "descending");
    return th;
  })));
  const open = (r) => openEpisode(r.version, r.n);
  $("episodes-body").replaceChildren(...rows.map((r) => el("tr", {
    "data-key": `${r.version}/${r.n}`, tabindex: "0",
    class: !$("viewer").hidden && r.n === state.number ? "ev-current" : "",
    "aria-label": `${worldLabel(r.n)}, ${VERSIONS[r.version]}: ${r.success ? "success" : "no success"}${r.success_time != null ? ` at ${clock(r.success_time)}` : ""}`,
    onclick: () => open(r),
    onkeydown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(r); } },
  }, ...COLUMNS.map((c) => el("td", { class: c.number ? "ev-number" : "" }, ...(c.cell ? c.cell(r) : [c.text(r)]))))));
}

// ------------------------------------------------------------------ the episode window
function openEpisode(version, number, { startAt = 0 } = {}) {
  const episodes = state.index[state.tab][version].episodes;
  const episode = episodes[number];
  if (!episode) return;
  if (version !== state.version) {   // (PR #4) the table follows the version on show
    state.version = version;
    renderVersions();
    renderTable();
  }
  state.number = number;
  state.episode = episode;
  for (const row of $("episodes-body").children) row.classList.toggle("ev-current", row.dataset.key === `${version}/${number}`);
  // the head: the task in grey, the world, and the outcome; the model is the toggle under it
  $("ep-task").textContent = TASKS[state.tab].title;
  $("ep-title").textContent = worldLabel(number);
  $("ep-meta").className = `ev-result ${episode.success ? "ev-success" : "ev-failure"}`;
  $("ep-meta").replaceChildren(el("span", { class: "ev-glyph", "aria-hidden": "true", text: episode.success ? "✓" : "✗" }),
    episode.end != null ? `${episode.success ? "Success" : "No success"} at the end (${clock(episode.end)})`
      : episode.success ? (episode.success_time != null ? `Success at ${clock(episode.success_time)}` : "Success") : "No success",
    ...(endsEarly(episode) ? [el("span", { class: "ev-runs-on", text: `the video runs on to ${clock(episode.seconds)}` })] : []));
  $("ep-prev").disabled = number === 0;
  $("ep-next").disabled = number === episodes.length - 1;
  // the two models on this world: a segmented control, each with its outcome
  // (the buttons stay, so the selection glides as the page's segmented controls do)
  for (const button of $("version-toggle").children) {
    const v = button.dataset.version, e = state.index[state.tab][v].episodes[number];
    button.setAttribute("aria-selected", String(v === version));
    button.setAttribute("aria-label", `${VERSIONS[v]}: ${e.success ? "success" : "no success"}`);
    button.firstChild.className = `ev-glyph ${e.success ? "ev-success" : "ev-failure"}`;
    button.firstChild.textContent = e.success ? "✓" : "✗";
  }
  // where to look: the success, or for MakeWaterfall (judged on the whole episode) the final view
  const moment = momentOf(episode);
  $("to-moment").hidden = !moment;
  if (moment) $("to-moment").textContent = moment.label;
  // the key at the left, the keyboard shortcuts at the right (only where there is a keyboard), as the Diamond viewer's
  $("legend").replaceChildren(
    ...(episode.success_time != null ? [el("span", { class: "ev-key ev-key-done", text: "After the success" })] : []),
    ...(!episode.success && endsEarly(episode) ? [el("span", { class: "ev-key ev-key-failed", text: "After the end, no success" })] : []),
    // (PR #4) MakeWaterfall: the episode ends where the agent counts as pressing Esc; success is judged just before it
    ...(episode.end != null ? [el("span", { class: "ev-key ev-key-end", text: "End: the first gray video plan after a second of movement, or the time limit" })] : []),
    el("span", { class: "ev-keys", text: "Click or drag to jump · Space play · ←/→ 5 s · O other model" +
      (episode.views.length > 1 ? " · V switch video" : "") }));
  EMBED.setHash(`#${state.tab}/${version}/${number + 1}`);
  const opening = $("viewer").hidden;
  $("viewer").hidden = false;
  document.documentElement.classList.add("ev-locked");
  if (opening) $("viewer").scrollTop = 0;
  if (opening) holdFocus(true);
  drawTimeline();
  loadVideos(startAt);
  updateNow();
}

// The episode window is a dialog: while it is open the list behind it can't take the focus (a key that opened an
// episode used to leave the focus on its row, so Tab walked the hidden list), and closing it gives the focus back.
let opener = null;
function holdFocus(open) {
  for (const e of document.querySelectorAll("body > nav, body > main, body > footer")) e.inert = open;
  if (open) {
    opener = document.activeElement;
    ($("back").offsetParent ? $("back") : $("close")).focus({ preventScroll: true });   // (the one shown: embedded, or on its own page)
  } else if (opener && document.contains(opener) && document.hasFocus()) opener.focus({ preventScroll: true });
  if (!open) opener = null;
}

function closeViewer() {
  if (!$("viewer").hidden) holdFocus(false);
  unloadVideos();
  $("viewer").hidden = true;
  document.documentElement.classList.remove("ev-locked");
  state.episode = null;
  for (const row of $("episodes-body").children) row.classList.remove("ev-current");
  EMBED.setHash(`#${state.tab}/${state.version}`);
}

function momentOf(episode) {
  if (episode.success_time != null && episode.end == null) return { label: "Jump to the success", t: episode.success_time - 8 };
  if (episode.end != null) return { label: "Jump to the end", t: episode.end - 20 };
  return null;
}

// a slim bar: the part after the success in green with its time above, the playhead, and a minute axis
// (10-15: was a 120 px lane with "episode" and "health 20" labels; no BASALT episode has health or deaths)
function drawTimeline() {
  const episode = state.episode, node = $("timeline");
  node.replaceChildren();
  const width = Math.max(260, Math.round(node.getBoundingClientRect().width) || 1000), height = 60;
  node.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const left = 18, right = 18, plotWidth = width - left - right, barTop = 25, barHeight = 8;
  const duration = Math.max(1, episode.seconds);
  const x = (t) => left + (Math.min(Math.max(t, 0), duration) / duration) * plotWidth;
  node.append(svg("rect", { class: "track", x: left, y: barTop, width: plotWidth, height: barHeight, rx: barHeight / 2 }));
  const played = svg("rect", { class: "played", x: left, y: barTop, width: 0, height: barHeight, rx: barHeight / 2 });
  node.append(played);
  // (PR #4) on MakeWaterfall the success is judged at the episode's end: the end is marked, not a success moment.
  // What follows the verdict is coloured to the video's end (the user, 10-16): green after a success, red after an
  // early end without one.
  if (episode.success_time != null) {
    const sx = x(episode.success_time);
    const band = svg("rect", { class: "done", x: sx, y: barTop, width: Math.max(2, x(duration) - sx), height: barHeight, rx: barHeight / 2 });
    band.append(svg("title", {}, `success from ${clock(episode.success_time)}`));
    node.append(band);
  } else if (endsEarly(episode)) {
    const band = svg("rect", { class: "failed", x: x(episode.end), y: barTop, width: Math.max(2, x(duration) - x(episode.end)), height: barHeight, rx: barHeight / 2 });
    band.append(svg("title", {}, `no success: the episode ended at ${clock(episode.end)}`));
    node.append(band);
  }
  const mark = (cls, t, label, title) => {
    const mx = x(t);
    const line = svg("line", { class: cls, x1: mx, x2: mx, y1: barTop - 6, y2: barTop + barHeight + 2 });
    line.append(svg("title", {}, title));
    node.append(line);
    const anchor = mx < left + 50 ? "start" : mx > width - right - 50 ? "end" : "middle";
    node.append(svg("text", { class: `${cls}-label`, x: mx, y: barTop - 10, "text-anchor": anchor }, label));
  };
  if (episode.success_time != null && episode.end == null) {
    mark("success", episode.success_time, `Success ${clock(episode.success_time)}`, `success at ${clock(episode.success_time)}`);
  }
  if (episode.end != null) {
    mark(episode.success ? "success" : "end", episode.end, `${episode.success ? "Success" : "No success"} at the end ${clock(episode.end)}`,
      `the episode's end (Esc) at ${clock(episode.end)}`);
  }
  const step = width < 520 ? 60 : duration > 240 ? 60 : 30;
  for (let t = 0; t <= duration + 0.5; t += step) {
    node.append(svg("text", { class: "tick-label", x: x(t), y: barTop + barHeight + 18,
      "text-anchor": t === 0 ? "start" : x(t) > width - right - 12 ? "end" : "middle" }, clock(t)));
  }
  const playhead = svg("g", { class: "playhead" });   // a line with a 4 px knob at its top, as the Diamond viewer's
  playhead.append(svg("line", { x1: 0, x2: 0, y1: barTop - 4, y2: barTop + barHeight + 4 }), svg("circle", { cx: 0, cy: barTop - 4, r: 4 }));
  node.append(playhead);
  state.timeline = { x, left, plotWidth, duration, playhead, played };
}

function updateNow() {
  const episode = state.episode, timeline = state.timeline;
  if (!episode || !timeline) return;
  const px = timeline.x(now());
  timeline.playhead.setAttribute("transform", `translate(${px} 0)`);
  timeline.played.setAttribute("width", Math.max(0, px - timeline.left));
  $("timeline").classList.toggle("ev-done", episode.success_time != null && now() >= episode.success_time);
}

// ------------------------------------------------------------------ wiring
function setup() {
  $("speeds").append(...SPEEDS.map((speed) => el("button", {
    text: `${speed}×`, "data-speed": String(speed), class: speed === state.speed ? "ev-on" : "", onclick: () => setSpeed(speed),
  })));
  for (const button of document.querySelectorAll(".ev-tabs button")) {
    button.addEventListener("click", () => {
      if (button.dataset.tab === state.tab) return;
      showTab(button.dataset.tab);
      EMBED.setHash(`#${state.tab}/${state.version}`);
    });
  }
  $("version-toggle").append(...Object.entries(VERSIONS).map(([v, title]) => el("button", {
    role: "tab", "data-version": v, onclick: () => { if (v !== state.version) openEpisode(v, state.number); },
  }, el("span", { class: "ev-glyph", "aria-hidden": "true" }), title)));
  for (const button of document.querySelectorAll("#view-toggle button")) button.addEventListener("click", () => setView(button.dataset.view));
  videos.plan_idm.classList.add("ev-back");
  $("ep-prev").addEventListener("click", () => openEpisode(state.version, state.number - 1));
  $("ep-next").addEventListener("click", () => openEpisode(state.version, state.number + 1));
  $("close").addEventListener("click", closeViewer);
  $("back").addEventListener("click", closeViewer);
  $("viewer").addEventListener("click", (event) => { if (event.target === $("viewer")) closeViewer(); });
  $("to-moment").addEventListener("click", () => {
    const moment = state.episode && momentOf(state.episode);
    if (!moment) return;
    seek(moment.t);
    if (shown().paused) shown().play().catch(() => {});
  });
  for (const view of VIEWS) {
    const video = videos[view];
    const front = () => view === state.view;
    video.addEventListener("timeupdate", () => { if (front()) { updateNow(); syncBehind(); } });
    video.addEventListener("seeked", () => { if (front()) { updateNow(); syncBehind(true); } });
    video.addEventListener("play", () => { if (front()) syncBehind(); });
    video.addEventListener("pause", () => { if (front()) syncBehind(); });
    video.addEventListener("ratechange", () => { if (front() && video.playbackRate !== state.speed) setSpeed(video.playbackRate); });
  }
  // click or drag on the bar to move through the episode
  const seekTo = (event) => {
    const timeline = state.timeline;
    if (!timeline) return;
    const box = $("timeline").getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * Number($("timeline").viewBox.baseVal.width);
    seek(((px - timeline.left) / timeline.plotWidth) * timeline.duration);
  };
  $("timeline").addEventListener("pointerdown", (event) => {
    $("timeline").setPointerCapture(event.pointerId);
    seekTo(event);
  });
  $("timeline").addEventListener("pointermove", (event) => { if ($("timeline").hasPointerCapture(event.pointerId)) seekTo(event); });
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.episode) { drawTimeline(); updateNow(); } }, 150);
  });
  // in the project page's modal, Esc with no episode open closes the modal
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (!state.episode || $("viewer").hidden)) EMBED.escape();
  });
  EMBED.listen({
    "mirror-route": ({ hash }) => route(hash),
    // the next opening starts the list from its top, not where it was left: scrolled once the sheet has faded out
    // (js/modal.js hides it after .42 s; a frame that is display: none doesn't scroll)
    "mirror-closed": () => {
      if (state.episode) closeViewer();
      setTimeout(() => window.scrollTo({ top: 0, behavior: "instant" }), 450);
    },
  });
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || !state.episode || $("viewer").hidden) return;
    const onVideo = document.activeElement === shown();
    if (event.key === "Escape") closeViewer();
    else if (event.key === "ArrowLeft" && !onVideo) { event.preventDefault(); seek(now() - 5); }
    else if (event.key === "ArrowRight" && !onVideo) { event.preventDefault(); seek(now() + 5); }
    else if (/^[1-5]$/.test(event.key)) setSpeed(SPEEDS[Number(event.key) - 1]);
    else if ((event.key === "v" || event.key === "V") && views().length > 1) setView(otherView(state.view));
    else if (event.key === "o" || event.key === "O") openEpisode(state.version === "supervised" ? "self_improving" : "supervised", state.number);
    else if (event.key === " " && !onVideo && !["BUTTON", "A"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      if (shown().paused) shown().play().catch(() => {}); else shown().pause();
    }
  });
}

// #waterfall, #waterfall/self_improving, or #waterfall/self_improving/3@60: a task, a version, a world (from 1), a time
function route(hash) {
  const [where, at] = decodeURIComponent(hash.replace(/^#/, "")).split("@");
  const [tab, version, number] = where.split("/");
  if (state.episode) closeViewer();
  if (version in VERSIONS) state.version = version;
  showTab(tab in TASKS ? tab : "findcave");
  if (tab in TASKS && version in VERSIONS && number) {
    const last = state.index[tab][version].episodes.length - 1;
    openEpisode(version, Math.min(last, Math.max(0, (Number(number) || 1) - 1)), { startAt: Number(at) || 0 });
  }
}

async function start() {
  setup();
  const response = await fetch("data/index.json");
  if (!response.ok) throw new Error(`episode list: HTTP ${response.status}`);
  state.index = await response.json();
  route(location.hash);
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("ev-ready")));
}

start().catch((error) => {
  $("episodes-body").replaceChildren(el("tr", {}, el("td", { text: `The episodes could not be loaded: ${error.message ?? error}` })));
});
