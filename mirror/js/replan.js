// replan.js: the closed-loop replanning figure (paper figure single_attempt_narrow_v2), drawn live in the page and
// played by site.js. Geometry comes from js/replan-geometry.js (tools/extract_replan.py); the story follows the
// figure's old video (website_figures/drift_animation/animate.py): the agent drifts off the plan, re-plans from
// where it actually is, fails at the milestone three times, re-planning after each, and a critical action sampled
// once carries it through.
//
// It is an inline scene for site.js: window.INLINE_SCENES.replan = { ready, render(T, ctx), pause, caption, setNarrow }.
(() => {
  "use strict";
  const G = window.REPLAN_GEOM, svg = document.querySelector(".replan-svg");
  if (!G || !svg) return;
  const NS = "http://www.w3.org/2000/svg";
  const H = G.H;
  const P = p => [p[0], H - p[1]];                                   // PDF points (y up) -> SVG (y down)
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = u => (u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const back = u => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
  // colours come from the theme (css/theme.css): plans green, the executed path in Mirror's blue, failures red, the
  // critical action in amber
  const TS = getComputedStyle(document.documentElement), tok = (n, d) => TS.getPropertyValue(n).trim() || d;
  const C = { ink: tok("--ink", "#1c1b1a"), plan: tok("--plan", "#2e9a5e"), blue: tok("--mirror", "#3e6fd8"),
              red: tok("--fail", "#dc4436"), orange: tok("--crit", "#e07b00"), bg: tok("--bg", "#ffffff") };
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
    if (m[k] !== v) { m[k] = v; e.setAttribute(k, v); }
  }
  const f2 = v => (Math.round(v * 100) / 100).toString();
  const arclen = pts => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; };
  function pointAt(pts, cum, s) {
    if (s <= 0) return pts[0];
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const u = clamp((s - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-9));
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
  }
  const pathD = pts => "M" + pts.map(p => f2(p[0]) + "," + f2(p[1])).join("L");

  // ---------------------------------------------------------------- scene
  const defs = el("defs", {}, svg);
  // the plan corridor: the figure's 15 stacked translucent bands, as one smooth gradient that also fades out
  // left and right (the page has no frame around the figure)
  const bandC = H - G.band.centre, half = G.band.halves[0];
  const vg = el("linearGradient", { id: "rp-band-v", x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
  const peak = 1 - Math.pow(1 - G.band.alpha, G.band.halves.length);
  for (let i = 0; i <= 16; i++) {
    const d = Math.abs(i / 16 * 2 - 1) * half;                       // distance from the centre line
    const n = G.band.halves.filter(h => h >= d).length + (1 - d / half) * .8;
    el("stop", { offset: i / 16, "stop-color": C.plan, "stop-opacity": f2(.26 * (1 - Math.pow(1 - G.band.alpha, n)) / peak) }, vg);
  }
  const hg = el("linearGradient", { id: "rp-band-h", x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
  [[0, 0], [.14, 1], [.86, 1], [1, 0]].forEach(([o, a]) => el("stop", { offset: o, "stop-color": "#fff", "stop-opacity": a }, hg));
  const bm = el("mask", { id: "rp-band-mask", maskUnits: "userSpaceOnUse", x: -10, y: 0, width: 150, height: H }, defs);
  el("rect", { x: -6, y: bandC - half, width: 134, height: 2 * half, fill: "url(#rp-band-h)" }, bm);
  el("rect", { x: -6, y: bandC - half, width: 134, height: 2 * half, fill: "url(#rp-band-v)", mask: "url(#rp-band-mask)",
               class: "rp-band" }, svg);

  // the milestone: a wall with one narrow passage (dashed), and its log icon
  const W = G.wall, wx = W.x;
  const wall = el("g", { class: "rp-wall" }, svg);
  el("line", { x1: wx, x2: wx, y1: H - W.upper[1], y2: H - W.upper[0], stroke: C.ink, "stroke-width": 1.7 }, wall);
  el("line", { x1: wx, x2: wx, y1: H - W.lower[1], y2: H - W.lower[0], stroke: C.ink, "stroke-width": 1.7 }, wall);
  el("line", { x1: wx, x2: wx, y1: H - W.gap[1], y2: H - W.gap[0], stroke: C.ink, "stroke-width": .5,
               "stroke-dasharray": "1.5 1.3", opacity: .55 }, wall);
  const icon = el("image", { href: "media/replan_log.png", x: G.log.x, y: H - G.log.top, width: G.log.w, height: G.log.h }, wall);
  icon.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "media/replan_log.png");   // older Safari
  el("text", { x: G.log.x + G.log.w + 2.2, y: H - G.log.top + G.log.h * .64, class: "rp-label" }, wall).textContent = "Milestone";

  // layers, bottom to top
  const planLayer = el("g", {}, svg), trajLayer = el("g", {}, svg), markLayer = el("g", {}, svg), headLayer = el("g", {}, svg);

  // plans: dashed green arrows, drawn out from their re-plan point; superseded ones fade
  const plans = [];
  {
    // the first plan is the figure's own short arrow, one cubic (start, c1, c2, end); the others go through the
    // milestone's passage (animate.py's plans)
    const B = G.arrow0.bez.map(P), pts0 = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
      pts0.push([a * B[0][0] + b * B[1][0] + c * B[2][0] + d * B[3][0], a * B[0][1] + b * B[1][1] + c * B[2][1] + d * B[3][1]]);
    }
    const all = [pts0, ...G.plans.map(pl => pl.map(P))];
    all.forEach((pts, k) => {
      const g = el("g", { class: "rp-plan" }, planLayer);
      const cum = arclen(pts), len = cum[cum.length - 1];
      const m = el("mask", { id: `rp-pm${k}`, maskUnits: "userSpaceOnUse", x: -10, y: -10, width: 150, height: 100 }, defs);
      const reveal = el("path", { d: pathD(pts), fill: "none", stroke: "#fff", "stroke-width": 3, "stroke-linecap": "round",
                                  "stroke-dasharray": `${f2(len)} ${f2(len + 1)}`, "stroke-dashoffset": f2(len) }, m);
      el("path", { d: pathD(pts.slice(0, -2)), fill: "none", stroke: C.plan, "stroke-width": .55, "stroke-dasharray": "1.5 1.35",
                   "stroke-linecap": "round", mask: `url(#rp-pm${k})` }, g);
      // arrowhead at the end, along the last segment
      const [x2, y2] = pts[pts.length - 1], [x1, y1] = pts[pts.length - 3];
      const L = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / L, uy = (y2 - y1) / L, hl = 2.6, hw = 1.35;
      const head = el("path", { d: `M${f2(x2)},${f2(y2)} L${f2(x2 - ux * hl - uy * hw)},${f2(y2 - uy * hl + ux * hw)} ` +
                                   `L${f2(x2 - ux * hl * .72)},${f2(y2 - uy * hl * .72)} L${f2(x2 - ux * hl + uy * hw)},${f2(y2 - uy * hl - ux * hw)}Z`,
                                fill: C.plan, opacity: 0 }, g);
      plans.push({ g, reveal, head, len, pts });
    });
  }
  // re-plan points
  const dots = G.dots.map(d => el("circle", { cx: d[0], cy: H - d[1], r: 0, fill: C.plan }, markLayer));

  // the agent: blue trajectory, then the orange critical action through the passage
  const blue = G.blue.map(P), bcum = arclen(blue), BL = bcum[bcum.length - 1];
  const orange = G.orange.map(P), ocum = arclen(orange), OL = ocum[ocum.length - 1];
  const bluePath = el("path", { d: pathD(blue), fill: "none", stroke: C.blue, "stroke-width": .75, "stroke-linecap": "round",
                                "stroke-linejoin": "round", "stroke-dasharray": `${f2(BL)} ${f2(BL + 1)}`, "stroke-dashoffset": f2(BL) }, trajLayer);
  const orangePath = el("path", { d: pathD(orange), fill: "none", stroke: C.orange, "stroke-width": 1.15, "stroke-linecap": "round",
                                  "stroke-linejoin": "round", "stroke-dasharray": `${f2(OL)} ${f2(OL + 1)}`, "stroke-dashoffset": f2(OL) }, trajLayer);
  const endDot = el("circle", { cx: orange[orange.length - 1][0], cy: orange[orange.length - 1][1], r: 0, fill: C.orange,
                                stroke: C.bg, "stroke-width": .55 }, markLayer);
  // failed attempts: an x at the milestone, and the attempt's number beside the loop that follows
  const fails = G.fails.map(([x, y, s]) => {
    const g = el("g", { opacity: 0 }, markLayer), h = s * .42;
    el("path", { d: `M${-h},${-h}L${h},${h}M${-h},${h}L${h},${-h}`, stroke: C.bg, "stroke-width": 2.1, "stroke-linecap": "round" }, g);
    el("path", { d: `M${-h},${-h}L${h},${h}M${-h},${h}L${h},${-h}`, stroke: C.red, "stroke-width": 1.05, "stroke-linecap": "round" }, g);
    return { g, x, y: H - y };
  });
  const circles = G.circles.map(([x, y], i) => {
    const g = el("g", { opacity: 0 }, markLayer);
    el("circle", { r: 2.9, fill: C.bg, stroke: C.red, "stroke-width": .5 }, g);
    el("text", { y: 1.45, "text-anchor": "middle", class: "rp-num" }, g).textContent = String(i + 1);
    return { g, x, y: H - y };
  });
  const crit = el("text", { x: 78.6, y: H - 46.2, class: "rp-crit", opacity: 0 }, markLayer);
  el("tspan", { x: 78.6 }, crit).textContent = "Critical action";
  el("tspan", { x: 78.6, dy: 5.3 }, crit).textContent = "sampled once";
  // a marker rides the tip of the path being drawn
  const headDot = el("circle", { r: 1.25, fill: C.blue, stroke: C.bg, "stroke-width": .5, opacity: 0 }, headLayer);

  // ---------------------------------------------------------------- timeline
  // Six steps (one per click): follow the plan; drift; re-plan and fail; re-plan and fail twice more;
  // the critical action; every plan only had to point the way. Speeds in points per second.
  const BLUE_V = 26, PLAN_V = 62, ORANGE_V = 16, ARROW0_S = .5;
  const knots = [[0, 0]];                 // (time, arc length) of the blue tip
  const T = { dot: [], plan: [], fail: [] };
  const segs = [];
  let t = .35;                            // the scenery is there from the start; the agent sets off
  knots.push([t, 0]);
  const walk = idx => { t += (bcum[idx] - knots[knots.length - 1][1]) / BLUE_V; knots.push([t, bcum[idx]]); };
  const pause = d => { t += d; knots.push([t, knots[knots.length - 1][1]]); };
  const replan = (k, idx) => {
    T.dot[k] = t;
    const dur = k === 0 ? ARROW0_S : plans[k].len / PLAN_V;
    T.plan[k] = [t + .12, dur];
    pause(.12 + dur + .15);
  };
  const fail = j => { T.fail[j] = t; };
  const seg = names => { segs.push({ start: segs.length ? segs[segs.length - 1].end : 0, end: t, names }); };
  const R = G.replanAt, F = G.failAt;
  // 1. a plan points the way and the agent sets off along it
  walk(R[0]); replan(0, R[0]); walk(13); pause(.5); seg(["follow"]);
  // 2. noisy actions carry it off the plan
  walk(R[1]); pause(.6); seg(["drift"]);
  // 3. a new plan from where it actually is, through the milestone; it reaches the wall but misses the passage
  replan(1, R[1]); walk(F[0]); fail(0); pause(.8); seg(["replan", "fail 1"]);
  // 4. re-plan and try again, twice
  walk(R[2]); replan(2, R[2]); walk(F[1]); fail(1); pause(.5);   // the x and its number land before the next try
  walk(R[3]); replan(3, R[3]); walk(F[2]); fail(2); pause(.8); seg(["fail 2", "fail 3"]);
  // 5. one more re-plan, and a critical action sampled once carries it through
  walk(R[4]); replan(4, R[4]); walk(blue.length - 1);
  T.orange = [t + .1, OL / ORANGE_V];
  pause(.1 + OL / ORANGE_V + .9); seg(["critical action"]);
  // 6. every plan only had to point the right way for the next few steps
  T.recap = t + .1;
  pause(.1 + plans.length * .22 + 1.4); seg(["recap"]);
  const TOTAL = t;
  const blueS = time => {
    let i = 1;
    while (i < knots.length - 1 && knots[i][0] <= time) i++;
    const [t0, s0] = knots[i - 1], [t1, s1] = knots[i];
    return time <= t0 ? s0 : time >= t1 ? s1 : s0 + (s1 - s0) * (time - t0) / (t1 - t0);
  };

  // ---------------------------------------------------------------- render
  let lastT = null;
  function render(time) {
    time = clamp(time, 0, TOTAL);
    if (time === lastT) return;
    lastT = time;
    const recap = clamp((time - T.recap) / .6);                     // 0 -> 1 as the recap comes in
    // the agent
    const s = blueS(time), onBlue = time > knots[1][0] && s < BL - .01 && time < T.orange[0];
    put(bluePath, "stroke-dashoffset", f2(BL - s));
    put(bluePath, "opacity", f2(1 - .55 * recap));
    const so = clamp((time - T.orange[0]) / T.orange[1]) * OL;
    put(orangePath, "stroke-dashoffset", f2(OL - so));
    put(orangePath, "visibility", so > 0 ? "visible" : "hidden");
    put(orangePath, "opacity", f2(1 - .4 * recap));
    const tip = onBlue ? pointAt(blue, bcum, s) : so > 0 && so < OL ? pointAt(orange, ocum, so) : null;
    put(headDot, "opacity", tip ? "1" : "0");
    if (tip) {
      put(headDot, "cx", f2(tip[0]));
      put(headDot, "cy", f2(tip[1]));
      put(headDot, "fill", so > 0 ? C.orange : C.blue);
    }
    const ed = clamp((time - T.orange[0] - T.orange[1]) / .35);
    put(endDot, "r", f2(1.7 * back(ed) * (ed > 0 ? 1 : 0)));
    put(crit, "opacity", f2(clamp((time - T.orange[0] - .25) / .5)));
    // plans and their re-plan points
    plans.forEach((p, k) => {
      const [t0, dur] = T.plan[k];
      const u = clamp((time - t0) / dur), grown = ease(u);
      put(p.reveal, "stroke-dashoffset", f2(p.len * (1 - grown)));
      put(p.head, "opacity", u >= 1 ? "1" : "0");
      const next = T.plan[k + 1], superseded = next ? clamp((time - next[0]) / .45) : 0;
      // in the recap every plan comes back, one after another
      const again = clamp((time - T.recap - .22 * k) / .4);
      put(p.g, "opacity", f2(u > 0 ? Math.max(1 - .72 * superseded, again) : 0));
      const dk = clamp((time - T.dot[k]) / .3);
      put(dots[k], "r", f2(1.05 * back(dk) * (dk > 0 ? 1 : 0)));
    });
    // failed attempts
    fails.forEach((f, j) => {
      const u = clamp((time - T.fail[j]) / .35);
      put(f.g, "opacity", f2(u > 0 ? Math.min(1, u * 2) * (1 - .45 * recap) : 0));
      put(f.g, "transform", `translate(${f.x},${f2(f.y)}) scale(${f2(.4 + .6 * back(u))})`);
      const c = circles[j], uc = clamp((time - T.fail[j] - .25) / .35);
      put(c.g, "opacity", f2(uc > 0 ? Math.min(1, uc * 2) * (1 - .45 * recap) : 0));
      put(c.g, "transform", `translate(${c.x},${f2(c.y)}) scale(${f2(.4 + .6 * back(uc))})`);
    });
  }
  render(0);

  const info = { segs: segs.map(s => ({ start: s.start, dur: s.end - s.start, names: s.names })), total: TOTAL };
  window.INLINE_SCENES = window.INLINE_SCENES || {};
  window.INLINE_SCENES.replan = {
    ready: Promise.resolve(info),
    render: T => render(T),
    pause() {},
    caption: () => null,
    setNarrow() {},
  };
})();
