// Portrait layout of the DeepMind Control / OGBench / Atari scene, for phones held upright (?portrait; see
// tools/build_scenes.py). The three suites stack: first as big rollout tiles with their names beside them, then as
// three plots one above the other, each with its metric up its left side (the labels at the right end of the Atari
// curves still name every method). For the summary the table rises in from below and pushes the plots up out of the
// frame, as the BASALT table does its gallery; it fills the frame from the top, with each group's name on a line above
// its rows, and the frame shrinks to it (FILL). Same curves, beats and timing as the deck.
window.PORTRAIT = !window.SCENE_PORTRAIT ? null : (() => {
  const TEXT = 1.35;                       // type scale: the stage is drawn about a third of its size on a phone
  const HX = 48;                           // left edge of the headers (and of the table)
  const PX0 = 126, PW = 642, PH = 256;     // plot left edge, width, height
  const Y0 = [16, 456, 896];               // top of each suite's band: header tile, then the plot and its ticks
  const PT = Y0.map(y => y + 116);
  const XLABEL_Y = PT[2] + PH + 82, H = XLABEL_Y + 50;
  // the table: its height from the scene's rules (88 px of header, then three groups of 3, 3 and 2 rows, each under
  // its name, and the expert row), all at the table's type scale
  const T = 1.6, TOP = 36, ROW = 40 * T, SUB = 34 * T, GAP = 14 * T;
  const TBL_H = 88 * T + 8 + 3 * SUB + 2 * GAP + 8 * ROW + GAP + ROW + 6;
  // the push: the table starts 60 px under the x label, and it and the plots move up by PUSH
  const PUSH = XLABEL_Y + 20 + 60 - TOP;
  return {
    W: 1080, H, TEXT, PW, PH, PT, PX: [PX0, PX0, PX0],
    YLABEL: -82,                           // the metric's baseline, left of the tick labels (plot space)
    TILE_HEAD: i => [HX, Y0[i], .19],
    // intro: each rollout tile on the left, its suite's name beside it
    intro: (i, key) => {
      const top = 70 + 440 * i, cy = top + 180;
      return { ["tile_" + key]: [80, top, .9], ["name_" + key]: [480, cy - 6, 1], ["sub_" + key]: [480, cy + 48, 1] };
    },
    // header: the name beside the small tile, as in the deck
    head: (i, key, NAME, SUB_SIZE) => ({ ["name_" + key]: [HX + 96, Y0[i] + 34, 34 / NAME],
                                         ["sub_" + key]: [HX + 96, Y0[i] + 68, 24 / SUB_SIZE] }),
    XLABEL: [PX0 + PW / 2, XLABEL_Y],
    // summary: the plots leave by the top as the table rises into their place
    CAM_SUMMARY: { s: 1, tx: 0, ty: -PUSH },
    INIT: { pan_table: { y: PUSH } },
    SUMMARY: () => [['pan_table', 'y', 0]],
    // the frame stays whole through the plots, and shrinks to the table once the push has landed
    FILL: [H, H, H, H, H, { h: TOP + TBL_H + 64, at: .9, dur: .9 }],
    TABLE: { TEXT: T, SUBHEAD: 34, TL: HX, TR: 1032, top: TOP,
             TCOL: { method: 76, dmc: 588, ogbench: 792, atari: 970 } },
  };
})();
