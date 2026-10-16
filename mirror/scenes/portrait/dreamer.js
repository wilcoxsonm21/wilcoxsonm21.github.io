// Portrait layout of the Minecraft results chart, for phones held upright (?portrait; see tools/build_scenes.py). The
// twelve milestone panels form a grid two wide and six tall, in the deck's reading order (its top row fills the first
// three grid rows, its bottom row the last three, each with its own "Success rate (%)"), every panel twice as wide as
// in the deck with its icon under it, so the values on the bars can be read on a phone. The legend's Offline and
// Online blocks stack under the grid. The chart starts at the top of the stage, right under the page's caption, and the
// frame ends under the last legend block shown: it grows as each block comes in (FILL), and the footnote moves down
// with it. Same bars, colours, beats and timing as the deck: the figure's groups only move (scenes/dreamer.html calls
// arrange() before its first frame and update() with every frame), and each beat's wave of bars sweeps the grid in
// reading order.
window.PORTRAIT = !window.SCENE_PORTRAIT ? null : (() => {
  const W = 1080;
  const COLS = 3, ROWS = 4;
  const GL = 60, GR = 1040, GAP = 30;            // grid: left and right edges, gap between columns
  const PW = (GR - GL - (COLS - 1) * GAP) / COLS;
  const ICON = 48, ICON_GAP = 8, ROW_GAP = 24;   // icon under each plot, and the space before the next row
  const LS = 2.35;                               // scale of the legend and axis labels (figure units -> stage px)
  const LABEL = 1.05;                            // the values on the bars: a touch larger for their bar than in the deck
  const TOP = 30, BOTTOM = 30, LEG_GAP = 36, BLOCK_GAP = 36, FOOT_GAP = 26;
  const BLOCK_H = 64.7 * LS, FOOT_H = 10.1 * LS;  // a legend block's and the footnote's height (the deck's, scaled)
  const LEGEND = LEG_GAP + BLOCK_H + BLOCK_GAP + BLOCK_H + FOOT_GAP + FOOT_H;
  const PH = 158;                                // plot height
  const ROW = PH + ICON_GAP + ICON + ROW_GAP;    // pitch of the grid rows
  const LEG_TOP = TOP + ROWS * ROW - ROW_GAP + LEG_GAP;
  const ROOM_OFF = LEG_GAP + BLOCK_H, ROOM_ON = BLOCK_GAP + BLOCK_H;   // what each legend block adds to the chart's height
  const H = Math.ceil(TOP + ROWS * ROW - ROW_GAP + LEGEND + BOTTOM);   // the full chart
  let FOOT = null;                               // the footnote's layer, which update() moves

  function arrange() {
    const $ = id => document.getElementById(id);
    const svg = $("fig"), root = $("figure_1");
    Object.assign($("figbox").style, { left: "0px", top: "0px", width: W + "px", height: H + "px" });
    Object.assign(svg.style, { width: W + "px", height: H + "px" });
    svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const layer = () => root.appendChild(document.createElementNS(svg.namespaceURI, "g"));
    const MAIN = layer();
    FOOT = layer();
    const group = (parent, tf, ...ids) => {
      const g = document.createElementNS(svg.namespaceURI, "g");
      g.setAttribute("transform", tf);
      for (const id of ids) g.append($(id));
      parent.append(g);
      return g;
    };
    const box = id => $(id).getBBox();
    const pathStyle = id => $(id).querySelector("path").style;
    const fill = id => $(id).querySelector("g[style]").style;

    // the colour of a method's values above its bars, where the chart sets them when a bar is too short to hold one
    const OUTSIDE = [];
    for (let m = 0; m < 12; m++) for (let r = 0; r < 2 && !OUTSIDE[m]; r++) for (let p = 0; p < 6 && !OUTSIDE[m]; p++) {
      if (box(`lbl-m${m}-r${r}-p${p}`).y < box(`bar-m${m}-r${r}-p${p}`).y) OUTSIDE[m] = fill(`lbl-m${m}-r${r}-p${p}`).fill;
    }

    // each panel (its two shaded halves, the dashed line between them, the bars, their values and the axis line) maps
    // from the deck's figure units onto its grid cell, stretched more across than down; the values and lines are
    // scaled back so they look as in the deck
    let ring = null;
    for (let r = 0; r < 2; r++) for (let p = 0; p < 6; p++) {
      const i = 6 * r + p, col = i % COLS, row = Math.floor(i / COLS);
      const lo = 3 + 13 * r + 2 * p, sep = 1 + 12 * r + p, axis = 7 + 12 * r + p;
      const a = box(`patch_${lo}`), b = box(`patch_${lo + 1}`);
      const x0 = a.x, y0 = a.y, sx = PW / (b.x + b.width - a.x), sy = PH / a.height, k = LABEL * sx / sy;
      const X = GL + col * (PW + GAP), Y = TOP + row * ROW;
      const bars = [], lbls = [];
      for (let m = 0; m < 12; m++) { bars.push(`bar-m${m}-r${r}-p${p}`); lbls.push(`lbl-m${m}-r${r}-p${p}`); }
      // each value sits at the top of its bar and scales about that point. One that no longer fits inside its bar
      // moves above it, in the colour the chart gives values there
      const place = bars.map((id, m) => {
        const bb = box(id), l = box(lbls[m]), below = l.y + l.height - bb.y;
        const out = l.y >= bb.y && (below + 1) * k > bb.height;
        if (out) fill(lbls[m]).fill = OUTSIDE[m];
        return { ax: bb.x + bb.width / 2, ay: bb.y, dy: out ? -below - 2.98 : 0 };
      });
      group(MAIN, `translate(${X} ${Y}) scale(${sx} ${sy}) translate(${-x0} ${-y0})`,
            `patch_${lo}`, `patch_${lo + 1}`, `line2d_${sep}`, ...bars, ...lbls, `line2d_${axis}`);
      lbls.forEach((id, m) => {
        const { ax, ay, dy } = place[m];
        $(id).setAttribute("transform", `translate(${ax} ${ay}) scale(${LABEL} ${k}) translate(${-ax} ${-ay + dy})`);
      });
      Object.assign(pathStyle(`line2d_${sep}`), { strokeWidth: 1.6 / sx, strokeDasharray: `${4 / sy},${4.5 / sy}` });
      pathStyle(`line2d_${axis}`).strokeWidth = 2.6 / sy;
      // the milestone's icon, centred under the panel
      const ic = box(`AnnotationBbox_${i + 1}`), s = ICON / ic.height;
      group(MAIN, `translate(${X + PW / 2} ${Y + PH + ICON_GAP}) scale(${s}) translate(${-(ic.x + ic.width / 2)} ${-ic.y})`,
            `AnnotationBbox_${i + 1}`);
      // the oracle's diamond result (bottom-right panel): its ring goes round the value and the bar, as in the deck
      if (r === 1 && p === 5) {
        const l = box(lbls[11]), { ax, ay, dy } = place[11], kl = LABEL * sx;
        const top = Y + (ay - y0) * sy + (l.y + dy - ay) * kl, base = Y + PH;
        // on a phone it is drawn larger than the value and bar need, nudged right into the free space past the panel's
        // edge, so it stays clear of the neighbouring bar's "0"
        ring = { cx: X + (ax - x0) * sx + (l.x + l.width / 2 - ax) * kl + 16, cy: (top + base) / 2, r: (base - top) / 2 + 24 };
      }
    }
    // one "Success rate (%)" for each deck row (three grid rows), left of them and centred on their plots
    for (let r = 0; r < 2; r++) {
      const per = 6 / COLS, t = box(`text_${r + 1}`), mid = TOP + per * r * ROW + ((per - 1) * ROW + PH) / 2;
      group(MAIN, `translate(${GL - 30} ${mid}) scale(${LS}) translate(${-(t.x + t.width / 2)} ${-(t.y + t.height / 2)})`,
            `text_${r + 1}`);
    }

    // the legend: the Offline block, the Online block under it, both at the panels' left edge, and the footnote at
    // their right
    const PX0 = box("patch_3").x, PX1 = box("patch_14").x + box("patch_14").width;
    const head = box("head-offline");
    const offline = ["head-offline", "desc-offline", "mk-m3", "mk-m4"], online = ["head-online", "desc-online"];
    for (let m = 0; m < 12; m++) (m < 6 ? offline : online).push(`sw-m${m}`, `leg-m${m}`);
    for (const m of [6, 7, 8, 9]) online.push(`mk-m${m}`);
    group(MAIN, `translate(${GL} ${LEG_TOP}) scale(${LS}) translate(${-PX0} ${-head.y})`, ...offline);
    const dx = box("sw-m6").x - box("sw-m0").x, onTop = LEG_TOP + BLOCK_H + BLOCK_GAP;
    group(MAIN, `translate(${GL} ${onTop}) scale(${LS}) translate(${-(PX0 + dx)} ${-head.y})`, ...online);
    const foot = box("text_3");
    group(FOOT, `translate(${GR} ${onTop + BLOCK_H + FOOT_GAP}) scale(${LS}) translate(${-PX1} ${-foot.y})`, "text_3");
    $("line2d_25").style.display = "none";   // the dashed line between the blocks: they stack instead

    // the ring is drawn in the last beat, when the chart has its full height
    const c = $("ring");
    c.setAttribute("cx", ring.cx); c.setAttribute("cy", ring.cy); c.setAttribute("rx", ring.r); c.setAttribute("ry", Math.max(ring.r * .52, 30));
    c.setAttribute("transform", `rotate(-90 ${ring.cx} ${ring.cy})`);
    c.style.strokeWidth = 6;
  }

  // every frame: the footnote stays under the last legend block shown, moving down as each block's heading fades in,
  // as the bottom of the frame does (FILL). The heading comes before the block's entries, so nothing shows where the
  // footnote still is
  function update(st) {
    const dy = (1 - st["head-offline"].o) * ROOM_OFF + (1 - st["head-online"].o) * ROOM_ON;
    FOOT.setAttribute("transform", `translate(0 ${-dy})`);
  }

  // the bars' wave runs through the grid in reading order, and reaches the last panel when the deck's does
  const lag = (r, p, colGap, rowGap) => {
    const i = 6 * r + p;
    return i % COLS * colGap + Math.floor(i / COLS) * ((6 - COLS) * colGap + rowGap) / (ROWS - 1);
  };
  // how much of the stage each click fills: the grid and the footnote, then the Offline block comes in (click 1) and
  // the Online one (click 3), each with its heading's fade (0 to .45 s into the click, eased as the frame is)
  const FILL = [H - ROOM_OFF - ROOM_ON, { h: H - ROOM_ON, at: 0, dur: .45 }, H - ROOM_ON, { h: H, at: 0, dur: .45 }, H, H];
  return { W, H, FILL, arrange, update, lag };
})();
