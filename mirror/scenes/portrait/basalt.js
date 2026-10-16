// Portrait layout of the BASALT scene, for phones held upright (?portrait; see tools/build_scenes.py). The task card
// reflows to the frame's width. The human demonstrations stand in a column under the video model, their branches
// joining a trunk on the right. The closed loop runs down the frame (plan, V2A model, environment) and returns up the
// right side. The gallery sets each task's three results in a column. For the results table the gallery is pushed up
// out of the frame by the table rising in below it (rather than folding into strips above it), and the table fills the
// frame. It is transposed, the methods running down the side in their groups under the four tasks, so Mirror's
// highlights fall on its two rows. Every click starts just under the top of the stage, which sits right under the title
// on the page, and the frame shows only as much of the stage as the click fills (FILL). Same content, beats and timing
// as the deck.
window.PORTRAIT = !window.SCENE_PORTRAIT ? null : (() => {
  const W = 1080, H = 1380, TOP = 36;      // TOP: where every click's content starts
  const TASK = [960, 620];                 // the task card (the deck's is 1240 x 330)
  // demonstrations: a column of tiles DG tile pixels apart, centred on the middle one; for the video model their
  // arrows join a trunk at x = FAN
  const FAN = 910, DG = 22, column = (cx, cy, s) => ({ demo0: [cx, cy - (234 + DG) * s, s], demo1: [cx, cy, s],
                                            demo2: [cx, cy + (234 + DG) * s, s] });
  // the loop, top to bottom on the axis AX: video model, plan, V2A model, environment, then the episode's timeline;
  // the replanning arrow returns up the rail at x = RAIL
  const AX = 475, RAIL = 950, TS = 1.08;   // TS: the plan's and the environment's zoom
  const VM_Y = TOP + 68, PLAN_T = VM_Y + 142, PLAN_B = PLAN_T + 253 * TS;
  const V2A_Y = PLAN_B + 88 + 75, ENV_T = V2A_Y + 75 + 116, ENV_B = ENV_T + 253 * TS;
  const TL_T = ENV_B + 80, TL_W = 1020;     // the timeline's top (its stage names sit above its line) and width
  // the gallery: MakeWaterfall on the left, FindCave on the right, each under its name (two 500 px columns are as wide
  // as the frame allows, and the tiles keep the episode tile's shape, which moves into the third waterfall's slot)
  const GX = [280, 800], GY = [0, 1, 2].map(i => TOP + 189 + 294 * i), GL = TOP + 22;
  // the transposed table, alone in the frame: method names in the first NAME_W pixels, then one column per task. Y_TASK
  // is the rule under "Task" and Y_MID the one under the task names, from the table's top rule; then the five groups'
  // names, the twelve methods' rows and the footnote
  const TB = { W: 1032, top: TOP, NAME_W: 255, Y_TASK: 56, Y_MID: 158, GRP_H: 55, ROW_H: 68 };
  const TBL_H = TB.Y_MID + 5 * TB.GRP_H + 12 * TB.ROW_H + 58;
  // the push between them: the table fades in 60 px under the gallery's last row, and both move up by PUSH
  const PUSH = GY[2] + 117 + 60 - TB.top;

  // How much of the stage each click fills (the page shows that much of the frame), timed to the click's own moves in
  // seconds (beat seconds / SP, the scene's SPEED). The frame grows to the whole height as the demonstrations come in,
  // shrinks to the column as it moves up under the video model (VMB: when that beat starts), grows back before the
  // loop's timeline comes in, shrinks to the gallery once the episode tile is in its slot (GAL: the loop's hold, after
  // which the gallery beat starts), and grows back with the push to the table.
  const SP = 1.35, VMB = 3.6 * .5 / SP + 4, GAL = 19 / SP, FULL = H;
  const VM_COL = [490, 732, 1.16];                          // the column under the video model: centre and zoom
  const VM_B = VM_COL[1] + (2 * 234 + 2 * DG + 16 - 117 + 44) * VM_COL[2];   // the bottom of its label
  const FILL = [TOP + TASK[1] + 124,
                [{ h: FULL, at: .45 / SP, dur: .75 / SP }, { h: VM_B + 40, at: VMB + .05 / SP, dur: .8 / SP }],
                [{ h: FULL, at: 2 / SP, dur: .9 / SP }, { h: GY[2] + 117 + 40, at: GAL + 1.3 / SP, dur: .7 }],
                { h: FULL, at: .35 / SP, dur: 1.3 / SP }, FULL, FULL];

  const P = {
    W, H, FILL, FAN, RAIL, PUSH,
    PLAN: [(PLAN_T + PLAN_B) / 2, TS],
    NODE: { task: TASK, tl: [TL_W, 110], tbl: [TB.W, TBL_H] },
    INIT: {
      task: { cx: 540, cy: TOP + TASK[1] / 2, sc: 1 },
      ...Object.fromEntries(Object.entries(column(540, 864, 1.03)).map(([id, [cx, cy, sc]]) => [id, { cx, cy, sc }])),
      vm: { cx: 490, cy: TOP + 75 },
      plan: { cx: AX, cy: VM_Y }, v2a: { cx: AX, cy: V2A_Y },
      acts: { cx: AX + 111, cy: (V2A_Y + 75 + ENV_T) / 2, sc: 1 },   // beside the arrow into the environment
      env: { cx: AX, cy: (ENV_T + ENV_B) / 2, sc: TS }, tl: { cx: 540, cy: TL_T + 55 },
      g_wf0: { cx: GX[0], cy: GY[0] }, g_wf1: { cx: GX[0], cy: GY[1] }, g_wf2: { cx: GX[0], cy: GY[2] },
      g_cave0: { cx: GX[1], cy: GY[0] }, g_cave1: { cx: GX[1], cy: GY[1] }, g_cave2: { cx: GX[1], cy: GY[2] },
      lab_wf: { cx: GX[0], cy: GL }, lab_cave: { cx: GX[1], cy: GL },
      tbl: { cx: 540, cy: TB.top + TBL_H / 2, dy: PUSH },
    },
    // camera layouts (the scene's LAYOUT): each node's centre and zoom
    LAYOUT: {
      task: { task: [540, TOP + TASK[1] / 2, 1] },
      demos: { task: [540, TOP + TASK[1] * .6 / 2, .6], ...column(540, 864, 1.03) },
      vm: { task: [540, TOP + 100, .45], vm: [490, TOP + 75, 1], ...column(...VM_COL) },
      loop: { vm: [AX, VM_Y, .9] },
      gallery: { env: [GX[0], GY[2], 500 / 540], g_wf0: [GX[0], GY[0], 1], g_wf1: [GX[0], GY[1], 1],
                 g_wf2: [GX[0], GY[2], 1], g_cave0: [GX[1], GY[0], 1], g_cave1: [GX[1], GY[1], 1],
                 g_cave2: [GX[1], GY[2], 1], lab_wf: [GX[0], GL, 1], lab_cave: [GX[1], GL, 1] },
    },
    // The results table, transposed: "Task" spans the four task columns, and each group of methods is a run of rows
    // under its name. Mirror's rows keep the deck's ids (tint_m1, h_m1, m1_0 ...), so the highlight beats find them.
    table(tb, { TASKS, COLS, GROUPS, MIRROR }) {
      const add = html => tb.insertAdjacentHTML("beforeend", html);
      const rule = (x, y, w, h) =>
        add(`<div class="rule" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`);
      const COL_W = (TB.W - TB.NAME_W) / TASKS.length, cx = c => TB.NAME_W + c * COL_W;
      // each method's row top, below its group's name
      const rowY = [];
      let y = TB.Y_MID;
      for (const [, a, b] of GROUPS) { y += TB.GRP_H; for (let c = a; c < b; c++, y += TB.ROW_H) rowY[c] = y; }
      const Y_BOT = y + 4;
      for (const m in MIRROR) {
        const c = COLS.findIndex(col => col[2] === m);
        add(`<div class="tint" id="tint_${m}" style="left:4px;top:${rowY[c] + 4}px;width:${TB.W - 8}px;
             height:${TB.ROW_H - 8}px;background:${MIRROR[m].fill}"></div>`);
      }
      rule(0, 0, TB.W, 2.5);
      add(`<div class="c grp" style="left:${cx(0)}px;top:6px;width:${TB.W - TB.NAME_W}px;
           height:${TB.Y_TASK - 10}px">Task</div>`);
      rule(cx(0) + 8, TB.Y_TASK, TB.W - TB.NAME_W - 16, 1.4);
      // the long task names break at a word of their camel case, as the deck's two-line method names do
      const head = t => ({ MakeWaterfall: "Make<br>Waterfall", CreateAnimalPen: "Create<br>AnimalPen",
                           BuildVillageHouse: "Build<br>VillageHouse" }[t] || t);
      TASKS.forEach((t, c) => add(`<div class="c hd" style="left:${cx(c)}px;top:${TB.Y_TASK + 6}px;width:${COL_W}px;
                                    height:${TB.Y_MID - TB.Y_TASK - 16}px">${head(t)}</div>`));
      rule(0, TB.Y_MID, TB.W, 1.6);
      for (const [name, a] of GROUPS) {
        const gy = rowY[a] - TB.GRP_H;
        add(`<div class="c grp" style="left:0;top:${gy + 8}px;height:${TB.GRP_H - 16}px;
             justify-content:flex-start">${name}</div>`);
        rule(0, gy + TB.GRP_H - 6, TB.W, 1.4);
      }
      COLS.forEach(([name, vals, m], c) => {
        const style = m ? `font-weight:700;color:${MIRROR[m].color}` : "";
        add(`<div class="c cell" ${m ? `id="h_${m}"` : ""} style="left:16px;top:${rowY[c]}px;height:${TB.ROW_H}px;
             justify-content:flex-start;${style}">${name.replace("-<br>", "-").replace("<br>", " ")}</div>`);
        vals.forEach((v, r) => {
          const dag = v.endsWith("†"), num = dag ? v.slice(0, -1) : v;
          const bold = m && num !== "0" ? "font-weight:700;" : "";
          add(`<div class="c cell${dag ? " dag" : ""}" ${m ? `id="${m}_${r}"` : ""} style="left:${cx(r)}px;
               top:${rowY[c]}px;width:${COL_W}px;height:${TB.ROW_H}px;${bold}">${num}%${dag ? "<sup>†</sup>" : ""}</div>`);
        });
      });
      rule(0, Y_BOT, TB.W, 2.5);
      add(`<div class="c" style="left:0;top:${Y_BOT + 14}px;height:40px;font-size:28px;color:var(--muted);
           justify-content:flex-start">† Obtained by pre-programmed action sequences rather than learned behavior.</div>`);
    },
  };
  document.head.insertAdjacentHTML("beforeend", `<style>
    #svg { width: ${W}px !important; height: ${H}px !important; }
    #task, #task > .box { width: ${TASK[0]}px !important; height: ${TASK[1]}px !important; }
    #task > .box { font-size: 58px !important; padding: 0 64px !important; }
    #task > .label { top: ${TASK[1] + 22}px !important; font-size: 44px; }
    /* the demonstrations' name under the column's bottom tile */
    #demo1 .label { top: ${2 * 234 + 2 * DG + 16}px !important; font-size: 32px; }
    /* the plan's and the environment's names under their tiles' left edges, clear of the arrow below */
    #plan .label, #env_lab { left: 0 !important; right: auto !important; font-size: 31px; }
    #acts .label { top: 22px !important; left: 172px !important; right: auto !important; }
    #lab_ft, #lab_replan { translate: -50% 0; }   /* centred on the x the scene gives them */
    #lab_wf .label, #lab_cave .label { font-size: 40px; }
    #tl, #tl .base { width: ${TL_W}px !important; }
    #tl .stage { font-size: 28px !important; }
    #tl .tlab { font-size: 26px !important; }
    #tbl { width: ${TB.W}px !important; height: ${TBL_H}px !important; }
    #tbl .grp { font-size: 34px !important; }
    #tbl .hd { font-size: 33px !important; }
    #tbl .cell { font-size: 40px !important; }
  </style>`);
  // the arrows' drawing layer spans the tall stage
  addEventListener("DOMContentLoaded", () => document.getElementById("svg").setAttribute("viewBox", `0 0 ${W} ${H}`));
  return P;
})();
