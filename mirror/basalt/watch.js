"use strict";
// (a malformed % in the address, "#%", threw "URI malformed" and broke the page; it reads as no address)
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return ""; } };
// The BASALT evaluation episodes, to browse the results by eye, in the look of the page's survival section
// (../css/watch.css): FindCave and MakeWaterfall, each model's 11 worlds a grid of its own (one model per grid, never
// mixed), each still marked with its verdict; an episode plays in the survival player (../js/watch-player.js), with
// a switch to the other model on the same world. Every value from the data file is set with textContent or an attribute.

const VIDEO_BASE = "https://huggingface.co/datasets/hwryu/mirror_diamond_eval/resolve/main";
// the website's own videos (tools/mirror_fast/): 4x and 16x copies of each execution, and the plan and the execution
// in one video, side by side and stacked, at 1x, 4x and 16x
const FAST_BASE = "https://huggingface.co/datasets/mwilcoxson/selfimprovingvisiontoactionmodelswebsitevideos/resolve/main";
const copies = (folder, view, n) => ({ 1: `${VIDEO_BASE}/${folder}/${view}/${pad(n)}.mp4`,
  4: `${FAST_BASE}/${folder}/${view}_4x/${pad(n)}.mp4`, 16: `${FAST_BASE}/${folder}/${view}_16x/${pad(n)}.mp4` });
const both = (folder, n) => Object.fromEntries(["side", "stack"].map((view) => [view, { 1: `${FAST_BASE}/${folder}/${view}/${pad(n)}.mp4`,
  4: `${FAST_BASE}/${folder}/${view}_4x/${pad(n)}.mp4`, 16: `${FAST_BASE}/${folder}/${view}_16x/${pad(n)}.mp4` }]));
// the same videos fragmented, streamed piece by piece where the browser can (FragStream in ../js/watch-player.js)
const frag = (folder, n) => Object.fromEntries([["exec", "raw"], ["side", "side"], ["stack", "stack"]].map(([key, view]) => [key,
  Object.fromEntries([1, 4, 16].map((k) => [k, `${FAST_BASE}/frag/${folder}/${view}${k === 1 ? "" : `_${k}x`}/${pad(n)}.mp4`]))]));
// each task: a bold line, then the rules (the user's wording, 10-16; BASALT's own descriptions are in MineRL's
// herobraine/env_specs/basalt_specs.py). MakeWaterfall's "picture" is the agent ending the episode while facing its
// waterfall: its video plan turns gray there (the data's end), which is when the episode is judged; the data has no
// time for the waterfall's placing, so nothing here claims one
const TASKS = {
  findcave: { title: "FindCave", lead: "Find a cave or ravine and walk inside.", blurb: "The agent has three minutes, and cannot dig down.",
    goal: "find a cave", won: "found a", what: "cave", hit: "Found a cave", limit: 180, jumpLead: 4 },
  waterfall: { title: "MakeWaterfall", lead: "Build a waterfall.", blurb: "The agent has five minutes, and must step back to take an aesthetic picture.",
    goal: "build a waterfall", won: "built a", what: "waterfall", hit: "Picture taken", limit: 300, jumpLead: 5 },
};
const VERSIONS = { supervised: "Supervised", self_improving: "Self-improving" };
// what each model was trained on, in the Diamond viewer's wording (the user, 10-16)
const VERSION_NOTE = {
  supervised: "Trained on human gameplay with action labels, no environment interaction during training.",
  self_improving: "Trained on action-free video, then 5 hours of self-play.",
};

const $ = (id) => document.getElementById(id);
const state = { index: null, tab: "findcave", version: "supervised", number: null, episode: null, listScroll: 0 };
const pad = (n) => String(n).padStart(2, "0");
const worldLabel = (n) => `World ${n + 1}`;
const episodesOf = (version = state.version) => state.index[state.tab][version].episodes;
// (PR #4) MakeWaterfall: the episode ends where the agent ends it (its first gray video plan after a second of
// movement, or the time limit), and success is judged there; FindCave's success has its own judged time
const verdictAt = (e) => (e.end != null ? e.end : e.success_time);
const endsEarly = (e) => e.end != null && e.end < e.seconds - 0.1;
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

const player = createWatchPlayer($("player"));
const clock = player.clock;
// what happened in a failed episode, said plainly (the user, 10-16): every FindCave failure ran its three minutes; a
// MakeWaterfall failure either ran out of time or ended itself early (it "took its picture") and was not judged a success
function failure(e) {
  if (state.tab === "findcave") return { head: "didn't find a cave", card: "Didn't find a cave", note: "No cave", cap: "Didn't find a cave in three minutes" };
  if (e.end != null && e.end < TASKS.waterfall.limit - 1) return { head: "ended early", card: `Ended early at ${clock(e.end)}`, note: "Ended early", cap: `Ended early at ${clock(e.end)}` };
  return { head: "ran out of time", card: "Ran out of time", note: "Ran out of time", cap: "Ran out of time at 5:00" };
}
const outcome = (e) => (e.success ? `${TASKS[state.tab].hit} at ${clock(verdictAt(e))}` : failure(e).card);

// ------------------------------------------------------------------ the list
function showTab(tab) {
  if (!state.index) return;   // (the list hasn't loaded: its note says so, and it tries again)
  state.tab = tab;
  for (const b of $("tabs").children) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  $("note").replaceChildren(el("strong", { text: TASKS[tab].lead }), ` ${TASKS[tab].blurb}`);
  $("sections").replaceChildren(...Object.entries(VERSIONS).map(([version, title]) => {
    const episodes = episodesOf(version), wins = episodes.filter((e) => e.success).length;
    return el("section", { class: "w-section" },
      el("div", { class: "w-section-head" }, el("h3", { text: title }), el("span", { text: `${wins} of ${episodes.length} worlds` })),
      el("p", { class: "w-section-note", text: VERSION_NOTE[version] }),
      el("ul", { class: "w-grid" }, ...episodes.map((e) => el("li", {}, el("button", {
        class: "w-card", type: "button", "data-key": `${version}/${e.n}`, onclick: () => openEpisode(e.n, { version }),
        "aria-label": `${worldLabel(e.n)}, ${title}: ${outcome(e)}`,
      },
      el("span", { class: "w-thumb" }, el("img", { src: `thumbs/${tab}/${version}/${pad(e.n)}.webp`, alt: "", loading: "lazy", decoding: "async" }),
        el("span", { class: `w-badge ${e.success ? "w-ok" : "w-no"}`, "aria-hidden": "true", text: e.success ? "✓" : "✗" })),
      el("span", { class: "w-cap" }, el("b", { text: worldLabel(e.n) }), el("span", { class: e.success ? "w-win" : "", text: outcome(e) })))))));
  }));
}

// ------------------------------------------------------------------ one episode
function openEpisode(n, { version = state.version, startAt = 0 } = {}) {
  const episode = episodesOf(version)[n];
  if (!episode) return;
  const opening = $("episode").hidden;
  if (opening) state.listScroll = window.scrollY;
  state.version = version;
  state.number = n;
  state.episode = episode;
  const task = TASKS[state.tab];
  $("ep-eyebrow").textContent = `${task.title} · ${VERSIONS[version]}`;
  const fail = episode.success ? null : failure(episode);
  $("ep-title").replaceChildren(...(episode.success ? [`${worldLabel(n)} ${task.won} `, el("span", { class: "mk", text: task.what })] : [`${worldLabel(n)} ${fail.head}`]));
  // the two models on this world
  $("models").replaceChildren(...Object.entries(VERSIONS).map(([v, title]) => {
    const other = episodesOf(v)[n];
    return el("button", { role: "tab", type: "button", "aria-selected": String(v === version), onclick: () => { if (v !== state.version) openEpisode(n, { version: v }); } },
      title, el("span", { class: "seg-sep", text: " · " }), el("span", { class: "seg-sub", text: other.success ? "success" : "no success" }));
  }));
  $("ep-prev").disabled = n === 0;
  $("ep-next").disabled = n === episodesOf(version).length - 1;
  EMBED.setHash(`#${state.tab}/${version}/${n + 1}`);
  if (opening) {
    $("list").hidden = true;
    $("episode").hidden = false;
    $("episode").focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  // the verdict: FindCave's success, or where MakeWaterfall's episode ends (judged there). Checked by eye for all 28
  // successes (10-16): the cave entries and the gray-plan ends are right. Its mark and note come half a second early at
  // an end, as a self-improving episode's end is its video's last frame, which playback never quite reaches.
  // A pill jumps to just before it: "Jump to the success" (the user, 10-16), or "Jump to the end" of a failed early end.
  const at = verdictAt(episode) ?? (endsEarly(episode) ? episode.end : null);
  const markAt = at != null && episode.end != null ? Math.max(0, at - 0.5) : at;
  // (a small pill, "✓ 1:29", that fits the goal's row on a phone: the user, 10-16; its label says what it does)
  const jumpLabel = `Jump to the success (${clock(at ?? 0)})`;
  // (successes only: a failure has nothing to jump to, the user 10-16)
  const jump = at != null && episode.success ? el("button", { class: "w-jump w-ok", type: "button", title: jumpLabel, "aria-label": jumpLabel,
    onclick: () => { player.seek(Math.max(0, at - (episode.success ? task.jumpLead : 10))); player.play(); } },
  el("span", { class: "w-jump-mark", "aria-hidden": "true", text: "✓" }), clock(at)) : null;
  player.extra.replaceChildren(...(jump ? [jump] : []));
  const folder = state.index[state.tab][version].folder;
  player.load({
    exec: copies(folder, "raw", n),
    frag: frag(folder, n),
    both: episode.views.includes("plan_idm") ? both(folder, n) : null,
    duration: episode.seconds, startAt,
    ticks: at != null ? [{ t: markAt, title: `${episode.success ? task.hit : fail.note} · ${clock(at)}`, gold: episode.success }] : [],
    toasts: at != null ? [episode.success ? { t: markAt, text: task.hit } : { t: markAt, death: true, text: fail.note }] : [],
    goal: () => task.goal,
    // the outcome, then what the model was trained on
    caption: [
      `${episode.success ? `${task.hit} at ${clock(verdictAt(episode))}` : fail.cap}.`,
      VERSION_NOTE[version],
    ],
  });
}

function closeEpisode() {
  if ($("episode").hidden) return;
  player.unload();
  state.episode = null;
  $("episode").hidden = true;
  $("list").hidden = false;
  window.scrollTo({ top: state.listScroll, behavior: "instant" });
  $("sections").querySelector(`[data-key="${state.version}/${state.number}"]`)?.focus({ preventScroll: true });
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
$("ep-prev").addEventListener("click", () => openEpisode(state.number - 1));
$("ep-next").addEventListener("click", () => openEpisode(state.number + 1));
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  if (e.key === "Escape") { if (!$("episode").hidden) closeEpisode(); else EMBED.escape(); }
  else if ((e.key === "o" || e.key === "O") && state.episode) openEpisode(state.number, { version: state.version === "supervised" ? "self_improving" : "supervised" });
});
EMBED.listen({
  "mirror-route": ({ hash }) => route(hash),
  "mirror-closed": () => { closeEpisode(); setTimeout(() => window.scrollTo({ top: 0, behavior: "instant" }), 450); },
});

// #waterfall, #waterfall/self_improving, or #waterfall/self_improving/3@60: a task, a model, a world (from 1), a time
function route(hash) {
  const [where, at] = safeDecode(hash.replace(/^#/, "")).split("@");
  const [tab, version, number] = where.split("/");
  closeEpisode();
  if (version in VERSIONS) state.version = version;
  showTab(tab in TASKS ? tab : "findcave");
  if (!(tab in TASKS && version in VERSIONS && number)) EMBED.setHash(`#${state.tab}`);   // (closing an episode above wrote its own tab's address)
  if (tab in TASKS && version in VERSIONS && number) {
    const last = episodesOf(version).length - 1;
    openEpisode(Math.min(last, Math.max(0, (Number(number) || 1) - 1)), { version, startAt: Number(at) || 0 });
  }
}

// an address changed by hand (or a link within the page) on the viewer's own page
window.addEventListener("hashchange", () => { if (state.index) route(location.hash); });

// the list; if it can't load, a plain note, and it tries again when the connection is back (it showed the browser's raw
// error, and a tab clicked then threw)
async function loadList() {
  try {
    const response = await fetch("data/index.json");
    if (!response.ok) throw new Error(`episode list: HTTP ${response.status}`);
    state.index = await response.json();
  } catch (error) {
    $("sections").replaceChildren(el("p", { class: "w-empty", text: navigator.onLine
      ? "The episodes couldn’t load. Reload the page to try again."
      : "The episodes need a connection. They load once you’re back online." }));
    addEventListener("online", loadList, { once: true });
    return;
  }
  route(location.hash);
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("w-ready")));
}
loadList();
