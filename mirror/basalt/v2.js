"use strict";
// The BASALT episode viewer, redesigned (../js/design.js has its three looks): FindCave and MakeWaterfall, each with
// the supervised and the self-improving V2A model on the same 11 worlds. The list is one model's 11 episodes as stills
// (never the two mixed); an episode is its video, with the success or the end marked on the scrubber, and a switch to
// the other model on the same world. Every value from the data file is set with textContent or an attribute.

const VIDEO_BASE = "https://huggingface.co/datasets/hwryu/mirror_diamond_eval/resolve/main";
// the task and its success rule, in the paper's words (Appendix: BASALT)
const TASKS = {
  findcave: { title: "FindCave", goal: "Find a cave and go inside.", rule: "Success: the agent enters a cave or ravine, within 3 minutes." },
  waterfall: { title: "MakeWaterfall", goal: "Build a waterfall, then take a picture of it.",
    rule: "Success: the agent places the water bucket and ends the episode facing the waterfall, within 5 minutes." },
};
const VERSIONS = { supervised: "Supervised", self_improving: "Self-improving" };
// what each model used, in one line
const VERSION_NOTE = {
  supervised: "Supervised: the video planner with VPT's pretrained inverse dynamics model (action labels from human gameplay); no environment interaction.",
  self_improving: "Self-improving: the video planner with a V2A model trained by ~5 hours of self-play; video only, no action labels.",
};

const $ = (id) => document.getElementById(id);
const state = { index: null, tab: "findcave", version: "supervised", number: null, episode: null, listScroll: 0 };

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
const pad = (n) => String(n).padStart(2, "0");
const worldLabel = (n) => `World ${pad(n + 1)}`;
const episodesOf = (version = state.version) => state.index[state.tab][version].episodes;
// (PR #4) MakeWaterfall: the episode ends where the agent counts as pressing Esc; success is judged just before it, and
// the video may go on past it
const endsEarly = (e) => e.end != null && e.end < e.seconds - 0.1;

const player = createPlayer($("player"));
const clock = player.clock;
$("ep-side").append(player.views);

// ------------------------------------------------------------------ the list
function showTab(tab) {
  state.tab = tab;
  for (const b of $("tabs").children) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  $("goal").replaceChildren(el("strong", { text: TASKS[tab].goal }), ` ${TASKS[tab].rule} Neither model is given a task reward.`);
  renderList();
}

function renderList() {
  // the two models, each with how many worlds it succeeded on
  $("versions").replaceChildren(...Object.entries(VERSIONS).map(([version, title]) => {
    const episodes = episodesOf(version), wins = episodes.filter((e) => e.success).length;
    return el("button", { role: "tab", type: "button", "aria-selected": String(version === state.version),
      "aria-label": `${title}: ${wins} of ${episodes.length} worlds`, onclick: () => selectVersion(version) },
    title, el("small", { text: `${wins}/${episodes.length}` }));
  }));
  $("version-note").textContent = VERSION_NOTE[state.version];
  $("episodes").replaceChildren(...episodesOf().map((e) => {
    const when = e.success_time != null && e.end == null ? ` at ${clock(e.success_time)}` : "";
    return el("li", {}, el("button", {
      class: `v2-card${e.success ? " v2-success" : ""}`, type: "button", "data-n": String(e.n),
      "aria-label": `${worldLabel(e.n)}: ${e.success ? `success${when}` : "no success"}`, onclick: () => openEpisode(e.n),
    },
    el("span", { class: "v2-thumb" }, el("img", { src: `thumbs/${state.tab}/${state.version}/${pad(e.n)}.webp`, alt: "", loading: "lazy", decoding: "async" })),
    el("span", { class: "v2-card-text" },
      el("span", { class: "v2-card-title", text: worldLabel(e.n) }),
      el("span", { class: "v2-card-sub" }, el("span", { class: "v2-glyph", "aria-hidden": "true", text: e.success ? "✓" : "✗" }),
        el("span", { text: e.success ? (DESIGN === "list" ? "Success" : `Success${when}`) : "No success" }))),
    el("span", { class: "v2-row-time", text: e.success_time != null && e.end == null ? clock(e.success_time) : "" }),
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

function selectVersion(version) {
  if (version === state.version) return;
  state.version = version;
  renderList();
  EMBED.setHash(`#${state.tab}/${version}`);
}

// ------------------------------------------------------------------ one episode
function openEpisode(n, { version = state.version, startAt = 0 } = {}) {
  const episode = episodesOf(version)[n];
  if (!episode) return;
  const opening = $("episode").hidden;
  if (opening) state.listScroll = window.scrollY;
  if (version !== state.version) { state.version = version; renderList(); }   // the list follows the model on show
  state.number = n;
  state.episode = episode;
  $("ep-task").textContent = TASKS[state.tab].title;
  $("ep-title").textContent = worldLabel(n);
  const verdict = episode.end != null
    ? `${episode.success ? "Success" : "No success"} at the end (${clock(episode.end)})`
    : episode.success ? `Success at ${clock(episode.success_time)}` : "No success";
  $("ep-outcome").replaceChildren(el("span", { class: episode.success ? "v2-ok" : "" },
    el("span", { "aria-hidden": "true", text: episode.success ? "✓" : "✗" }), verdict));
  // the two models on this world, each with its outcome
  $("model-toggle").replaceChildren(...Object.entries(VERSIONS).map(([v, title]) => {
    const other = episodesOf(v)[n];
    return el("button", { role: "tab", type: "button", "aria-selected": String(v === version),
      "aria-label": `${title}: ${other.success ? "success" : "no success"}`,
      onclick: () => { if (v !== state.version) openEpisode(n, { version: v, startAt: 0 }); } },
    el("span", { class: other.success ? "v2-mark-ok" : "v2-mark-no", "aria-hidden": "true", text: other.success ? "✓ " : "✗ " }), title);
  }));
  $("ep-prev").disabled = n === 0;
  $("ep-next").disabled = n === episodesOf().length - 1;
  $("now").replaceChildren(el("span", { class: "v2-now-label", text: "Goal" }), el("span", { class: "v2-now-goal", text: TASKS[state.tab].goal }));
  EMBED.setHash(`#${state.tab}/${version}/${n + 1}`);
  if (opening) {
    $("list").hidden = true;
    $("episode").hidden = false;
    document.documentElement.classList.add("v2-in-episode");
    window.scrollTo({ top: 0, behavior: "instant" });
    $("episode").focus({ preventScroll: true });
  }
  // the success (FindCave) or the end where it was judged (MakeWaterfall), which jumps there; what follows the verdict
  // is tinted, green after a success and red after an early end without one
  const marks = [], bands = [];
  if (episode.success_time != null && episode.end == null) {
    marks.push({ t: episode.success_time, kind: "success", label: `Success ${clock(episode.success_time)}`, title: "Jump to the success", jump: episode.success_time - 8 });
  }
  if (episode.end != null) {
    marks.push({ t: episode.end, kind: episode.success ? "success" : "end", label: `End ${clock(episode.end)}`,
      title: `Jump to the end: the episode ends where the agent ends it (its first gray video plan after a second of movement), or at the time limit`, jump: episode.end - 20 });
  }
  if (episode.success_time != null) bands.push({ from: episode.success_time, to: episode.seconds, kind: "done" });
  else if (endsEarly(episode)) bands.push({ from: episode.end, to: episode.seconds, kind: "failed" });
  const folder = state.index[state.tab][version].folder;
  player.load({
    sources: Object.fromEntries(episode.views.map((v) => [v, `${VIDEO_BASE}/${folder}/${v}/${pad(n)}.mp4`])),
    duration: episode.seconds, startAt, marks, bands,
  });
}

function closeEpisode() {
  if ($("episode").hidden) return;
  player.unload();
  state.episode = null;
  $("episode").hidden = true;
  $("list").hidden = false;
  document.documentElement.classList.remove("v2-in-episode");
  window.scrollTo({ top: state.listScroll, behavior: "instant" });
  $("episodes").querySelector(`[data-n="${state.number}"]`)?.focus({ preventScroll: true });
  EMBED.setHash(`#${state.tab}/${state.version}`);
}

// ------------------------------------------------------------------ wiring
for (const b of $("tabs").children) {
  b.addEventListener("click", () => {
    if (b.dataset.tab === state.tab) return;
    showTab(b.dataset.tab);
    EMBED.setHash(`#${state.tab}/${state.version}`);
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
  "mirror-closed": () => {
    closeEpisode();
    setTimeout(() => window.scrollTo({ top: 0, behavior: "instant" }), 450);
  },
});

// #waterfall, #waterfall/self_improving, or #waterfall/self_improving/3@60: a task, a model, a world (from 1), a time
function route(hash) {
  const [where, at] = decodeURIComponent(hash.replace(/^#/, "")).split("@");
  const [tab, version, number] = where.split("/");
  closeEpisode();
  if (version in VERSIONS) state.version = version;
  showTab(tab in TASKS ? tab : "findcave");
  if (tab in TASKS && version in VERSIONS && number) {
    const last = episodesOf().length - 1;
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
