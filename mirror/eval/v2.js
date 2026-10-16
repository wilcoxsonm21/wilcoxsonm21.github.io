"use strict";
// The Diamond Challenge episode viewer, redesigned (../js/design.js has its three looks). The list is the episodes'
// stills, furthest first; an episode is its video with the paper's milestones marked on the scrubber and the subgoal
// it is on. Every value from the data files is set with textContent or an attribute: no HTML is built from data.

const VIDEO_BASE = "https://huggingface.co/datasets/hwryu/mirror_diamond_eval/resolve/main";
const TAB_TITLE = { offline: "Offline · Generative VP", online: "Online · Generative VP", oracle: "Online · Oracle VP" };
// what each tab's agent used, in one line (the paper's Section 4 and the caption of Figure 4)
const TAB_NOTE = {
  offline: "Generative video planner. Action labels from VPT human gameplay; no environment interaction, no task rewards.",
  online: "Generative video planner. Video only, no action labels; ~140 in-game hours of interaction, no task rewards.",
  oracle: "Oracle video planner. Video only, no action labels; ~80 in-game hours of interaction, no task rewards.",
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
const PAPER_MILESTONES = ["log", "planks", "stick", "crafting_table", "wooden_pickaxe", "cobblestone",
  "stone_pickaxe", "furnace", "iron_ore", "iron_ingot", "iron_pickaxe", "diamond"];
const KEY_MILESTONES = ["crafting_table", "stone_pickaxe", "iron_ore", "iron_ingot", "iron_pickaxe", "diamond"];
const STAGE_ICON = { place_crafting_table: "crafting_table", pick_up_crafting_table: "crafting_table",
  place_furnace: "furnace", load_furnace: "furnace" };
const SUBGOAL_NAMES = { place_crafting_table: "place crafting table", pick_up_crafting_table: "pick up crafting table",
  place_furnace: "place furnace", load_furnace: "load furnace" };
// the prompts the subgoal task planner gives the video planner
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
// Skim: 1x from 3.5 s before each subgoal change (and the diamond) to 1 s after it, 16x in between
const SKIM = { before: 3.5, after: 1 };

const $ = (id) => document.getElementById(id);
const state = { index: null, tab: "offline", sort: "progress", order: [], number: null, episode: null, cache: new Map(), loading: 0, listScroll: 0 };

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
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const nameOf = (m) => MILESTONE_NAMES[m] ?? m.replaceAll("_", " ");
const subgoalName = (stage) => SUBGOAL_NAMES[stage] ?? nameOf(stage);
const iconOf = (item) => {
  const m = STAGE_ICON[item] ?? item;
  return PAPER_MILESTONES.includes(m) ? `icons/${m}.png` : null;
};
const icon = (item, cls = "") => (iconOf(item) ? [el("img", { src: iconOf(item), alt: "", class: cls })] : []);
const label = (n) => `Episode ${String(n + 1).padStart(2, "0")}`;
const pad = (n) => String(n).padStart(2, "0");
const lastAtOrBefore = (list, t) => {
  let lo = 0, hi = list.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid][0] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
};

const player = createPlayer($("player"), { lag: { plan_idm: 0.05 }, onTime: updateNow, skimLabel: "16× between subgoals, 1× at each" });
const clock = player.clock;
$("ep-side").append(player.views);

// ------------------------------------------------------------------ the list
function showTab(tab) {
  state.tab = tab;
  for (const b of $("tabs").children) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  const arm = state.index[tab], total = arm.episodes.length;
  $("arm-note").textContent = TAB_NOTE[tab];
  $("funnel").replaceChildren(...KEY_MILESTONES.map((m) => {
    const count = arm.reached[m] ?? 0;
    return el("li", { class: m === "diamond" ? "v2-diamond" : "", "aria-label": `${capital(nameOf(m))}: ${count} of ${total}` },
      ...icon(m), el("span", { class: "v2-funnel-n", text: String(count) }), el("span", { class: "v2-funnel-name", text: nameOf(m) }));
  }));
  const diamonds = arm.reached.diamond ?? 0;
  $("stat").textContent = `${diamonds} of ${total} reached a diamond within the hour.`;
  renderList();
}

function renderList() {
  const arm = state.index[state.tab];
  const progress = (s) => (MILESTONES.indexOf(s.furthest) + 1) * 1e5 - Math.min(s.furthest_time ?? 0, 99999);
  const rows = [...arm.episodes].sort((a, b) => (state.sort === "number" ? a.n - b.n : progress(b) - progress(a) || a.n - b.n));
  state.order = rows.map((s) => s.n);
  for (const b of $("sort").children) b.setAttribute("aria-checked", String(b.dataset.sort === state.sort));
  $("episodes").replaceChildren(...rows.map((s) => {
    const won = s.diamond != null;
    // (the list look has a time column, so its line names the milestone only)
    const sub = won ? [...icon("diamond"), el("span", { text: DESIGN === "list" ? "Diamond" : `Diamond at ${clock(s.diamond)}` })]
      : s.furthest ? [...icon(s.furthest), el("span", { text: capital(nameOf(s.furthest)) })] : [el("span", { text: "No milestone" })];
    return el("li", {}, el("button", {
      class: `v2-card${won ? " v2-won" : ""}`, type: "button", "data-n": String(s.n),
      "aria-label": `${label(s.n)}: ${won ? `diamond at ${clock(s.diamond)}` : `got as far as ${s.furthest ? nameOf(s.furthest) : "nothing"}`}`,
      onclick: () => openEpisode(s.n),
    },
    el("span", { class: "v2-thumb" }, el("img", { src: `thumbs/${state.tab}/${pad(s.n)}.webp`, alt: "", loading: "lazy", decoding: "async" })),
    el("span", { class: "v2-card-text" },
      el("span", { class: "v2-card-title", text: label(s.n) }),
      el("span", { class: "v2-card-sub" }, ...sub)),
    el("span", { class: "v2-path", "aria-hidden": "true" }, ...KEY_MILESTONES.map((m) =>
      el("img", { src: iconOf(m), alt: "", class: s.reached.includes(m) ? "v2-on" : "" }))),
    el("span", { class: "v2-row-time", text: won ? clock(s.diamond) : "" }),
    chevron()));
  }));
}

function chevron() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"), p = document.createElementNS(s.namespaceURI, "path");
  s.setAttribute("class", "v2-chev");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  p.setAttribute("d", "M9.5 6l6 6-6 6");
  s.append(p);
  return s;
}

// ------------------------------------------------------------------ one episode
async function episodeData(tab, n) {
  const key = `${tab}/${pad(n)}`;
  if (!state.cache.has(key)) {
    state.cache.set(key, fetch(`data/${key}.json`).then((r) => {
      if (!r.ok) throw new Error(`episode data: HTTP ${r.status}`);
      return r.json();
    }).catch((error) => { state.cache.delete(key); throw error; }));
  }
  return state.cache.get(key);
}

function keyWindows(episode) {
  const times = episode.stages.length
    ? episode.stages.slice(1).map(([t]) => t)
    : PAPER_MILESTONES.filter((m) => m in episode.milestones && m !== "diamond").map((m) => episode.milestones[m]);
  if ("diamond" in episode.milestones) times.push(episode.milestones.diamond);
  const windows = [];
  for (const t of times.sort((a, b) => a - b)) {
    const start = Math.max(0, t - SKIM.before), end = t + SKIM.after;
    if (windows.length && start <= windows[windows.length - 1][1]) windows[windows.length - 1][1] = end;
    else windows.push([start, end]);
  }
  return windows;
}

let firstOpen = true;
async function openEpisode(n, { startAt = 0 } = {}) {
  const tab = state.tab, ticket = ++state.loading;
  const episode = await episodeData(tab, n);
  if (ticket !== state.loading) return;   // a later click won
  const opening = $("episode").hidden;
  if (opening) state.listScroll = window.scrollY;
  state.number = n;
  state.episode = episode;
  const summary = state.index[tab].episodes[n];
  $("ep-setting").textContent = TAB_TITLE[tab];
  $("ep-title").textContent = label(n);
  const deaths = summary.deaths ? ` · ${summary.deaths} death${summary.deaths === 1 ? "" : "s"}` : "";
  $("ep-outcome").replaceChildren(episode.end === "diamond"
    ? el("span", { class: "v2-win" }, ...icon("diamond"), `Diamond at ${clock(episode.milestones.diamond)}`)
    : el("span", {}, ...icon(summary.furthest), summary.furthest ? `Got as far as ${nameOf(summary.furthest)}` : "No milestone reached"),
  el("span", { class: "v2-deaths", text: deaths }));
  const at = state.order.indexOf(n);
  $("ep-prev").disabled = at <= 0;
  $("ep-next").disabled = at >= state.order.length - 1;
  EMBED.setHash(`#${tab}/${n + 1}`);
  if (opening) {
    $("list").hidden = true;
    $("episode").hidden = false;
    document.documentElement.classList.add("v2-in-episode");
    window.scrollTo({ top: 0, behavior: "instant" });
    $("episode").focus({ preventScroll: true });   // (the view, not its back button: no focus ring on a click)
  }
  renderLists();
  const folder = state.index[tab].folder, views = episode.views ?? state.index[tab].features.views;
  const marks = PAPER_MILESTONES.filter((m) => m in episode.milestones).map((m) => ({
    t: episode.milestones[m], kind: "item", icon: iconOf(m), title: `${capital(nameOf(m))} at ${clock(episode.milestones[m])}`,
  }));
  if (DESIGN !== "cinema") {
    for (const d of episode.deaths) marks.push({ t: d.t, kind: "death", title: `Died at ${clock(d.t)}${d.message ? `: ${d.message.replace(/^was /, "")}` : ""}` });
  }
  player.load({
    sources: Object.fromEntries(views.map((v) => [v, `${VIDEO_BASE}/${folder}/${v}/${pad(n)}.mp4`])),
    duration: Number(episode.seconds), startAt, marks, windows: keyWindows(episode),
    skim: firstOpen ? true : undefined,   // Skim is on by default (the user, 10-15); later episodes keep the reader's choice
  });
  firstOpen = false;
}

function closeEpisode() {
  if ($("episode").hidden) return;
  state.loading++;
  player.unload();
  state.episode = null;
  $("episode").hidden = true;
  $("list").hidden = false;
  document.documentElement.classList.remove("v2-in-episode");
  window.scrollTo({ top: state.listScroll, behavior: "instant" });
  $("episodes").querySelector(`[data-n="${state.number}"]`)?.focus({ preventScroll: true });
  EMBED.setHash(`#${state.tab}`);
}

// what the agent is doing now: the subgoal with its icon (the prompt the video planner was given, in the list look),
// or, while dead, how it died
function updateNow(t) {
  const episode = state.episode;
  if (!episode) return;
  const stages = episode.stages;
  const index = stages.length ? Math.max(0, lastAtOrBefore(stages, t)) : -1;
  const dead = episode.deaths.find((d) => d.t <= t && t < Math.max(d.respawned ?? Infinity, d.t + 3));
  const parts = [];
  if (dead) parts.push(el("span", { class: "v2-now-alert", text: `Died${dead.message ? `: ${dead.message.replace(/^was /, "")}` : ""}` }));
  else if (index >= 0) {
    const stage = stages[index][1];
    parts.push(el("span", { class: "v2-now-what" }, el("span", { class: "v2-now-label", text: "Subgoal" }),
      ...icon(stage), el("span", { text: capital(subgoalName(stage)) })));
    if (DESIGN === "list") parts.push(el("span", { class: "v2-now-prompt", text: `“${SUBGOAL_CAPTIONS[stage] ?? ""}”` }));
  } else {
    const reached = PAPER_MILESTONES.filter((m) => m in episode.milestones && episode.milestones[m] <= t)
      .sort((a, b) => episode.milestones[a] - episode.milestones[b]);
    const latest = reached[reached.length - 1];
    parts.push(el("span", { class: "v2-now-what" }, ...(latest ? icon(latest) : []),
      el("span", { text: latest ? `Has ${nameOf(latest)}` : "Starting out" })));
  }
  // (under the video; the cinema look shows it on the video instead where the video is large enough, viewer2.css)
  $("now").replaceChildren(...parts);
  player.overlay.replaceChildren(...parts.map((part) => part.cloneNode(true)));
  for (const box of [$("now"), player.overlay]) box.classList.toggle("v2-now-dead", !!dead);
  [...$("list-stages").children].forEach((node, i) => node.classList.toggle("v2-current", i === index));
}

// the list look's disclosure: the subgoals as given, and the deaths (a run of the same cause, each within 5 min of the
// one before, is one line)
function renderLists() {
  const episode = state.episode;
  const item = (t, children, jump) => el("li", {}, el("button", { type: "button", onclick: () => { player.seek(jump); player.play(); } },
    el("span", { class: "v2-t", text: clock(t) }), ...children));
  $("section-stages").hidden = !episode.stages.length;
  $("list-stages").replaceChildren(...episode.stages.map(([t, stage]) =>
    item(t, [...icon(stage), el("span", { text: capital(subgoalName(stage)) })], t)));
  const runs = [];
  for (const d of episode.deaths) {
    const run = runs[runs.length - 1], message = d.message ?? "";
    if (run && run.message === message && d.t - run.last <= 300) { run.count++; run.last = d.t; }
    else runs.push({ message, first: d.t, last: d.t, count: 1 });
  }
  $("list-deaths").replaceChildren(...(runs.length ? runs.map((run) => {
    const what = run.message ? capital(run.message.replace(/^was /, "")) : "Died";
    return item(run.first, [el("span", { text: run.count > 1 ? `${what} ×${run.count}` : what })], run.first - 8);
  }) : [el("li", { class: "v2-empty", text: "None: the agent stayed alive." })]));
}

// ------------------------------------------------------------------ wiring
for (const b of $("tabs").children) {
  b.addEventListener("click", () => {
    if (b.dataset.tab === state.tab) return;
    showTab(b.dataset.tab);
    EMBED.setHash(`#${state.tab}`);
  });
}
for (const b of $("sort").children) b.addEventListener("click", () => { state.sort = b.dataset.sort; renderList(); });
$("back").addEventListener("click", closeEpisode);
$("ep-prev").addEventListener("click", () => openEpisode(state.order[state.order.indexOf(state.number) - 1]));
$("ep-next").addEventListener("click", () => openEpisode(state.order[state.order.indexOf(state.number) + 1]));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!$("episode").hidden) closeEpisode(); else EMBED.escape();
});
EMBED.listen({
  "mirror-route": ({ hash }) => route(hash),
  "mirror-closed": () => {
    closeEpisode();
    setTimeout(() => window.scrollTo({ top: 0, behavior: "instant" }), 450);
  },
});

// #online, or #online/8@600: a tab, an episode (from 1) and a time in seconds
function route(hash) {
  const [where, at] = decodeURIComponent(hash.replace(/^#/, "")).split("@");
  const [tab, number] = where.split("/");
  closeEpisode();
  showTab(tab in TAB_TITLE ? tab : "offline");
  if (tab in TAB_TITLE && number) {
    const last = state.index[tab].episodes.length - 1;
    openEpisode(Math.min(last, Math.max(0, (Number(number) || 1) - 1)), { startAt: Number(at) || 0 });
  }
}

(async () => {
  const response = await fetch("data/index.json");
  if (!response.ok) throw new Error(`episode list: HTTP ${response.status}`);
  state.index = await response.json();
  route(location.hash);
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("v2-ready")));
})().catch((error) => {
  $("episodes").replaceChildren(el("li", { class: "v2-empty", text: `The episodes could not be loaded: ${error.message ?? error}` }));
});
