// split.js: fits the two figure chapters (.chapter-split: closed-loop replanning and in-context learning) to the
// screen. css/site.css styles the classes it sets ("split chapters: stacked, solo").
//
// - .split-stack: portrait, small or narrowish windows (narrow, or under STACK_W wide) stack the chapter, figure first,
//   in a grey box as wide as the animations' boxes. The lava figure then shows one plot at a time.
// - .split-solo: when the whole step list doesn't fit under (or beside) the figure, only the current step shows. The
//   stacked lava chapter is always solo.
// - --split-fig: a stacked figure that still leaves too little room for the current step is drawn smaller inside its box.
// - the step list keeps the height of its tallest step (min-height), so the copy doesn't move as steps open and close.
// A phone held sideways (html.short) has its own compact layout (site.js fitShort), so this leaves it alone.
(() => {
  "use strict";
  const STACK_W = 1000, STACK_H = 640;   // below this width (on a screen at least this tall) the chapters stack (800x600 sits beside)
  const BOTTOM = 12;                     // stacked: room kept under the current step
  const MIN_FIG = .5;                    // stacked: a figure is drawn no smaller than this share of its full size
  const FIG_GIVE = .7, COPY_MIN = .78;   // stacked: ... and shrinks to FIG_GIVE before the copy's type does, to COPY_MIN
  const LIST_FIG = .9;                   // stacked: ... and no smaller than this to keep the whole step list
  const root = document.documentElement, $ = (s, e = document) => e.querySelector(s), $$ = (s, e = document) => [...e.querySelectorAll(s)];
  const chapters = $$(".chapter-split").map(el => ({
    el, stage: $(".split-stage", el), copy: $(".split-copy", el), steps: $(".steps", el), lis: $$(".steps > li", el),
    fig: $("figure", el), lava: el.classList.contains("chapter-lava"),
  }));
  if (!chapters.length) return;
  const lavaText = () => { const S = (window.INLINE_SCENES || {}).lava; if (S && S.fitText) S.fitText(); };
  const h = e => e ? e.getBoundingClientRect().height : 0;

  // the copy's height above the list, and the list's height with step i open: all steps listed, or step i alone
  function measureCopy(c) {
    // the open step's text sits max(5px, .42cqw) under its heading (css .steps li.on .step-body > p)
    const cq = c.el.classList.contains("split-stack") ? innerWidth : c.stage.clientWidth;
    const pad = Math.max(5, .0042 * cq);
    const shut = [], open = [];
    for (const li of c.lis) {
      const body = $(".step-body", li), p = $(".step-body > p", li), bh = h(body);
      shut.push(h(li) - bh);
      open.push(p.scrollHeight - (parseFloat(getComputedStyle(p).paddingTop) || 0) + pad);
    }
    const sum = shut.reduce((a, b) => a + b, 0);
    return {
      head: h(c.copy) - h(c.steps),
      list: Math.max(...open.map(o => sum + o)),
      solo: Math.max(...shut.map((s, i) => s + open[i] + 1)),   // (+ the border under the step shown alone)
    };
  }

  function fit(c) {
    const { el, stage, steps, fig } = c;
    const short = root.classList.contains("short"), narrow = root.classList.contains("narrow");
    const stack = !short && (narrow || (innerWidth < STACK_W && innerHeight >= STACK_H));
    el.classList.toggle("split-stack", stack);
    el.classList.remove("split-solo");
    el.style.removeProperty("--split-fig");
    c.copy.style.zoom = "";
    steps.style.minHeight = "";
    if (c.lava) lavaText();
    if (short) return;
    const m = measureCopy(c);
    let solo;
    if (!stack) {
      // beside the figure: the copy is centred in the chapter's 16:9 box, and has to fit in its height
      solo = m.head + m.list > stage.clientHeight - 8;
    } else {
      const cs = getComputedStyle(stage), navH = parseFloat(getComputedStyle(root).getPropertyValue("--nav-h")) || 52;
      const avail = innerHeight - navH - parseFloat(cs.paddingTop) - (parseFloat(cs.rowGap) || 0) - BOTTOM - m.head;
      // the figure can be drawn smaller: its plot shrinks with its width, its title and legend keep their size
      // (and its controls under it, in its bottom margin: site.js "controls")
      const figH = h(fig) + (parseFloat(getComputedStyle(fig).marginBottom) || 0), art = c.lava ? $(".lava-grid", fig) : $(".replan-svg", fig);
      const svg = c.lava ? $$(".lava-svg", fig).find(s => h(s) > 0) : art, sh = h(svg);
      // the whole list stays when it fits beside a figure drawn a little smaller (LIST_FIG)
      solo = c.lava || figH - (1 - LIST_FIG) * sh + m.list > avail;
      const need = figH + (solo ? m.solo : m.list) - avail;
      if (need > 0) {
        // the figure gives way first, to FIG_GIVE of its size; then the copy's type, to COPY_MIN; then the figure again,
        // to MIN_FIG (on a small or zoomed phone the copy ran off the screen, and the figure alone at half size was
        // too small to read)
        const w = art.getBoundingClientRect().width, copyH = m.head + (solo ? m.solo : m.list);
        let f = Math.max(FIG_GIVE, (sh - need) / sh), rest = need - sh * (1 - f);
        if (rest > 0) {
          const k = Math.max(COPY_MIN, 1 - rest / copyH);
          c.copy.style.zoom = k.toFixed(3);
          rest -= copyH * (1 - k);
        }
        if (rest > 0) f = Math.max(MIN_FIG, f - rest / sh);
        el.style.setProperty("--split-fig", Math.floor(w * f) + "px");
        if (c.lava) lavaText();
      }
    }
    el.classList.toggle("split-solo", solo);
    steps.style.minHeight = Math.ceil(solo ? m.solo : m.list) + "px";
    // the opening screenshot covers the plot's place in the stacked lava figure: the figure keeps its height from step
    // to step (no jump at the first plot)
    if (c.lava) {
      const grid = $(".lava-grid", fig);
      fig.style.setProperty("--lg-h", stack ? Math.round(fig.getBoundingClientRect().bottom - grid.getBoundingClientRect().bottom) + "px" : "");
    }
  }
  const fitAll = () => chapters.forEach(fit);

  // refit when the layout changes: a resize (not the small height changes of a phone's toolbars, as site.js), the
  // page's narrow/short classes, the fonts
  let rT = null, lastW = innerWidth, lastH = innerHeight;
  addEventListener("resize", () => {
    if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 140) return;
    lastW = innerWidth;
    lastH = innerHeight;
    clearTimeout(rT);
    rT = setTimeout(fitAll, 160);
  });
  let mode = "";
  new MutationObserver(() => {
    const m = ["narrow", "short", "portrait", "ctl-below"].map(k => root.classList.contains(k) ? k : "").join();
    if (m !== mode) { mode = m; fitAll(); }
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
  if (document.fonts) document.fonts.ready.then(fitAll);
  addEventListener("load", fitAll);
  addEventListener("mirror:figure", fitAll);   // (a figure's code arrived after the page: site.js, data-scripts)
  fitAll();
})();
