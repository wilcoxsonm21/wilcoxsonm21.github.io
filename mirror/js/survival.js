// The survival videos' labels, drawn by the page over the clip and under it (the clips hold only game pixels, so the
// text is as sharp as the screen): the speed and a note at each milestone on the execution, and under the screen the
// current goal, the game clock and the twelve milestones as they are reached. Everything follows the video's own
// time, from js/survival-data.js (tools/build_survival.py); the tab's data-episode names the episode.
(() => {
  const DATA = window.SURVIVAL, video = document.querySelector(".cinema-video");
  if (!DATA || !video) return;
  const fig = video.closest(".cinema-figure");
  const speedEl = fig.querySelector(".sv-speed"), toastEl = fig.querySelector(".sv-toast");
  const goalEl = fig.querySelector(".sv-goal"), list = fig.querySelector(".sv-milestones");
  const PAPER = ["log", "planks", "stick", "crafting_table", "wooden_pickaxe", "cobblestone", "stone_pickaxe", "furnace",
    "iron_ore", "iron_ingot", "iron_pickaxe", "diamond"];
  const NAME = { log: "Log", planks: "Planks", stick: "Sticks", crafting_table: "Crafting table",
    wooden_pickaxe: "Wooden pickaxe", cobblestone: "Cobblestone", stone_pickaxe: "Stone pickaxe", furnace: "Furnace",
    iron_ore: "Iron ore", iron_ingot: "Iron ingot", iron_pickaxe: "Iron pickaxe", diamond: "Diamond" };
  const TOAST = 2.2;   // seconds of the clip a milestone's note stays
  const FF = '<svg viewBox="0 0 14 10" aria-hidden="true"><path d="M0 0l7 5-7 5zM7 0l7 5-7 5z"/></svg>';

  // each icon is a button: it jumps the video to just before that milestone (the start of its 1x stretch) and plays
  const LEAD = 3;   // seconds of the clip before the milestone
  const items = PAPER.map(k => {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" title="Jump to ${NAME[k].toLowerCase()}" aria-label="Jump to ${NAME[k].toLowerCase()}">`
      + `<img src="eval/icons/${k}.png" alt="" width="88" height="88"></button>`;
    li.firstChild.addEventListener("click", () => jump(k));
    list.append(li);
    return li;
  });
  function jump(k) {
    const m = ep?.milestones.find(x => x[0] === k);
    if (!m) return;
    video.currentTime = Math.max(0, m[1] - LEAD);
    delete video.dataset.held;   // (a pause the reader made goes: they asked to watch this)
    video.play().catch(() => {});
    kick();
  }

  // the last entry of a time-sorted list at or before t
  const at = (rows, t, time = r => r[0]) => {
    let lo = 0, hi = rows.length - 1, found = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (time(rows[m]) <= t) { found = m; lo = m + 1; } else hi = m - 1; }
    return found;
  };
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  let ep = null, shown = {};
  function choose() {
    const key = document.querySelector(".segmented [aria-selected='true']")?.dataset.episode;
    ep = DATA[key] || null;
    // the notes on the execution: each first-time event, and each death
    // (the episode's last milestone holds to the end)
    if (ep) ep.notes = [...ep.events.map(e => ({ t: e.t, hold: e.key === ep.final,
      html: `<img src="eval/icons/${e.icon}.png" alt=""><span><span class="sv-check">✓</span> ${cap(e.label)}${e.key === ep.final ? "!" : ""}</span>` })),
      ...ep.deaths.map(d => ({ t: d.t, html: "<span>Died · respawned with an empty inventory</span>", death: true }))]
      .sort((a, b) => a.t - b.t);
    shown = {};
    items.forEach((li, i) => { li.firstChild.disabled = !ep?.milestones.some(m => m[0] === PAPER[i]); });
    render();
  }
  function set(key, value, apply) { if (shown[key] !== value) { shown[key] = value; apply(value); } }

  function render() {
    if (!ep) return;
    const t = video.currentTime || 0;
    const sp = ep.speed[Math.max(0, at(ep.speed, t))][1];
    set("speed", sp, v => { speedEl.innerHTML = v > 1 ? `${FF}${v}×` : "1×"; speedEl.classList.toggle("fast", v > 1); });
    const c = ep.clock, i = Math.max(0, at(c, t)), j = Math.min(c.length - 1, i + 1);
    const src = j > i ? c[i][1] + (c[j][1] - c[i][1]) * Math.min(1, (t - c[i][0]) / (c[j][0] - c[i][0])) : c[i][1];
    const g = ep.goals.length ? ep.goals[Math.max(0, at(ep.goals, t))][1] : null;
    set("goal", `${g}|${clock(src)}`, () => {
      goalEl.innerHTML = (g ? `Goal: <b>${g}</b>` : "") + `<span class="sv-clock">${clock(src)} in game</span>`;
    });
    const n = at(ep.notes, t, r => r.t), note = n >= 0 ? ep.notes[n] : null;
    const on = !!note && (note.hold || t - note.t < TOAST);
    set("note", on ? n : -1, () => {
      if (on) { toastEl.innerHTML = note.html; toastEl.classList.toggle("death", !!note.death); }
      toastEl.classList.toggle("on", on);
    });
    const got = new Set(ep.milestones.filter(m => m[1] <= t).map(m => m[0]));
    PAPER.forEach((k, idx) => set("m" + k, got.has(k), v => {
      items[idx].classList.toggle("got", v);
      if (v && t > 0) { items[idx].classList.add("pop"); setTimeout(() => items[idx].classList.remove("pop"), 450); }
    }));
  }

  let raf = 0;
  const loop = () => { raf = 0; render(); if (!video.paused && !video.ended) raf = requestAnimationFrame(loop); };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  ["timeupdate", "play", "seeked", "loadedmetadata", "ended"].forEach(e => video.addEventListener(e, kick));
  // a new clip (a tab picked, or the stacked one swapped in): its episode's data
  video.addEventListener("loadstart", choose);
  document.querySelectorAll(".segmented button").forEach(b => b.addEventListener("click", () => setTimeout(choose, 0)));
  choose();
})();
