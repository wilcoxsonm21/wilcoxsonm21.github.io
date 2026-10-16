// lava.js: the in-context learning figure (paper figure lava_escape), drawn live in the page and played by
// site.js. Every trajectory, marker, arrow, curve and band comes from js/lava-data.js (tools/extract_lava.py), the
// paper figure's own geometry: nothing here reshapes a path. Only the axes, labels and colours of the frame are the
// page's.
//
// It is an inline scene for site.js: window.INLINE_SCENES.lava = { ready, render(T, ctx), pause, caption, setNarrow }.
(() => {
  "use strict";
  const D = window.LAVA_DATA, fig = document.querySelector(".lava-figure");
  if (!D || !fig) return;
  const NS = "http://www.w3.org/2000/svg";
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = u => (u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const out3 = u => 1 - Math.pow(1 - u, 3);
  const back = u => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
  const rgb = c => `rgb(${c.map(v => Math.round(v * 255)).join(",")})`;
  const f2 = v => (Math.round(v * 100) / 100).toString();
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.append(e);
    return e;
  }
  const memo = new WeakMap();
  function put(e, k, v) {
    let m = memo.get(e);
    if (!m) memo.set(e, m = {});
    if (m[k] !== v) { m[k] = v; if (k === "class") e.setAttribute("class", v); else e.setAttribute(k, v); }
  }
  // colours come from the theme (css/theme.css)
  const TS = getComputedStyle(document.documentElement), tok = (n, d) => TS.getPropertyValue(n).trim() || d;
  const DARK = tok("--ink", "#1c1b1a"), BG = tok("--bg", "#ffffff"), MUTED = tok("--muted", "#6e6b67");
  const ESCAPE = tok("--plan", "#2e9a5e");
  // lives are coloured in drawing order along the theme's ramp (the paper samples turbo the same way); the colours
  // only tell lives apart
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const RAMP = ["#3e6fd8", "#2f94c8", "#2fa38c", "#8db33e", "#e3a21a"].map((d, i) => hexRgb(tok(`--lava-${i + 1}`, d)));
  function lifeColour(i, n) {
    const t = n > 1 ? i / (n - 1) : 0, k = Math.min(Math.floor(t * (RAMP.length - 1)), RAMP.length - 2);
    const u = t * (RAMP.length - 1) - k;
    return `rgb(${RAMP[k].map((v, j) => Math.round(v + (RAMP[k + 1][j] - v) * u)).join(",")})`;
  }
  const CURVE = { ours: { shared: tok("--lava-ours", "#3e6fd8"), independent: tok("--lava-ours-ind", "#4aa3e0") },
                  vpt: { shared: tok("--lava-vpt", "#6e6b67"), independent: tok("--lava-vpt-ind", "#a8a5a0") } };
  const S = 283;                                    // every panel's plot box is 283 x 283 pt in the paper figure

  // The type is in viewBox units, so it shrinks with the figure. When the figure is drawn small (a short window, a
  // small phone) the type and the margins it sits in grow by k (fitText), so the ticks stay at least TICK_PX; the plot
  // boxes and every path keep their shape. Each piece placed by the type's size is re-placed by layout(k).
  const TICK = 11.5, TICK_PX = 10, L0 = 46, B0 = 42, T0 = 8, R0 = 10;
  const layout = [];
  const at = (e, f) => { layout.push(k => { const a = f(k); for (const n in a) e.setAttribute(n, a[n]); }); return e; };
  // A panel: a square plot box in pt (as in the paper), data -> box by the panel's own axes, plus room for labels.
  function panel(cell, xlim, ylim, opts) {
    const svg = cell.querySelector("svg");
    // the same frame for every panel, so they share a scale
    at(svg, k => ({ viewBox: `${f2(-L0 * k)} ${f2(-T0 * k)} ${f2(S + (L0 + R0) * k)} ${f2(S + (T0 + B0) * k)}` }));
    const X = x => (x - xlim[0]) / (xlim[1] - xlim[0]) * S, Y = y => (ylim[1] - y) / (ylim[1] - ylim[0]) * S;
    const id = "lv-" + cell.dataset.plot;
    const frame = el("g", { class: "lv-frame" }, svg);
    el("rect", { x: 0, y: 0, width: S, height: S, class: "lv-bg" }, frame);
    for (const v of opts.xticks) el("line", { x1: X(v), x2: X(v), y1: 0, y2: S, class: "lv-grid" }, frame);
    for (const v of opts.yticks) el("line", { x1: 0, x2: S, y1: Y(v), y2: Y(v), class: "lv-grid" }, frame);
    opts.xticks.forEach((v, i) => { at(el("text", { x: X(v), class: "lv-tick", "text-anchor": "middle" }, frame), k => ({ y: f2(S + 15 * k) })).textContent = opts.xfmt[i]; });
    opts.yticks.forEach((v, i) => { at(el("text", { class: "lv-tick", "text-anchor": "end" }, frame), k => ({ x: f2(-6 * k), y: f2(Y(v) + 3.6 * k) })).textContent = opts.yfmt[i]; });
    at(el("text", { x: S / 2, class: "lv-axis", "text-anchor": "middle" }, frame), k => ({ y: f2(S + 35 * k) })).innerHTML = opts.xlabel;
    if (opts.left) {
      at(el("text", { x: -(S / 2), class: "lv-axis", "text-anchor": "middle", transform: "rotate(-90)" }, frame), k => ({ y: f2(-36 * k) })).innerHTML = opts.ylabel;
    }
    el("rect", { x: 0, y: 0, width: S, height: S, class: "lv-spine" }, frame);
    const cp = el("clipPath", { id: id + "-clip" }, el("defs", {}, svg));
    const clipRect = el("rect", { x: 0, y: 0, width: S, height: S }, cp);
    const body = el("g", { "clip-path": `url(#${id}-clip)` }, svg);
    const top = el("g", {}, svg);
    return { svg, X, Y, frame, body, top, clipRect, cell };
  }

  // ---------------------------------------------------------------- trajectories (shared, independent)
  function trajectoryPanel(name, left) {
    const P = D.panels[name], cell = fig.querySelector(`[data-plot="${name}"]`);
    const ticks = [-8, -4, 0, 4, 8], fmt = ["−8", "−4", "0", "4", "8"];
    const pn = panel(cell, P.xlim, P.ylim, { left, xticks: ticks, yticks: ticks, xfmt: fmt, yfmt: fmt,
      xlabel: "Δ<tspan font-style=\"italic\">x</tspan> (blocks)", ylabel: "Δ<tspan font-style=\"italic\">y</tspan> (blocks)" });
    const { X, Y } = pn;
    const lim = 8.5;
    const lives = P.trajectories.map((t, li) => {
      const q = t.pts.map(p => [X(p[0]), Y(p[1])]);
      const cum = [0];
      for (let i = 1; i < q.length; i++) cum.push(cum[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]));
      const len = cum[cum.length - 1] || .01;
      // where the path first leaves the axes (escapes are drawn up to the border, as in the paper)
      let sExit = null;
      for (let i = 1; i < t.pts.length && sExit === null; i++) {
        const [a, b] = [t.pts[i - 1], t.pts[i]];
        if (Math.max(Math.abs(b[0]), Math.abs(b[1])) > lim) {
          let u = 1;
          for (const j of [0, 1]) if (Math.abs(b[j]) > lim) u = Math.min(u, (lim - Math.abs(a[j])) / Math.max(Math.abs(b[j]) - Math.abs(a[j]), 1e-9));
          sExit = cum[i - 1] + (cum[i] - cum[i - 1]) * clamp(u);
        }
      }
      const path = el("path", { d: "M" + q.map(p => f2(p[0]) + "," + f2(p[1])).join("L"), fill: "none", stroke: lifeColour(li, P.trajectories.length),
                                "stroke-opacity": .5, "stroke-width": t.w, "stroke-linecap": "round", "stroke-linejoin": "round",
                                "stroke-dasharray": `${f2(len)} ${f2(len + 10)}`, "stroke-dashoffset": f2(len) }, pn.body);
      return { path, len, sExit, end: t.end || null };
    });
    // the end of each life: a grey x (death) or a green diamond (escape), as in the paper
    const marks = [];
    const mark = (m, life) => {
      const g = el("g", { opacity: 0 }, pn.top), x = X(m.at[0]), y = Y(m.at[1]);
      if (m.kind === "death") {
        el("path", { d: "M-2.5,-2.5L2.5,2.5M-2.5,2.5L2.5,-2.5", stroke: MUTED, "stroke-opacity": .65, "stroke-width": 1.25,
                     "stroke-linecap": "butt" }, g);
      } else {
        el("path", { d: "M0,-5.2L5.2,0L0,5.2L-5.2,0Z", fill: ESCAPE, stroke: BG, "stroke-width": 1.1 }, g);
      }
      marks.push({ g, x, y, life });
    };
    lives.forEach((lf, i) => { if (lf.end) mark(lf.end, i); });   // (the paper's legend symbols are not data: left out)
    // the spawn star and the mean displacement arrow, each over a white halo
    const A = P.arrow, a0 = [X(A.from[0]), Y(A.from[1])], a1 = [X(A.to[0]), Y(A.to[1])];
    const arrow = el("g", { opacity: 0 }, pn.top);
    // as in the paper: the shaft over a white halo; the head filled, outlined dark, over a wider white outline
    const shaftHalo = el("line", { x1: a0[0], y1: a0[1], x2: a0[0], y2: a0[1], stroke: BG, "stroke-width": A.halo_w, "stroke-linecap": "round" }, arrow);
    const shaft = el("line", { x1: a0[0], y1: a0[1], x2: a0[0], y2: a0[1], stroke: DARK, "stroke-width": A.w, "stroke-linecap": "round" }, arrow);
    const tri = "M" + A.head.map(p => f2(X(p[0])) + "," + f2(Y(p[1]))).join("L") + "Z";
    const head = el("g", { opacity: 0 }, arrow);
    el("path", { d: tri, fill: BG, stroke: BG, "stroke-width": A.head_halo_w, "stroke-linejoin": "miter" }, head);
    el("path", { d: tri, fill: DARK, stroke: DARK, "stroke-width": A.head_w, "stroke-linejoin": "miter" }, head);
    el("path", { d: "M" + P.star.map(p => f2(X(p[0])) + "," + f2(Y(p[1]))).join("L") + "Z", fill: BG, stroke: DARK,
                 "stroke-width": 1.6, "stroke-linejoin": "miter" }, pn.top);
    const dy = P.trajectories.reduce((s, t) => s + t.pts[t.pts.length - 1][1], 0) / P.trajectories.length;
    const label = at(el("text", { class: "lv-note", "text-anchor": "end", opacity: 0 }, pn.top), k => ({ x: f2(S - 8 * k), y: f2(S - 24 * k) }));
    at(el("tspan", {}, label), k => ({ x: f2(S - 8 * k) })).textContent = "Mean Δy";
    at(el("tspan", { class: "lv-note-strong" }, label), k => ({ x: f2(S - 8 * k), dy: f2(14 * k) })).textContent =
      (dy >= 0 ? "+" : "−") + Math.abs(dy).toFixed(1) + " blocks";
    return { pn, lives, marks, arrow, shaft, shaftHalo, head, a0, a1, label };
  }

  // ---------------------------------------------------------------- escape rates (Ours, VPT BC)
  const DASH = { solid: null, dashed: "7.4 3.2", dashdot: "4.4 1.6 1 1.6", dotted: "0.1 3.9" };
  function ratePanel(name, left) {
    const R = D.rates[name], cell = fig.querySelector(`[data-plot="${name}"]`);
    const pn = panel(cell, R.xlim, R.ylim, { left, xticks: [1, 10, 20, 30], yticks: [0, .2, .4, .6, .8, 1], xfmt: ["1", "10", "20", "30"],
      yfmt: ["0%", "20%", "40%", "60%", "80%", "100%"], xlabel: "Number of lives", ylabel: "Cumulative escape rate" });
    const { X, Y } = pn;
    const curves = [];
    for (const cond of ["independent", "shared"]) {            // shared on top
      const C = R.curves[cond], col = CURVE[name][cond];
      el("path", { d: "M" + C.band.map(p => f2(X(p[0])) + "," + f2(Y(p[1]))).join("L") + "Z", fill: col, "fill-opacity": .2 }, pn.body);
      const line = el("path", { d: "M" + C.y.map((y, i) => f2(X(i + 1)) + "," + f2(Y(y))).join("L"), fill: "none", stroke: col,
                                "stroke-width": C.w, "stroke-linejoin": "round",
                                "stroke-linecap": C.style === "dotted" ? "round" : "butt" }, pn.body);
      if (C.style === "dotted") line.setAttribute("stroke-width", C.w * 1.15);
      if (DASH[C.style]) line.setAttribute("stroke-dasharray", DASH[C.style]);
      if (cond === "shared" && R.markers) for (const k of R.markers) el("circle", { cx: X(k), cy: Y(C.y[k - 1]), r: R.marker_r, fill: col }, pn.body);
      // the final rate: above the curve that ends higher, below the other
      const other = R.curves[cond === "shared" ? "independent" : "shared"].y[29];
      const tag = at(el("text", { class: "lv-end", "text-anchor": "end", fill: col, opacity: 0 }, pn.top),
                     k => ({ x: f2(X(30) - 4 * k), y: f2(Y(C.y[29]) + (C.y[29] >= other ? -9 : 18) * k) }));
      tag.textContent = Math.round(C.y[29] * 100) + "%";
      curves.push({ cond, tag });
    }
    // where the sweep has got to
    const cursor = el("line", { x1: 0, x2: 0, y1: 0, y2: S, class: "lv-cursor", opacity: 0 }, pn.top);
    const lifeTag = at(el("text", { x: 0, class: "lv-life", "text-anchor": "middle", opacity: 0 }, pn.top), k => ({ y: f2(-k) }));
    // legend, top left as in the paper
    // (it grows less than the type outside the box, so it stays clear of the final rates)
    const lg = at(el("g", { class: "lv-legend" }, pn.top), k => ({ transform: `translate(8,8) scale(${f2(Math.min(k, 1.4))})` }));
    el("rect", { x: 0, y: 0, width: 132, height: 38, rx: 3, class: "lv-legend-bg" }, lg);
    ["shared", "independent"].forEach((cond, i) => {
      const C = R.curves[cond], y = 13 + i * 15, col = CURVE[name][cond];
      const ln = el("line", { x1: 7, x2: 31, y1: y, y2: y, stroke: col, "stroke-width": C.w, "stroke-linecap": C.style === "dotted" ? "round" : "butt" }, lg);
      if (DASH[C.style]) ln.setAttribute("stroke-dasharray", DASH[C.style]);
      if (cond === "shared" && R.markers) el("circle", { cx: 19, cy: y, r: R.marker_r, fill: col }, lg);
      el("text", { x: 37, y: y + 3.6, class: "lv-legend-text" }, lg).textContent = cond === "shared" ? "Shared history" : "Independent lives";
    });
    return { pn, X, curves, cursor, lifeTag };
  }

  const panels = {
    shared: trajectoryPanel("shared", true), independent: trajectoryPanel("independent", false),
    ours: ratePanel("ours", true), vpt: ratePanel("vpt", false),
  };
  const shot = fig.querySelector(".lava-shot");

  // ---------------------------------------------------------------- timeline
  // 1. the challenge; 2. shared history; 3. independent lives; 4. escape rates, ours; 5. VPT BC.
  const BURST = 3.0;                         // seconds for the longest life to be drawn (others in proportion^.55)
  const segs = [];
  let t = 0;
  const seg = (names, dur) => { segs.push({ start: t, dur, names }); t += dur; };
  const tm = {};
  tm.shot = [0, 1.2]; seg(["challenge"], 1.5);
  const burstPlan = P => {
    const maxL = Math.max(...P.lives.map(l => l.len));
    return P.lives.map(l => BURST * Math.pow(l.len / maxL, .55));
  };
  // a panel comes in (on) just after its step starts: a click that has played out holds the exact start time of the
  // next one, and the next step's panel must not show while the reader is still on this one
  const ON = .05;
  tm.shared = { on: t + ON, t0: t + .5, d: burstPlan(panels.shared) }; seg(["shared history"], .5 + BURST + .9);
  tm.independent = { on: t + ON, t0: t + .4, d: burstPlan(panels.independent) }; seg(["independent lives"], .4 + BURST + .9);
  tm.ours = { on: t + ON, t0: t + .4, sweep: 2.4 }; seg(["escape rate: ours"], .4 + 2.4 + .7);
  tm.vpt = { on: t + ON, t0: t + .4, sweep: 2.4 }; seg(["escape rate: VPT BC"], .4 + 2.4 + .7);
  const TOTAL = t;

  function renderBurst(P, plan, time) {
    const local = time - plan.t0;
    put(P.pn.cell, "class", "lava-cell" + (time > plan.on ? " on" : ""));
    let all = 0;
    P.lives.forEach((l, i) => {
      const u = clamp(local / plan.d[i]);
      put(l.path, "stroke-dashoffset", f2(l.len * (1 - out3(u))));
      put(l.path, "visibility", u > 0 ? "visible" : "hidden");
      l.u = u;
      if (u >= 1) all++;
    });
    for (const m of P.marks) {
      const l = P.lives[m.life], frac = l.sExit !== null ? l.sExit / l.len : 1;
      // when the drawn length reaches the end (or, for an escape, the border): invert out3. The eased line has
      // visibly arrived at 97% of its length (u ~ .69), so a death shows then, not at the very end of the ease
      const tEnd = plan.d[m.life] * (1 - Math.cbrt(1 - Math.min(frac, .97)));
      const u = clamp((local - tEnd) / .28);
      put(m.g, "opacity", f2(u > 0 ? Math.min(1, u * 1.6) : 0));
      put(m.g, "transform", `translate(${f2(m.x)},${f2(m.y)}) scale(${f2(.3 + .7 * back(u))})`);
    }
    // the mean displacement arrow grows once every life is drawn
    const ua = clamp((local - BURST - .2) / .7), ea = ease(ua);
    put(P.arrow, "opacity", ua > 0 ? "1" : "0");
    const x2 = P.a0[0] + (P.a1[0] - P.a0[0]) * ea, y2 = P.a0[1] + (P.a1[1] - P.a0[1]) * ea;
    for (const s of [P.shaft, P.shaftHalo]) { put(s, "x2", f2(x2)); put(s, "y2", f2(y2)); }
    put(P.head, "opacity", f2(clamp((ua - .75) / .25)));
    put(P.label, "opacity", f2(clamp((local - BURST - .6) / .5)));
  }
  function renderSweep(P, plan, time) {
    const local = time - plan.t0;
    put(P.pn.cell, "class", "lava-cell" + (time > plan.on ? " on" : ""));
    const u = clamp(local / plan.sweep), life = 1 + 29 * ease(u);
    put(P.pn.clipRect, "width", f2(Math.max(0, P.X(life))));
    const sweeping = u > 0 && u < 1;
    put(P.cursor, "opacity", sweeping ? "1" : "0");
    put(P.cursor, "x1", f2(P.X(life))); put(P.cursor, "x2", f2(P.X(life)));
    put(P.lifeTag, "opacity", sweeping ? "1" : "0");
    put(P.lifeTag, "x", f2(P.X(life)));
    P.lifeTag.textContent = "life " + Math.round(life);
    for (const c of P.curves) put(c.tag, "opacity", f2(clamp((local - plan.sweep - .1) / .45)));
  }

  let lastT = null, current = -1;
  function render(time) {
    time = clamp(time, 0, TOTAL);
    if (time === lastT) return;
    lastT = time;
    // the screenshot gives way to the plots as the first trajectories come in
    const so = 1 - clamp((time - segs[1].start - .05) / .45);
    shot.style.opacity = so.toFixed(3);
    shot.style.visibility = so < .002 ? "hidden" : "visible";
    shot.style.transform = `scale(${(1.0 + .035 * clamp(time / 1.6) - .04 * (1 - so)).toFixed(4)})`;
    renderBurst(panels.shared, tm.shared, time);
    renderBurst(panels.independent, tm.independent, time);
    renderSweep(panels.ours, tm.ours, time);
    renderSweep(panels.vpt, tm.vpt, time);
    // on narrow screens one plot at a time: the one the current step is about
    let s = 0;
    segs.forEach((g, i) => { if (i === 0 || time > g.start + ON) s = i; });   // (once the step has started, as the panels)
    if (s !== current) { current = s; fig.dataset.step = String(s); }
  }
  render(0);

  // the type's scale k for the figure's current size (see TICK_PX): the ticks are TICK * k * (drawn width / viewBox
  // width) px, and the viewBox widens by (L0 + R0) * k
  let kNow = null;
  function fitText() {
    const svg = [...fig.querySelectorAll(".lava-svg")].find(s => s.getBoundingClientRect().width > 0);
    if (!svg) return;
    const w = svg.getBoundingClientRect().width, den = TICK * w - (L0 + R0) * TICK_PX;
    const k = den > 0 ? Math.min(2.2, Math.max(1, TICK_PX * S / den)) : 2.2;
    if (kNow !== null && Math.abs(k - kNow) < .01) return;
    kNow = k;
    fig.style.setProperty("--lv-k", k.toFixed(3));
    layout.forEach(f => f(k));
  }
  layout.forEach(f => f(1));
  fitText();
  if (window.ResizeObserver) new ResizeObserver(fitText).observe(fig.querySelector(".lava-grid"));

  const info = { segs: segs.map(g => ({ start: g.start, dur: g.dur, names: g.names })), total: TOTAL };
  window.INLINE_SCENES = window.INLINE_SCENES || {};
  window.INLINE_SCENES.lava = {
    ready: Promise.resolve(info),
    render: T => render(T),
    pause() {},
    caption: () => null,
    setNarrow() {},
    fitText,
  };
})();
