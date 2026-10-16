// Portrait layout of the intro scene, for phones held upright (?portrait; see tools/build_scenes.py). The flow runs
// down the frame: context and text side by side, the Video Model under them and the video plan below it. For the
// problem the chain moves to the left with the plan at its foot, the environment comes in at the top right, and the
// "?" sits under it: the dashed arrows run right from the plan and up to the environment. When the V2A model comes in,
// the plan and the environment stand side by side with the model below them: the plan's arrow runs down into the model
// and the model's runs up to the environment. The paired data comes in under the model, and the camera moves the group
// a little to the left while the self-improving loop runs down the right edge and under the model, as in the deck.
// Every layout starts near the top of the stage (the page sets the title right above it), so the room a click does
// not use is at the bottom of the frame. For the noise beat the camera closes in: the model moves
// down-left, the action's arrow turns up into the sum (+) on its way to the environment, and the noise comes into the
// sum from the right, inside the loop's rail; the beat after it folds back to the loop's layout. Same boxes, clips,
// beats and timing as the deck.
window.PORTRAIT = !window.SCENE_PORTRAIT ? null : (() => {
  const DIM = .32, PLAN_O = .6;     // the deck's dimmed and secondary opacities
  const CARD = .78 / .92;           // the card's scale per unit of the environment's, so it can cover the video
  // V2A on: the plan and the environment side by side on a centre line (row), the model dm below it, the action bars
  // beside the model's arrow up to the environment, and the paired data under the model. These layouts leave the
  // opacities to the beats (null).
  const group = (row, s, L, R, M, sm, dm) => ({
    plan: [L, row, s, null], env: [R, row, s, null], v2a: [M, row + dm, sm, null], acts: [R + 90, row + 300, 1, null],
    data: [M, row + dm + 90 * sm + 209.5, .85, null], card: [R, row, CARD * s, null],
  });
  // the videos' tops 64 px down, which leaves room for the badge at the environment's corner
  const centre = group(264, 1, 280, 800, 540, 1.15, 420);   // the group across the frame
  const loop = group(248, .92, 242, 728, 485, 1.1, 410);     // room on the right and below for the loop and its card
  // the same positions with the opacities of a layout the deck calls itself (1 unless given)
  const shown = (L, o) => Object.fromEntries(Object.entries(L).map(([id, p]) => [id, [...p.slice(0, 3), o[id] ?? 1]]));
  // each node's centre, scale and opacity per camera layout (the scene's LAYOUT)
  const LAYOUT = {
    // clicks 1 and 2 start 40 px down
    context: { ctx: [540, 400, 1.8, 1] },
    text:    { ctx: [280, 250, 1.05, 1], txt: [804, 250, 1.2, 1] },
    plan:    { ctx: [355, 180, .7, DIM], txt: [721, 180, .8, DIM], vm: [540, 491, .9, 1], plan: [540, 850, .95, 1] },
    problem: { ctx: [150, 128, .44, DIM], txt: [372, 128, .52, DIM], vm: [260, 354, .6, DIM], plan: [260, 680, .95, 1],
               q: [820, 680, 1, 1], env: [820, 230, .95, 1] },
    // the inputs slide up out of the frame while the plan and the environment take the top
    v2a:     { ...shown(centre, { plan: PLAN_O }), ctx: [150, -160, .2, 0], txt: [372, -160, .25, 0],
               vm: [260, -80, .3, 0], q: [540, 684, .8, 0], oplus: [800, 594, 1, 0], noise: [958, 594, .9, 0] },
    loop,
    // the plan a small input at the top left; the action's run from the model to the corner carries the action bars
    noise:   { plan: [150, 240, .5, PLAN_O], v2a: [370, 810, 1, 1], acts: [610, 760, .9, 1], oplus: [730, 640, 1, 1],
               noise: [898, 640, .9, 1], env: [730, 240, .9, 1], card: [730, 240, CARD * .9, 1] },
    collapse: { ...shown(loop, { plan: PLAN_O }), oplus: [728, 608, .5, 0], noise: [886, 608, .5, 0] },
  };
  // where each node waits, invisible, until it first appears: its first layout
  const first = { ctx: "context", txt: "text", vm: "plan", plan: "plan", q: "problem", env: "problem", v2a: "v2a",
                  acts: "v2a", data: "v2a", card: "v2a", oplus: "v2a", noise: "v2a" };
  const DEFAULT = {};
  for (const id in first) DEFAULT[id] = [...LAYOUT[first[id]][id].slice(0, 3), 0];
  const P = {
    W: 1080, H: 1170, LAYOUT, DEFAULT,   // H: the tallest click (the paired data under the model) and a 45 px margin
    // no FILL: the frame keeps the full stage on every click, so the grey box holds one size through the scene
    LOOP_DX: 73, LOOP_DY: 170,      // the loop's rail, right of the environment, and its run under the model
    CARD_FULL: 400 / (190 * CARD),  // the card covers the environment video
    // a camera move inside a deck beat, timed with the tweens already there: the group makes room as the loop draws
    moves: (STEPS, layout) => {
      STEPS.find(s => s.name === "improve").tw.push(...layout("loop", .1, .8));
    },
  };
  document.head.insertAdjacentHTML("beforeend", `<style>
    #svg { width: ${P.W}px !important; height: ${P.H}px !important; }
    #lab_train { font-size: 34px; }
    #ctx .label, #txt .label { font-size: 42px; }
  </style>`);
  // the arrows' drawing layer spans the tall stage
  addEventListener("DOMContentLoaded", () => {
    document.getElementById("svg").setAttribute("viewBox", `0 0 ${P.W} ${P.H}`);
  });
  return P;
})();
