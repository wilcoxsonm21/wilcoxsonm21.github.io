"use strict";
// The evaluation episode viewer. Every value from the data files is set with textContent or an SVG attribute: no HTML
// is ever built from data. Both videos of an episode play together (the hidden one transparent behind the shown one),
// so switching between the recording and the executed + plan view is instant.

const VIDEO_BASE = "https://huggingface.co/datasets/hwryu/mirror_diamond_eval/resolve/main";
const PLAN_LAG = 0.05;  // the recording starts one frame (the world's first view) before the first executed step
const TAB_TITLE = { offline: "Offline (Generative VP)", online: "Online (Generative VP)", oracle: "Online (Oracle VP)" };
// what each tab's agent used, in the paper's terms (Section 4 and the caption of Figure 4): [label, used, detail]; the
// tab names the video planner and the table shows the episodes, so neither is repeated here
const TAB_FACTS = {
  offline: [
    ["Expert action labels", true, "VPT human gameplay"],
    ["Environment interaction", false, ""],
    ["Task rewards", false, ""],
  ],
  online: [
    ["Expert action labels", false, "video only"],
    ["Environment interaction", true, "~140 in-game hours (10M steps)"],
    ["Task rewards", false, ""],
  ],
  oracle: [
    ["Expert action labels", false, "video only"],
    ["Environment interaction", true, "~80 in-game hours"],
    ["Task rewards", false, ""],
  ],
};
const MILESTONE_NAMES = {
  log: "log", planks: "planks", stick: "stick", crafting_table: "crafting table",
  place_crafting_table: "placed crafting table", wooden_pickaxe: "wooden pickaxe", cobblestone: "cobblestone",
  stone_pickaxe: "stone pickaxe", furnace: "furnace", iron_ore: "iron ore", place_furnace: "placed furnace",
  load_furnace: "loaded furnace", iron_ingot: "iron ingot", iron_pickaxe: "iron pickaxe", diamond: "diamond",
  pick_up_crafting_table: "pick up crafting table",
};
const MILESTONES = ["log", "planks", "stick", "crafting_table", "place_crafting_table", "wooden_pickaxe",
  "cobblestone", "stone_pickaxe", "furnace", "iron_ore", "place_furnace", "load_furnace", "iron_ingot",
  "iron_pickaxe", "diamond"];
// the paper's twelve acquisition milestones, each with its item icon
const PAPER_MILESTONES = ["log", "planks", "stick", "crafting_table", "wooden_pickaxe", "cobblestone",
  "stone_pickaxe", "furnace", "iron_ore", "iron_ingot", "iron_pickaxe", "diamond"];
const KEY_MILESTONES = ["crafting_table", "stone_pickaxe", "iron_ore", "iron_ingot", "iron_pickaxe", "diamond"];
const STAGES = ["log", "planks", "stick", "crafting_table", "place_crafting_table", "wooden_pickaxe",
  "pick_up_crafting_table", "cobblestone", "stone_pickaxe", "furnace", "iron_ore", "place_furnace", "load_furnace",
  "iron_ingot", "iron_pickaxe", "diamond"];
const STAGE_ICON = { place_crafting_table: "crafting_table", pick_up_crafting_table: "crafting_table",
  place_furnace: "furnace", load_furnace: "furnace" };
// a subgoal names an action where its milestone names a state (place furnace / placed furnace)
const SUBGOAL_NAMES = { place_crafting_table: "place crafting table", pick_up_crafting_table: "pick up crafting table",
  place_furnace: "place furnace", load_furnace: "load furnace" };
const subgoalName = (stage) => SUBGOAL_NAMES[stage] ?? MILESTONE_NAMES[stage] ?? stage.replaceAll("_", " ");
// the 16 subgoal captions the subgoal task planner gives the video planner
const SUBGOAL_CAPTIONS = {
  log: "Approach a tree trunk and chop it to collect logs.",
  planks: "Open the inventory and craft wood planks from logs.",
  stick: "Craft sticks using wood planks in the crafting grid.",
  crafting_table: "Open the inventory and craft a crafting table using wood planks.",
  place_crafting_table: "Place the crafting table on the ground.",
  wooden_pickaxe: "Open the crafting table interface and craft a wooden pickaxe.",
  pick_up_crafting_table: "Break the crafting table and pick it up.",
  cobblestone: "Mine stone blocks with the pickaxe to collect cobblestone.",
  stone_pickaxe: "Craft a stone pickaxe using cobblestone and sticks in the crafting grid.",
  furnace: "Craft a furnace using cobblestone in the crafting grid.",
  iron_ore: "Mine the iron ore block with the stone pickaxe.",
  place_furnace: "Place the furnace on the ground.",
  load_furnace: "Open the furnace interface and place iron ore and fuel inside.",
  iron_ingot: "Open the furnace interface and take the iron ingots from the output slot.",
  iron_pickaxe: "Craft an iron pickaxe using iron ingots and sticks in the crafting grid.",
  diamond: "Mine the diamond ore block with the iron pickaxe.",
};
const stageColor = (stage) => `hsl(${Math.round((STAGES.indexOf(stage) * 330) / STAGES.length)}, 62%, 72%)`;
const SPEEDS = [1, 2, 4, 8, 16];  // as basalt (10-15: 0.5x dropped); keys 1-5
const VIEWS = ["raw", "plan_idm"];
const CFG_TOP = 7, CFG_FLOOR = 0.01;  // the text CFG scale: 7 by default, 0.01 after damage
// fast-forward between subgoals: 1x from 3.5 s before each subgoal change (the subgoal task planner moves on once the
// inventory meets the subgoal's target, or starts over after a death) and the diamond to 2 s after it, 16x in between
const HIGHLIGHT = { before: 3.5, after: 1, fast: 16 };
const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
  index: null, tab: "offline", number: null, episode: null, view: "raw", speed: 1, timeline: null,
  pendingStart: null, highlight: false, windows: [], cache: new Map(), loading: 0,
  // the furthest milestone first by default (the user, 10-15); ties stay in episode order
  sort: { offline: { column: 1, ascending: false }, online: { column: 1, ascending: false }, oracle: { column: 1, ascending: false } },
};
const $ = (id) => document.getElementById(id);
const videos = { raw: $("video-raw"), plan_idm: $("video-plan_idm") };
// what a tab's episodes record: the oracle VP's have one video, no subgoals, no text CFG scale, no damage spells and
// no achievements
const features = () => state.index[state.tab].features;
// the videos of the open episode: its tab's, unless the episode lists fewer (a panel video that was never finished)
const views = () => state.episode?.views ?? features().views;

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
  const hours = Math.floor(whole / 3600), mins = Math.floor((whole % 3600) / 60), secs = whole % 60;
  return (hours ? `${hours}:${String(mins).padStart(2, "0")}` : `${mins}`) + `:${String(secs).padStart(2, "0")}`;
}
const label = (number) => `Episode ${String(number + 1).padStart(2, "0")}`;
const nameOf = (milestone) => MILESTONE_NAMES[milestone] ?? milestone.replaceAll("_", " ");
const iconOf = (item) => (PAPER_MILESTONES.includes(item) ? `icons/${item}.png` : null);
const icon = (item, cls = "") => (iconOf(item) ? [el("img", { src: iconOf(item), alt: "", class: cls })] : []);
// a death message after "died", or nothing where the log has none (the oracle VP)
const deathNote = (message) => (message ? `: ${message.replace(/^was /, "")}` : "");

function lastAtOrBefore(list, t) {
  let low = 0, high = list.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (list[middle][0] <= t) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}

// ------------------------------------------------------------------ the two videos, kept in step
const otherView = (view) => (view === "raw" ? "plan_idm" : "raw");
const toVideoTime = (view, t) => Math.max(0, view === "plan_idm" ? t - PLAN_LAG : t);
const toEpisodeTime = (view, t) => (view === "plan_idm" ? t + PLAN_LAG : t);
const shown = () => videos[state.view];
const behind = () => videos[otherView(state.view)];
const now = () => state.pendingStart ?? toEpisodeTime(state.view, shown().currentTime || 0);

function syncBehind(force = false) {
  const front = shown(), back = behind();
  if (!back.src || back.readyState < 1) return;
  if (front.playbackRate > 4) {  // fast-forwarding: only the shown video streams; the other catches up on a switch
    if (!back.paused) back.pause();
    return;
  }
  const target = toVideoTime(otherView(state.view), toEpisodeTime(state.view, front.currentTime));
  if (force || (!back.seeking && Math.abs(back.currentTime - target) > 0.35)) back.currentTime = target;
  if (back.playbackRate !== front.playbackRate) back.playbackRate = front.playbackRate;
  if (front.paused && !back.paused) back.pause();
  if (!front.paused && back.paused) back.play().catch(() => {});
}

function setView(view) {
  if (view === state.view) return;
  const t = now();
  const playing = !shown().paused;
  const rate = shown().playbackRate;
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
  if (front.readyState >= 1 && Math.abs(toEpisodeTime(view, front.currentTime) - t) > 0.25) front.currentTime = toVideoTime(view, t);
  if (playing && front.paused) front.play().catch(() => {});
  syncBehind();
  for (const button of document.querySelectorAll(".ev-view button")) {
    button.setAttribute("aria-selected", String(button.dataset.view === view));
  }
}

function seek(t) {
  const episode = state.episode;
  if (!episode) return;
  const target = Math.max(0, Math.min(t, episode.seconds));
  for (const view of VIEWS) {
    const video = videos[view];
    if (video.readyState >= 1) video.currentTime = toVideoTime(view, target);
  }
  if (shown().readyState < 1) state.pendingStart = target;
  updateNow();
}

function applyRate(rate) {
  for (const video of Object.values(videos)) video.playbackRate = rate;
  syncBehind(true);
}

function loadVideos(startAt) {
  const folder = state.index[state.tab].folder;
  const number = String(state.number).padStart(2, "0");
  if (!views().includes(state.view)) setView("raw");
  $("view-toggle").hidden = views().length < 2;
  state.pendingStart = startAt;
  for (const view of VIEWS) {
    const video = videos[view];
    video.pause();
    if (!views().includes(view)) {
      video.removeAttribute("src");
      video.load();
      continue;
    }
    video.src = `${VIDEO_BASE}/${folder}/${view}/${number}.mp4`;
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = toVideoTime(view, Math.min(startAt, video.duration || startAt));
      video.playbackRate = state.highlight ? rateAt(startAt) : state.speed;
      if (view === state.view) state.pendingStart = null;
    }, { once: true });
  }
}

function unloadVideos() {
  for (const video of Object.values(videos)) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

// ------------------------------------------------------------------ fast-forward between subgoals
function keyMoments(episode) {
  // every subgoal change (a completion, or the restart after a death), and the diamond on its own: it ends the task;
  // without subgoals (the oracle VP), the first acquisition of each milestone
  const times = episode.stages.length
    ? episode.stages.slice(1).map(([t]) => t)
    : PAPER_MILESTONES.filter((m) => m in episode.milestones && m !== "diamond").map((m) => episode.milestones[m]);
  if ("diamond" in episode.milestones) times.push(episode.milestones.diamond);
  return times.sort((a, b) => a - b);
}

function highlightWindows(episode) {
  const windows = [];
  for (const t of keyMoments(episode)) {
    const start = Math.max(0, t - HIGHLIGHT.before), end = t + HIGHLIGHT.after;
    if (windows.length && start <= windows[windows.length - 1][1]) windows[windows.length - 1][1] = end;
    else windows.push([start, end]);
  }
  return windows;
}

function rateAt(t) {
  const next = state.windows.find(([, end]) => t < end);
  if (!next) return HIGHLIGHT.fast;
  // slow down a hair early (0.8 s of game time): at 16x a few frames pass before the new rate takes hold
  return t >= next[0] - HIGHLIGHT.fast * 0.05 ? 1 : HIGHLIGHT.fast;
}

function highlightTick() {
  if (!state.highlight) return;
  const video = shown();
  if (state.episode && !video.paused && !video.seeking) {
    const rate = rateAt(now());
    if (video.playbackRate !== rate) applyRate(rate);
  }
  requestAnimationFrame(highlightTick);
}

function setHighlight(on) {
  state.highlight = on;
  $("highlight").setAttribute("aria-pressed", String(on));
  // while fast-forward runs, the speed it goes back to stays marked, dimmed (ev-base), so the control never looks unset
  for (const button of $("speeds").children) {
    const mine = Number(button.dataset.speed) === state.speed;
    button.classList.toggle("ev-on", !on && mine);
    button.classList.toggle("ev-base", on && mine);
  }
  if (on) {
    applyRate(rateAt(now()));
    requestAnimationFrame(highlightTick);
  } else applyRate(state.speed);
  if (state.episode) drawTimeline();
  updateNow();
}

function setSpeed(speed) {
  state.speed = speed;
  if (state.highlight) setHighlight(false);
  applyRate(speed);
  for (const button of $("speeds").children) button.classList.toggle("ev-on", Number(button.dataset.speed) === speed);
}

// ------------------------------------------------------------------ tabs, milestone tiles and the episode table
function showTab(tab) {
  state.tab = tab;
  for (const button of document.querySelectorAll(".ev-tabs button")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  }
  const arm = state.index[tab];
  const total = arm.episodes.length;
  const f = arm.features;
  $("arm-facts").replaceChildren(...TAB_FACTS[tab].map(([name, used, detail]) => el("li", {
    class: used ? "ev-yes" : "ev-no", "aria-label": `${name}: ${used ? "yes" : "no"}${detail ? `, ${detail}` : ""}`,
  }, el("span", { class: "ev-fact-name", text: name }), ...(detail ? [el("span", { class: "ev-fact-detail", text: detail })] : []))));
  $("view-toggle").hidden = f.views.length < 2;
  $("section-stages").hidden = !f.subgoals;
  // "between …" goes on a phone (eval.css), so the toggle shares the speed control's row
  $("highlight").replaceChildren("Fast-forward", el("span", { class: "ev-long", text: f.subgoals ? " between subgoals" : " between milestones" }));
  $("highlight").title = f.subgoals
    ? "Plays at 1× from 3.5 s before to 1 s after each subgoal change (and the diamond), and at 16× in between"
    : "Plays at 1× from 3.5 s before to 1 s after each acquisition milestone, and at 16× in between";
  // a short key to the timeline; the keyboard shortcuts only where there is a keyboard (eval.css hides .ev-keys on touch)
  $("legend").replaceChildren(
    ...(f.subgoals ? [el("span", { class: "ev-key ev-key-subgoal", text: "Subgoal the agent was given" })] : []),
    el("span", { class: "ev-key ev-key-health", text: "Health" }),
    ...(f.damage ? [el("span", { class: "ev-key ev-key-damage", text: "Taking damage" })] : []),
    el("span", { class: "ev-key ev-key-death", text: "Died" }),
    el("span", { class: "ev-key ev-key-item", text: "Item first obtained" }),
    el("span", { class: "ev-keys", text: `Click or drag to jump · Space play · ←/→ 5 s · F fast-forward${f.views.length > 1 ? " · V switch video" : ""}` }));
  // the six milestone tiles stay in place across tabs, so their counts and bars change where they are
  if ($("rates").children.length !== KEY_MILESTONES.length) {
    $("rates").replaceChildren(...KEY_MILESTONES.map((milestone) => el("div", { class: `ev-rate ev-tile${milestone === "diamond" ? " ev-diamond" : ""}` },
      ...icon(milestone),
      el("div", { class: "ev-count" }, el("span"), el("small")),
      el("div", { class: "ev-name", text: nameOf(milestone) }),
      el("div", { class: "ev-bar" }, el("span")))));
  }
  KEY_MILESTONES.forEach((milestone, index) => {
    const tile = $("rates").children[index], count = arm.reached[milestone] ?? 0;
    tile.querySelector(".ev-count span").textContent = String(count);
    tile.querySelector(".ev-count small").textContent = ` / ${total}`;
    tile.querySelector(".ev-bar span").style.width = `${(100 * count) / total}%`;
    tile.setAttribute("aria-label", `${nameOf(milestone)}: ${count} of ${total} episodes`);
  });
  renderTable();
}

const COLUMNS = [
  // the words in .ev-long go on a phone (eval.css), so the table fits its width: "20", "Iron pickaxe"
  { label: "Episode", value: (s) => s.n, cell: (s) => [el("span", { class: "ev-long", text: "Episode " }), String(s.n + 1).padStart(2, "0")] },
  // (PR #4) the furthest milestone, and within one milestone the sooner it was reached the better (descending sorts it first)
  { label: "Furthest milestone", short: ["Furthest", " milestone"], value: (s) => (MILESTONES.indexOf(s.furthest) + 1) * 1e5 - Math.min(s.furthest_time ?? 0, 99999), cell: (s) => [
    el("span", { class: "ev-path", "aria-hidden": "true" }, ...KEY_MILESTONES.map((m) =>
      el("img", { src: iconOf(m), alt: "", class: s.reached.includes(m) ? "ev-on" : "" }))),
    el("span", { class: "ev-furthest-name", text: s.furthest ? nameOf(s.furthest) : "none" }),
  ] },
  // times as m:ss, as in the episode window (10-15: was decimal minutes)
  { label: "Iron pickaxe at", short: ["Iron pickaxe", " at"], number: true, value: (s) => s.iron_pickaxe ?? Infinity, text: (s) => clock(s.iron_pickaxe) },
  { label: "Diamond at", short: ["Diamond", " at"], number: true, value: (s) => s.diamond ?? Infinity, text: (s) => clock(s.diamond),
    cls: (s) => (s.diamond != null ? "ev-has-diamond" : "") },
  { label: "Deaths", number: true, value: (s) => s.deaths, text: (s) => String(s.deaths), cls: () => "ev-col-deaths" },
];

function renderTable() {
  const arm = state.index[state.tab];
  const sort = state.sort[state.tab];
  const column = COLUMNS[sort.column];
  const rows = [...arm.episodes].sort((a, b) => {
    const va = column.value(a), vb = column.value(b);
    const order = va === vb ? 0 : va < vb ? -1 : 1;
    return (sort.ascending ? order : -order) || a.n - b.n;
  });
  // each heading is a button (keyboard, and a hover state that says it sorts); the sorted one carries aria-sort
  $("episodes-head").replaceChildren(el("tr", {}, ...COLUMNS.map((c, index) => {
    const sorted = index === sort.column;
    const th = el("th", {
      class: [c.number ? "ev-number" : "", c.label === "Deaths" ? "ev-col-deaths" : "", sorted ? `ev-sorted${sort.ascending ? " ev-ascending" : ""}` : ""]
        .join(" ").trim(),
    }, el("button", { class: "ev-sort", type: "button", "aria-label": c.label, onclick: () => {
      state.sort[state.tab] = { column: index, ascending: sorted ? !sort.ascending : index !== 1 };
      renderTable();
    } }, ...(c.short ? [c.short[0], el("span", { class: "ev-long", text: c.short[1] })] : [c.label])));
    if (sorted) th.setAttribute("aria-sort", sort.ascending ? "ascending" : "descending");
    return th;
  })));
  // a row opens its episode on a click, or on Enter or Space when it has focus
  $("episodes-body").replaceChildren(...rows.map((s) => el("tr", {
    "data-n": String(s.n), class: s.n === state.number && !$("viewer").hidden ? "ev-current" : "", tabindex: "0",
    "aria-label": `${label(s.n)}: ${s.diamond != null ? `diamond at ${clock(s.diamond)}` : `got as far as ${s.furthest ? nameOf(s.furthest) : "nothing"}`}`,
    onclick: () => openEpisode(s.n),
    onkeydown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEpisode(s.n); } },
  }, ...COLUMNS.map((c) => el("td", { class: [c.number ? "ev-number" : "", c.cls ? c.cls(s) : ""].join(" ").trim() },
    ...(c.cell ? c.cell(s) : [c.text(s)]))))));
}

// ------------------------------------------------------------------ the episode window
async function episodeData(tab, number) {
  const key = `${tab}/${String(number).padStart(2, "0")}`;
  if (!state.cache.has(key)) {
    state.cache.set(key, fetch(`data/${key}.json`).then((response) => {
      if (!response.ok) throw new Error(`episode data: HTTP ${response.status}`);
      return response.json();
    }).catch((error) => { state.cache.delete(key); throw error; }));   // a failed fetch is tried again on the next click
  }
  return state.cache.get(key);
}

async function openEpisode(number, { startAt = 0 } = {}) {
  const tab = state.tab;
  const ticket = ++state.loading;
  const episode = await episodeData(tab, number);
  if (ticket !== state.loading) return;  // a later click won
  state.number = number;
  state.episode = episode;
  state.windows = highlightWindows(episode);
  for (const row of $("episodes-body").children) row.classList.toggle("ev-current", Number(row.dataset.n) === number);
  const summary = state.index[tab].episodes[number];
  $("ep-setting").textContent = TAB_TITLE[tab];
  $("ep-title").textContent = label(number);
  // the outcome in one line: the diamond and when, or how far it got in the hour; then the deaths
  const deaths = `${summary.deaths || "no"} death${summary.deaths === 1 ? "" : "s"}`;
  $("ep-outcome").replaceChildren(episode.end === "diamond"
    ? el("strong", { class: "ev-won", text: `Diamond at ${clock(episode.milestones.diamond)}` })
    : el("strong", { text: summary.furthest ? `Got as far as ${nameOf(summary.furthest)}` : "No milestone reached" }),
  el("span", { class: "ev-muted", text: ` · ${deaths}` }));
  $("ep-strip").replaceChildren(...PAPER_MILESTONES.map((m) => {
    const t = episode.milestones[m];
    const reached = t != null;
    const props = { "aria-label": `${nameOf(m)}: ${reached ? clock(t) : "not reached"}`,
      title: reached ? `${nameOf(m)} at ${clock(t)}` : `${nameOf(m)}: not reached` };
    if (reached) props.onclick = () => seek(t - 5); else props.disabled = "";
    return el("li", { class: reached ? "ev-on" : "" },
      el("button", props, el("img", { src: iconOf(m), alt: "" }), el("span", { text: reached ? clock(t) : "–" })));
  }));
  $("ep-prev").disabled = number === 0;
  $("ep-next").disabled = number === state.index[tab].episodes.length - 1;
  EMBED.setHash(`#${tab}/${number + 1}`);
  const opening = $("viewer").hidden;
  $("viewer").hidden = false;
  document.documentElement.classList.add("ev-locked");
  if (opening) $("viewer").scrollTop = 0;
  if (opening) holdFocus(true);
  renderLists();
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
  state.loading++;
  for (const row of $("episodes-body").children) row.classList.remove("ev-current");
  EMBED.setHash(`#${state.tab}`);
}

function item(t, children, onclick, cls = "") {
  return el("li", { class: cls }, el("button", { onclick }, el("span", { class: "ev-t", text: clock(t) }), ...children));
}

// the subgoals as given, and the deaths with their cause (the milestones are the strip at the top; damage, the inventory
// at each death and the game's achievements stay in the data files only)
function renderLists() {
  const episode = state.episode;
  const cause = (message) => (message ? message.replace(/^was /, "") : "");
  // a run of deaths of the same cause, each within 5 min of the one before, is one line: "Shot by Skeleton ×12",
  // its first and last time, and a click jumps to the first (10-15)
  const runs = [];
  for (const death of episode.deaths) {
    const run = runs[runs.length - 1];
    if (run && run.message === (death.message ?? "") && death.t - run.last <= 300) { run.count++; run.last = death.t; }
    else runs.push({ message: death.message ?? "", first: death.t, last: death.t, count: 1 });
  }
  $("list-damage").replaceChildren(...(runs.length ? runs.map((run) => {
    const what = cause(run.message) ? capital(cause(run.message)) : "Died";
    return item(run.first, [el("span", { text: run.count > 1 ? `${what} ×${run.count}` : what }),
      ...(run.count > 1 ? [el("span", { class: "ev-until", text: `until ${clock(run.last)}` })] : [])],
    () => seek(run.first - 8), "ev-death");
  }) : [el("li", { class: "ev-empty", text: "None: the agent stayed alive." })]));
  $("list-stages").replaceChildren(...episode.stages.map(([t, stage]) =>
    item(t, [...icon(STAGE_ICON[stage] ?? stage), el("span", { text: capital(subgoalName(stage)) })], () => seek(t))));
}

// the timeline: the subgoal band (when there are subgoals), health with damage in red and deaths in grey until the
// respawn, the minute axis, and an item icon where each of the paper's milestones was first obtained. The text CFG
// scale, single hits, the fast-forward windows and the game's achievements were dropped from it (10-15: too much detail
// for a visitor; the data files keep them).
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const TL = { band: 16, gap: 8, health: 52, icon: 16, row: 20 };

function drawTimeline() {
  const episode = state.episode, node = $("timeline"), f = features();
  node.replaceChildren();
  const width = Math.max(280, Math.round(node.getBoundingClientRect().width) || 1000);
  const narrow = width < 560;
  const left = narrow ? 10 : 58, right = narrow ? 10 : 14, plotWidth = width - left - right;
  const duration = Math.max(1, episode.seconds);
  const x = (t) => left + (Math.min(Math.max(t, 0), duration) / duration) * plotWidth;
  const laneLabel = (y, text) => { if (!narrow) node.append(svg("text", { class: "lane-label", x: left - 8, y, "text-anchor": "end" }, text)); };
  let laneTop = 10;
  // subgoals
  const current = svg("rect", { class: "stage-current", x: 0, y: laneTop, width: 0, height: TL.band, rx: 2 });
  if (f.subgoals) {
    laneLabel(laneTop + 12, "Subgoal");
    episode.stages.forEach(([start, stage], index) => {
      const end = index + 1 < episode.stages.length ? episode.stages[index + 1][0] : duration;
      const rect = svg("rect", { x: x(start), y: laneTop, width: Math.max(0.5, x(end) - x(start)), height: TL.band, fill: stageColor(stage) });
      rect.append(svg("title", {}, `${capital(subgoalName(stage))} ${clock(start)}–${clock(end)}`));
      node.append(rect);
      const short = capital(subgoalName(stage));
      if (x(end) - x(start) > 6.2 * short.length + 8) node.append(svg("text", { class: "stage-label", x: x(start) + 4, y: laneTop + 12 }, short));
    });
    node.append(current);
    laneTop += TL.band + TL.gap;
  }
  // health, with damage and deaths behind it
  // (airy 10-16: a lower lane on a phone, 34 px of 52; an episode at full health left a tall empty band)
  const top = laneTop, plotBottom = top + (narrow ? 34 : TL.health), y = (health) => plotBottom - (health / 20) * (plotBottom - top);
  laneLabel(top + (plotBottom - top) / 2 + 4, "Health");
  node.append(svg("rect", { class: "lane", x: left, y: top, width: plotWidth, height: plotBottom - top, rx: 3 }));
  for (const spell of episode.damage) {
    const band = svg("rect", { class: "spell", x: x(spell.start), y: top, width: Math.max(2, x(spell.end) - x(spell.start)), height: plotBottom - top });
    band.append(svg("title", {}, `Taking damage ${clock(spell.start)}–${clock(spell.end)}: −${spell.lost} HP`));
    node.append(band);
  }
  for (const death of episode.deaths) {
    const respawned = death.respawned ?? duration;
    const band = svg("rect", { class: "dead", x: x(death.t), y: top, width: Math.max(1.5, x(respawned) - x(death.t)), height: plotBottom - top });
    band.append(svg("title", {}, `Died at ${clock(death.t)}${deathNote(death.message)}`));
    node.append(band);
  }
  let path = `M ${x(0)} ${y(20)}`;
  for (const [t, health] of episode.health) path += ` H ${x(t)} V ${y(health)}`;
  node.append(svg("path", { class: "health", d: `${path} H ${x(duration)}` }));
  for (const death of episode.deaths) {
    const mark = svg("line", { class: "death", x1: x(death.t), x2: x(death.t), y1: top - 3, y2: plotBottom + 3 });
    mark.append(svg("title", {}, `Died at ${clock(death.t)}${deathNote(death.message)}`));
    node.append(mark);
  }
  // the milestones, under the health: a tick at each moment, and its icon below it. Moments too close for an icon each
  // (the first minutes: log, planks, stick, crafting table…) share one place: the icon of the furthest of them and
  // "+N" for the rest, all named in its tooltip (the strip above the video lists each with its time). A group that
  // would cover the one before goes to a second row. (10-15: stacked or fanned icons were a cramped tangle on a phone.)
  const iconsTop = plotBottom + 8, rowEnds = [], groups = [];
  PAPER_MILESTONES.filter((m) => m in episode.milestones).sort((a, b) => episode.milestones[a] - episode.milestones[b]).forEach((m) => {
    const at = x(episode.milestones[m]), group = groups[groups.length - 1];
    if (group && at - group.lastAt < TL.icon + 2) { group.items.push(m); group.lastAt = at; } else groups.push({ firstAt: at, lastAt: at, items: [m] });
    node.append(svg("line", { class: "milestone", x1: at, x2: at, y1: plotBottom, y2: plotBottom + 4 }));
  });
  for (const group of groups) {
    const more = group.items.length - 1, span = TL.icon + (more ? 18 : 0), last = group.items[more];
    let from = Math.min(Math.max(group.firstAt - TL.icon / 2, 0), width - span), row = rowEnds.findIndex((end) => from > end + 3);
    if (row < 0 && rowEnds.length < 2) { row = rowEnds.length; rowEnds.push(-Infinity); }
    if (row < 0) { row = 0; from = Math.min(rowEnds[0] + 3, width - span); }
    rowEnds[row] = from + span;
    const top = iconsTop + row * TL.row;
    const mark = svg("g", { class: "milestone-mark" });
    mark.append(svg("title", {}, group.items.map((m) => `${capital(nameOf(m))} at ${clock(episode.milestones[m])}`).join("\n")),
      svg("image", { href: iconOf(last), x: from, y: top, width: TL.icon, height: TL.icon }));
    if (more) mark.append(svg("text", { class: "milestone-more", x: from + TL.icon + 2, y: top + 12 }, `+${more}`));
    node.append(mark);
  }
  // the minute axis, under the icons
  const axisY = iconsTop + Math.max(1, rowEnds.length) * TL.row + 10;
  const step = duration > 1800 ? (narrow ? 1200 : 600) : duration > 600 ? 300 : 60;
  for (let t = 0; t <= duration + 0.5; t += step) {
    const anchor = t === 0 ? "start" : x(t) > width - right - 20 ? "end" : "middle";
    node.append(svg("text", { class: "tick-label", x: x(t), y: axisY, "text-anchor": anchor }, clock(t)));  // m:ss, as every other time here and the BASALT axis (viewers2 10-15: was "5 min")
  }
  const height = axisY + 6;
  node.setAttribute("viewBox", `0 0 ${width} ${height}`);
  node.style.height = `${height}px`;
  const playhead = svg("g", { class: "playhead" });
  playhead.append(svg("line", { x1: 0, x2: 0, y1: 4, y2: plotBottom + 4 }), svg("circle", { cx: 0, cy: 4, r: 4 }));
  node.append(playhead);
  state.timeline = { x, left, plotWidth, duration, playhead, current };
}

function updateNow() {
  const episode = state.episode, timeline = state.timeline;
  if (!episode || !timeline) return;
  const t = now();
  timeline.playhead.setAttribute("transform", `translate(${timeline.x(t)} 0)`);
  const stages = episode.stages;
  const index = stages.length ? Math.max(0, lastAtOrBefore(stages, t)) : -1;
  const head = [];
  if (index >= 0) {
    const [start, stage] = stages[index];
    const end = index + 1 < stages.length ? stages[index + 1][0] : timeline.duration;
    timeline.current.setAttribute("x", timeline.x(start));
    timeline.current.setAttribute("width", Math.max(1, timeline.x(end) - timeline.x(start)));
    head.push(...icon(STAGE_ICON[stage] ?? stage, "ev-now-icon"), el("span", { class: "ev-subgoal", text: capital(subgoalName(stage)) }));
  } else {
    const reached = PAPER_MILESTONES.filter((m) => m in episode.milestones && episode.milestones[m] <= t)
      .sort((a, b) => episode.milestones[a] - episode.milestones[b]);
    const latest = reached[reached.length - 1];
    head.push(...(latest ? icon(latest, "ev-now-icon") : []),
      el("span", { class: "ev-subgoal", text: latest ? `Latest milestone: ${nameOf(latest)}` : "No milestone yet" }));
  }
  const status = [el("span", { class: "ev-clock", text: clock(t) })];
  const dead = episode.deaths.find((death) => death.t <= t && t < Math.max(death.respawned ?? Infinity, death.t + 3));
  const spell = episode.damage.find((s) => s.start <= t && t <= s.end);
  if (dead) status.push(el("span", { class: "ev-alert", text: `Died${deathNote(dead.message)}` }));
  else if (spell) status.push(el("span", { class: "ev-alert", text: "Taking damage" }));
  if (state.highlight) {
    const next = state.windows.find(([, windowEnd]) => t < windowEnd);
    if (!(next && t >= next[0])) status.push(el("span", { class: "ev-fast", text: "Fast-forward 16×" }));
  }
  const box = $("stage-now");
  const rows = [el("div", { class: "ev-line1" }, el("div", { class: "ev-what" }, ...head), el("div", { class: "ev-status" }, ...status))];
  if (index >= 0) {
    const stage = stages[index][1];
    box.style.setProperty("--stage", stageColor(stage));   // (airy 10-16: tints the box, eval.css; was its left border)
    rows.push(el("div", { class: "ev-caption" }, el("span", { class: "ev-muted", text: "Prompt to the video planner: " }),
      `“${SUBGOAL_CAPTIONS[stage] ?? ""}”`));
  } else box.style.removeProperty("--stage");
  box.replaceChildren(...rows);
  [...$("list-stages").children].forEach((node, i) => node.classList.toggle("ev-current", i === index));
}

function jumpDamage(direction) {
  const starts = (state.episode?.damage ?? []).map((spell) => spell.start - 3);
  if (!starts.length) return;
  const t = now();
  const target = direction > 0 ? starts.find((start) => start > t + 0.5) : [...starts].reverse().find((start) => start < t - 1);
  if (target !== undefined) seek(target);
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
      EMBED.setHash(`#${state.tab}`);
    });
  }
  for (const button of document.querySelectorAll(".ev-view button")) button.addEventListener("click", () => setView(button.dataset.view));
  videos.plan_idm.classList.add("ev-back");
  $("highlight").addEventListener("click", () => setHighlight(!state.highlight));
  setHighlight(true);  // on by default (the user, 10-15); a speed button or F turns it off
  $("ep-prev").addEventListener("click", () => openEpisode(state.number - 1));
  $("ep-next").addEventListener("click", () => openEpisode(state.number + 1));
  $("close").addEventListener("click", closeViewer);
  $("back").addEventListener("click", closeViewer);
  $("viewer").addEventListener("click", (event) => { if (event.target === $("viewer")) closeViewer(); });
  for (const view of VIEWS) {
    const video = videos[view];
    const front = () => view === state.view;
    video.addEventListener("timeupdate", () => { if (front()) { updateNow(); syncBehind(); } });
    video.addEventListener("seeked", () => { if (front()) { updateNow(); syncBehind(true); } });
    video.addEventListener("play", () => { if (front()) syncBehind(); });
    video.addEventListener("pause", () => { if (front()) syncBehind(); });
    video.addEventListener("ratechange", () => {
      // a speed picked from the browser's own video menu
      if (front() && !state.highlight && video.playbackRate !== state.speed) setSpeed(video.playbackRate);
    });
  }
  // a click on the timeline jumps there, and a drag scrubs: the playhead follows the pointer at once, the videos seek
  // at most every 150 ms on the way and exactly where it is let go (touch-action: pan-y in eval.css keeps a sideways
  // finger from scrolling the page)
  const scrub = { on: false, last: 0, timer: 0 };
  const timeAt = (event) => {
    const timeline = state.timeline, box = $("timeline").getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * Number($("timeline").viewBox.baseVal.width);
    return Math.max(0, Math.min(timeline.duration, ((px - timeline.left) / timeline.plotWidth) * timeline.duration));
  };
  const scrubTo = (t, final) => {
    state.timeline.playhead.setAttribute("transform", `translate(${state.timeline.x(t)} 0)`);
    clearTimeout(scrub.timer);
    const wait = final ? 0 : 150 - (performance.now() - scrub.last);
    if (wait <= 0) { scrub.last = performance.now(); seek(t); } else scrub.timer = setTimeout(() => scrubTo(t, true), wait);
  };
  $("timeline").addEventListener("pointerdown", (event) => {
    if (!state.timeline || event.button > 0) return;
    scrub.on = true;
    $("timeline").setPointerCapture(event.pointerId);
    scrubTo(timeAt(event), true);
  });
  $("timeline").addEventListener("pointermove", (event) => { if (scrub.on) scrubTo(timeAt(event), false); });
  for (const type of ["pointerup", "pointercancel"]) {
    $("timeline").addEventListener(type, (event) => {
      if (!scrub.on) return;
      scrub.on = false;
      if (type === "pointerup") scrubTo(timeAt(event), true);
    });
  }
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
    "mirror-closed": () => { if (state.episode) closeViewer(); },
  });
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || !state.episode || $("viewer").hidden) return;
    const onVideo = document.activeElement === shown();
    if (event.key === "Escape") closeViewer();
    else if (event.key === "ArrowLeft" && !onVideo) { event.preventDefault(); seek(now() - 5); }
    else if (event.key === "ArrowRight" && !onVideo) { event.preventDefault(); seek(now() + 5); }
    else if (event.key === "[") jumpDamage(-1);
    else if (event.key === "]") jumpDamage(1);
    else if (/^[1-5]$/.test(event.key)) setSpeed(SPEEDS[Number(event.key) - 1]);
    else if (event.key === "f" || event.key === "F") setHighlight(!state.highlight);
    else if ((event.key === "v" || event.key === "V") && views().length > 1) setView(otherView(state.view));
    else if (event.key === " " && !onVideo && !["BUTTON", "A"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      if (shown().paused) shown().play().catch(() => {}); else shown().pause();
    }
  });
}

// #online, or #online/7@120: a tab, an episode (from 1) and a time in seconds
function route(hash) {
  const [where, at] = decodeURIComponent(hash.replace(/^#/, "")).split("@");
  const [tab, number] = where.split("/");
  if (state.episode) closeViewer();
  showTab(tab in TAB_TITLE ? tab : "offline");
  if (tab in TAB_TITLE && number) {
    const last = state.index[tab].episodes.length - 1;
    openEpisode(Math.min(last, Math.max(0, (Number(number) || 1) - 1)), { startAt: Number(at) || 0 });
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
