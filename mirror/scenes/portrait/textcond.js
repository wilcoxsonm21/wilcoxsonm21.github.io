// Portrait layout of the text-conditioning scene, for phones held upright (?portrait; see tools/build_scenes.py).
// The spawn view sits in the middle of the frame. The two instructions whose targets lie high in the view (swim, ascend
// hill) run up to outcome tiles above it, and the other two (chop tree, dig ground) run down to tiles below, so the four
// tiles can be twice the size of the deck's row. For the chart the figure shrinks to the top and the bars take the lower
// half. Same rings, routes, pills, bars, beats and timing as the deck.
window.PORTRAIT = !window.SCENE_PORTRAIT ? null : (() => {
  const L = 270, R = 810, TOP = 96, BOTTOM = 1092;   // tile centres (x) and tops (y) of the two rows
  const P = {
    W: 1080, H: 1440,
    SPAWN_OPEN: { cx: 540, cy: 718, w: 1000 }, SPAWN: { cx: 540, cy: 712, w: 860 },
    TILE_W: 440,
    // the deck's tasks in its order (theme colours), with each tile's row and its pill's centre line
    TASKS: [
      { id: "swim", color: "#3e6fd8", x: L, target: [104, 157, 44, 14], up: true, tileT: TOP, pillY: 404 },
      { id: "chop", color: "#2e9a5e", x: L, target: [178, 141, 27, 47], tileT: BOTTOM, pillY: 1020 },
      { id: "dig", color: "#8e5bd9", x: R, target: [330, 262, 70, 24], tileT: BOTTOM, pillY: 1020 },
      { id: "hill", color: "#e0a000", x: R, target: [522, 136, 96, 46], up: true, tileT: TOP, pillY: 404 },
    ],
    // the chart: under the shrunken figure, spread over the frame's width, and its labels clear of the page's round
    // button in the frame's bottom-right corner
    BASE_Y: 1180, PCT: 5.7, BAR_W: 112,
    BARS: { viper: { x: 140, v: 2 }, rand: { x: 330, v: 42 }, si: { x: 520, v: 64 }, bc: { x: 760, v: 3 },
            sup: { x: 950, v: 71 } },
    AXIS: [64, 1180, 962, 2], GROUP_Y: 650,
    // the figure's centre (ox, oy) moves to (cx, cy) at scale gs while the chart comes in, leaving room above the group
    // headers for the result's line (the scene's .callout)
    FIG_SIDE: { gs: .42, cx: 540, cy: 300, ox: 540, oy: 718 },
  };
  // this style comes before the scene's own, so a :root prefix lets it win over the scene's rules at their specificity
  document.head.insertAdjacentHTML("beforeend", `<style>
    #fig { width: ${P.W}px !important; height: ${P.H}px !important; }
    :root .pill { font-size: 34px; }
    :root .bar .val { font-size: 46px; top: -60px; }
    :root .mlab { font-size: 32px; }
    :root .glab { font-size: 35px; }
    :root #gain { font-size: 34px; }
    #note { font-size: 33px !important; }
  </style>`);
  // the figure's and the chart's drawing layers span the tall stage
  addEventListener("DOMContentLoaded", () => {
    for (const id of ["figsvg", "chartsvg"]) {
      const s = document.getElementById(id);
      s.setAttribute("width", P.W); s.setAttribute("height", P.H); s.setAttribute("viewBox", `0 0 ${P.W} ${P.H}`);
    }
  });
  return P;
})();
