"use strict";
// The Diamond Challenge evaluation episodes, to browse the results by eye, in the look of the page's survival section
// (../css/watch.css): a grid of every episode of a setting, furthest first, each still marked with the furthest item
// it reached; an episode plays in the survival player (../js/watch-player.js). Every value from the data files is set
// with textContent or an attribute: no HTML is built from data.

const VIDEO_BASE = "https://huggingface.co/datasets/hwryu/mirror_diamond_eval/resolve/main";
// the 4x and 16x copies of each video, for playing fast without streaming the whole video (tools/mirror_fast/)
const FAST_BASE = "https://huggingface.co/datasets/mwilcoxson/selfimprovingvisiontoactionmodelswebsitevideos/resolve/main";
const copies = (folder, view, n) => ({ 1: `${VIDEO_BASE}/${folder}/${view}/${pad(n)}.mp4`,
  4: `${FAST_BASE}/${folder}/${view}_4x/${pad(n)}.mp4`, 16: `${FAST_BASE}/${folder}/${view}_16x/${pad(n)}.mp4` });
const PLAN_LAG = 0.05;   // the recording starts one frame (the world's first view) before the first executed step
// what each setting was trained on (the user's wording, 10-16)
const TAB = {
  offline: { name: "Offline", plans: "generated plans", note: "Trained on human gameplay with action labels, no environment interaction during training." },
  online: { name: "Online", plans: "generated plans", note: "Trained on action-free video, then 140 hours of self-play." },
  oracle: { name: "Online", plans: "oracle plans", note: "Trained on action-free video, then 80 hours of self-play. Plans provided by an oracle video planner." },
};
const NAME = {
  log: "log", planks: "planks", stick: "sticks", crafting_table: "crafting table", place_crafting_table: "placed crafting table",
  wooden_pickaxe: "wooden pickaxe", cobblestone: "cobblestone", stone_pickaxe: "stone pickaxe", furnace: "furnace",
  iron_ore: "iron ore", place_furnace: "placed furnace", load_furnace: "loaded furnace", iron_ingot: "iron ingot",
  iron_pickaxe: "iron pickaxe", diamond: "diamond", pick_up_crafting_table: "picked-up crafting table",
};
const MILESTONES = ["log", "planks", "stick", "crafting_table", "place_crafting_table", "wooden_pickaxe",
  "cobblestone", "stone_pickaxe", "furnace", "iron_ore", "place_furnace", "load_furnace", "iron_ingot",
  "iron_pickaxe", "diamond"];
const PAPER = ["log", "planks", "stick", "crafting_table", "wooden_pickaxe", "cobblestone", "stone_pickaxe", "furnace",
  "iron_ore", "iron_ingot", "iron_pickaxe", "diamond"];
// a subgoal names an action where its milestone names a state
const GOAL = { place_crafting_table: "place crafting table", pick_up_crafting_table: "pick up crafting table",
  place_furnace: "place furnace", load_furnace: "load furnace" };
const SKIM = { before: 3.5, after: 1 };   // fast-forward: 1x from 3.5 s before each subgoal change to 1 s after, 16x between

const $ = (id) => document.getElementById(id);
const state = { index: null, tab: "online", order: [], number: null, episode: null, cache: new Map(), loading: 0, listScroll: 0 };
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const pad = (n) => String(n).padStart(2, "0");
const label = (n) => `Episode ${n + 1}`;
const icon = (m) => `icons/${m}.png`;
// "a log", "an iron ingot", but just "cobblestone", "sticks"
const MASS = new Set(["planks", "stick", "cobblestone", "iron_ore"]);
const article = (m) => (MASS.has(m) ? "" : /^[aeiou]/.test(NAME[m]) ? "an " : "a ");
// the furthest of the paper's twelve milestones an episode reached, from its summary. Its furthest overall can be a
// placed or loaded one, which says only that the item was made (38 episodes place a furnace without mining any iron
// ore), so that counts as the item, and the summary's key milestones fill in what lies past it. (Checked against the
// episodes' own milestones, all 384 agree, 10-16.)
const AS_ITEM = { place_crafting_table: "crafting_table", pick_up_crafting_table: "crafting_table", place_furnace: "furnace", load_furnace: "furnace" };
const furthestPaper = (s) => [AS_ITEM[s.furthest] ?? s.furthest, ...s.reached].filter((m) => PAPER.includes(m))
  .sort((a, b) => PAPER.indexOf(b) - PAPER.indexOf(a))[0];
const lastAtOrBefore = (list, t) => {
  let lo = 0, hi = list.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid][0] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
};
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

const player = createWatchPlayer($("player"), { planLag: PLAN_LAG });
const clock = player.clock;

// ------------------------------------------------------------------ the list
function showTab(tab) {
  state.tab = tab;
  for (const b of $("tabs").children) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  const arm = state.index[tab], total = arm.episodes.length;
  $("note").textContent = TAB[tab].note;
  $("count").textContent = `${total} episodes`;
  // how many got the furthest thing any of them got: a diamond, else an iron pickaxe (no Online episode finds a diamond)
  const best = [["diamond", "found a diamond"], ["iron_pickaxe", "got an iron pickaxe"], ["iron_ingot", "got an iron ingot"],
    ["iron_ore", "mined iron ore"], ["stone_pickaxe", "got a stone pickaxe"]].find(([m]) => (arm.reached[m] ?? 0) > 0);
  $("count-sub").textContent = best ? `${arm.reached[best[0]]} ${best[1]}` : "";
  // furthest first by the item each card shows (the paper's order), then, within one item, the run that got further past
  // it (a placed or loaded furnace), then the sooner (the user, 10-15 and 10-16)
  const rank = (s) => { const top = furthestPaper(s); return [top ? PAPER.indexOf(top) : -1, MILESTONES.indexOf(s.furthest), -(s.furthest_time ?? 0)]; };
  const rows = [...arm.episodes].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return rb[0] - ra[0] || rb[1] - ra[1] || rb[2] - ra[2] || a.n - b.n;
  });
  state.order = rows.map((s) => s.n);
  $("grid").replaceChildren(...rows.map((s) => {
    const top = furthestPaper(s), won = s.diamond != null;
    return el("li", {}, el("button", {
      class: "w-card", type: "button", "data-n": String(s.n), onclick: () => openEpisode(s.n),
      "aria-label": `${label(s.n)}: ${won ? `a diamond at ${clock(s.diamond)}` : top ? `got as far as ${NAME[top]}` : "no milestone"}`,
    },
    el("span", { class: "w-thumb" }, el("img", { src: `thumbs/${tab}/${pad(s.n)}.webp`, alt: "", loading: "lazy", decoding: "async" }),
      ...(top ? [el("span", { class: "w-badge", "aria-hidden": "true" }, el("img", { src: icon(top), alt: "" }))] : [])),
    el("span", { class: "w-cap" }, el("b", { text: label(s.n) }),
      el("span", { class: won ? "w-win" : "", text: won ? `Diamond at ${clock(s.diamond)}` : top ? cap(NAME[top]) : "No milestone" }))));
  }));
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

// the 1x stretches of fast-forward: around each subgoal change (or, without subgoals, each milestone) and the diamond
function windows(episode) {
  const times = episode.stages.length
    ? episode.stages.slice(1).map(([t]) => t)
    : PAPER.filter((m) => m in episode.milestones && m !== "diamond").map((m) => episode.milestones[m]);
  if ("diamond" in episode.milestones) times.push(episode.milestones.diamond);
  const out = [];
  for (const t of times.sort((a, b) => a - b)) {
    const start = Math.max(0, t - SKIM.before), end = t + SKIM.after;
    if (out.length && start <= out[out.length - 1][1]) out[out.length - 1][1] = end;
    else out.push([start, end]);
  }
  return out;
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
  // (an oracle episode plays on after its diamond, so the diamond is its milestone, not how it ended)
  // (here the episode's own milestones say exactly what it reached)
  const top = [...PAPER].reverse().find((m) => m in episode.milestones), won = episode.milestones.diamond != null;
  // the headline in two lengths, css picking one (the user, 10-16): the full sentence where it fits on one line, and on a
  // phone the episode's number in the eyebrow over just the result ("Got a wooden pickaxe")
  const mk = (text) => el("span", { class: "mk", text });
  $("ep-eyebrow").replaceChildren(`${TAB[tab].name} · ${TAB[tab].plans}`, el("span", { class: "w-short", text: ` · ${label(n)}` }));
  $("ep-title").replaceChildren(
    el("span", { class: "w-long" }, ...(won ? [`${label(n)} found a `, mk("diamond")]
      : top ? [`${label(n)} got as far as the `, mk(NAME[top])] : [`${label(n)} reached no milestone`])),
    el("span", { class: "w-short" }, ...(won ? ["Found a ", mk("diamond")] : top ? [`Got ${article(top)}`, mk(NAME[top])] : ["No milestones"])));
  const at = state.order.indexOf(n);
  $("ep-prev").disabled = at <= 0;
  $("ep-next").disabled = at >= state.order.length - 1;
  EMBED.setHash(`#${tab}/${n + 1}`);
  if (opening) {
    $("list").hidden = true;
    $("episode").hidden = false;
    $("episode").focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  const folder = state.index[tab].folder, views = episode.views ?? state.index[tab].features.views;
  const deaths = episode.deaths.length;
  const milestones = PAPER.map((m) => ({ t: episode.milestones[m], icon: icon(m), name: cap(NAME[m]), title: `${cap(NAME[m])} at ${clock(episode.milestones[m])}` }));
  const reached = PAPER.filter((m) => m in episode.milestones);
  player.load({
    exec: copies(folder, "raw", n),
    plan: views.includes("plan_idm") ? copies(folder, "plan_idm", n) : null,
    duration: Number(episode.seconds), startAt, milestones,
    ticks: reached.map((m) => ({ t: episode.milestones[m], title: `${cap(NAME[m])} · ${clock(episode.milestones[m])}`, icon: icon(m) })),
    toasts: [...reached.map((m) => ({ t: episode.milestones[m], icon: icon(m), text: m === "diamond" ? "Diamond!" : cap(NAME[m]) })),
      ...episode.deaths.map((d) => ({ t: d.t, death: true, text: `Died${d.message ? ` · ${d.message.replace(/^was /, "")}` : ""}` }))],
    windows: windows(episode),
    // 1x to start (the user, 10-16: the pill reads "1×" and a tap makes it faster); later episodes keep the reader's choice
    auto: firstOpen ? false : undefined,
    goal: (t) => (episode.stages.length ? (() => { const g = episode.stages[Math.max(0, lastAtOrBefore(episode.stages, t))][1]; return GOAL[g] ?? NAME[g] ?? g; })() : null),
    // the outcome, then what the setting was trained on
    caption: [
      `${won ? `A diamond at ${clock(episode.milestones.diamond)}` : top ? `${cap(NAME[top])} at ${clock(episode.milestones[top])}` : "No milestones"}, ${deaths ? `${deaths} death${deaths === 1 ? "" : "s"}` : "no deaths"}.`,
      TAB[tab].note,
    ],
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
  window.scrollTo({ top: state.listScroll, behavior: "instant" });
  $("grid").querySelector(`[data-n="${state.number}"]`)?.focus({ preventScroll: true });
  EMBED.setHash(`#${state.tab}`);
}

// ------------------------------------------------------------------ wiring
for (const b of $("tabs").children) {
  b.addEventListener("click", () => {
    if (b.dataset.tab === state.tab) return;
    showTab(b.dataset.tab);
    EMBED.setHash(`#${state.tab}`);
  });
}
$("back").addEventListener("click", closeEpisode);
$("ep-prev").addEventListener("click", () => openEpisode(state.order[state.order.indexOf(state.number) - 1]));
$("ep-next").addEventListener("click", () => openEpisode(state.order[state.order.indexOf(state.number) + 1]));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!$("episode").hidden) closeEpisode(); else EMBED.escape();
});
EMBED.listen({
  "mirror-route": ({ hash }) => route(hash),
  "mirror-closed": () => { closeEpisode(); setTimeout(() => window.scrollTo({ top: 0, behavior: "instant" }), 450); },
});

// #offline, or #offline/8@600: a setting, an episode (from 1) and a time in seconds; no setting: Online
function route(hash) {
  const [where, at] = decodeURIComponent(hash.replace(/^#/, "")).split("@");
  const [tab, number] = where.split("/");
  closeEpisode();
  showTab(tab in TAB ? tab : "online");   // (the leftmost tab, the user 10-16: Offline sits at the right)
  if (!(tab in TAB && number)) EMBED.setHash(`#${state.tab}`);   // (closing an episode above wrote its own tab's address)
  if (tab in TAB && number) {
    const last = state.index[tab].episodes.length - 1;
    openEpisode(Math.min(last, Math.max(0, (Number(number) || 1) - 1)), { startAt: Number(at) || 0 });
  }
}

// an address changed by hand (or a link within the page) on the viewer's own page
window.addEventListener("hashchange", () => { if (state.index) route(location.hash); });

(async () => {
  const response = await fetch("data/index.json");
  if (!response.ok) throw new Error(`episode list: HTTP ${response.status}`);
  state.index = await response.json();
  route(location.hash);
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("w-ready")));
})().catch((error) => {
  $("grid").replaceChildren(el("li", { class: "w-empty", text: `The episodes could not be loaded: ${error.message ?? error}` }));
});
