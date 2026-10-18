#!/usr/bin/env python3
"""Build the scroll-driven scene pages of mirror from the talk's animation pages.

The sources are the stepped 1920x1080 animation pages of the DeckWerk deck grant_servicing/2610_TRI_Mirror_section
(text conditioning is 1920x880, with the deck's title above it). Each one keeps its own timeline (STEPS, stateAt,
apply); this script only repackages it for the website:

  - every base64 data URI is pulled out into scenes/media/ (videos re-encoded with a short keyframe interval, so
    scrubbing them from the scroll position can seek quickly),
  - the DeckWerk bridge is dropped, and scene-adapter.js is appended: it drives the page from the parent page's
    scroll position instead of the presenter's clicks (only with ?scroll; without it the page still steps on
    click/keys),
  - tools/theme.py restyles the scene in the website's theme (css/theme.css): role colours, Source Sans 3 and the
    captions' keyword colours. The deck keeps the talk's look.

usage: python3 tools/build_scenes.py [--only intro,basalt] [--keep-media]
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

import theme

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # mirror/
OUT = os.path.join(ROOT, "scenes")
MEDIA = os.path.join(OUT, "media")
DECK = os.path.expanduser("~/.deckwerk/mirrors/srg-lab-server.taile747b8.ts.net-9443/"
                          "grant_servicing-2610_TRI_Mirror_section/assets/web/")
SOURCES = {
    # the deck's slide 2 is six mp4s rendered from index_envx_dissolve.html (mirror_intro_steps.7d9ffdde + the envx
    # dissolve); the website's copy also has the exploration-noise beats of the older index.html, re-added by
    # ~/mirror_talk/intro_anim/tools/make_noise_variant.py
    "intro": os.path.expanduser("~/mirror_talk/intro_anim/deck/index_envx_dissolve_noise.html"),
    "exploration": DECK + "exploration_steps.e508dcd0.html",
    "dreamer": DECK + "dreamer_steps.2f958b3d.html",
    "basalt": DECK + "basalt_steps.3702dc24.html",
    "textcond": DECK + "text_cond_anim.2eb5c0ae.html",
    "suites": DECK + "dmc_ogbench_atari_anim.4436ca39.html",
}
FFMPEG = os.environ.get("FFMPEG") or next((p for p in ["/tmp/cheetah_video_deps/imageio_ffmpeg/binaries/"
                                                         "ffmpeg-linux-x86_64-v7.0.2", "/usr/bin/ffmpeg"]
                                           if os.path.exists(p)), "ffmpeg")
# per-clip encodes. The chapters play their clips rather than scrub them, so a keyframe a second is enough (stepping
# back and forward still seeks; a 432 px frame decodes a second of frames in a few ms). `tag` goes into the file name, so
# a new encode never overwrites a file a reader may be streaming. `phone`: a second, smaller set, which
# scene-adapter.js picks on phones held upright (window.CLIP_PHONE), sized to the clips' boxes there (intro: 130-145
# CSS px at 3x on an iPhone Pro / Pro Max; desktop: 272 CSS px, 544 at 2x).
ENCODE = {
    "intro": dict(scale=544, crf=19, gop=30, tag="_d", phone=dict(scale=432, crf=18, gop=30, tag="_m")),
    "basalt": dict(copy=True, tag="_g"),   # the deck's own encodes: a keyframe about every second already, and smaller
    "suites": dict(scale=None, crf=23, gop=30),
}

# Website-only timing edits to a scene's source (exact text, each must occur once); the deck sources stay as they are.
PATCHES = {
    "basalt": [
        # loop -> gallery: the first two waterfalls fade in while the diagram fades out (deck: at .6 and .75 beat), so the
        # stage never sits nearly empty around the moving episode tile
        ('fade("g_wf0", 1, .6, .5), move("g_wf0", "pul", .94, .59, .01, "lin"), move("g_wf0", "pul", 1, .6, .6, "out")',
         'fade("g_wf0", 1, .15, .5), move("g_wf0", "pul", .94, .14, .01, "lin"), move("g_wf0", "pul", 1, .15, .6, "out")'),
        ('fade("g_wf1", 1, .75, .5), move("g_wf1", "pul", .94, .74, .01, "lin"), move("g_wf1", "pul", 1, .75, .6, "out")',
         'fade("g_wf1", 1, .28, .5), move("g_wf1", "pul", .94, .27, .01, "lin"), move("g_wf1", "pul", 1, .28, .6, "out")'),
        ('fade("lab_wf", 1, 1.15, .4)', 'fade("lab_wf", 1, .85, .4)'),
    ],
    # callouts, as in the Dreamer chart: each result gets a line saying what it shows, in the colour of its bar, right
    # above the chart (the random-walk line in a lighter blue, as its bar). They cross-fade from click to click; scene-adapter.js's caption() picks them up as the note under the
    # title on narrow screens and in portrait, so they are hidden in the stage there.
    "textcond": [
        ('#lab_spawn { display: none !important; }   /* "spawn point / unseen world" label removed */',
         '#lab_spawn { display: none !important; }   /* "spawn point / unseen world" label removed */\n'
         "/* website: a line above the chart saying what each result shows, as the Dreamer chart's callouts */\n"
         "/* one line each, starting at the chart's left edge (as its note below), just above the group headers */\n"
         ".callout { position: absolute; left: 992px; top: 54px; white-space: nowrap; font-size: 30px; font-weight: 600;\n"
         "           line-height: 1.3; letter-spacing: .015em; visibility: hidden; }\n"
         "html.scene-scroll.narrow .callout { visibility: hidden !important; }\n"
         "/* the tall layout (phones, iPads held upright, narrow desktop windows): the line stays in the stage, between the\n"
         "   shrunken figure and the group headers, as large as the longest still fits on one line (the size of the group\n"
         "   headers); --in-stage keeps it out of the page's caption (scene-adapter.js) */\n"
         "html.portrait #stage .callout { display: block !important; left: 84px; top: 589px; font-size: 36px; --in-stage: 1; }\n"
         "html.scene-scroll.narrow.portrait #stage .callout { visibility: inherit !important; }"),
        ('    <div class="label" id="note" style="font-size:24px">Average success across 10 tasks in two unseen worlds</div>\n'
         '  </div>',
         '    <div class="label" id="note" style="font-size:24px">Average success across 10 tasks in two unseen worlds</div>\n'
         '  </div>\n'
         '  <div class="callout" id="c0" style="color:#6b6862"><div>Baselines struggle to complete the task</div></div>\n'
         '  <div class="callout" id="c1" style="color:rgb(98, 134, 212)"><div>With random exploration, Mirror already reaches 42%</div></div>\n'
         '  <div class="callout" id="c2" style="color:#7a3fe0"><div>Self-improvement beats random exploration by over 50%</div></div>\n'
         '  <div class="callout" id="c3" style="color:#0e8a7a"><div>Expert actions only increase success by 7%</div></div>'),
        ('set("bar_bc", "o", 1, 1.4), move("bar_bc", "v", 3, 1.4, .8, "out")',
         'set("bar_bc", "o", 1, 1.4), move("bar_bc", "v", 3, 1.4, .8, "out"), fade("c0", 1, 1.2, .5)'),
        ('fade("lab_rand", 1, 0, .4), set("bar_rand", "o", 1, .1),',
         'fade("c0", 0, 0, .3), fade("c1", 1, .25, .5), fade("lab_rand", 1, 0, .4), set("bar_rand", "o", 1, .1),'),
        ('fade("gain", 1, 1.7, .4)', 'fade("gain", 1, 1.7, .4), fade("c1", 0, .7, .3), fade("c2", 1, .95, .5)'),
        ('fade("lab_sup", 1, 0, .4), set("bar_sup", "o", 1, .1),',
         'fade("c2", 0, 0, .3), fade("c3", 1, .25, .5), fade("lab_sup", 1, 0, .4), set("bar_sup", "o", 1, .1),'),
        ('for (const id of ["axis", "divider", "grp_a", "grp_b", "note"]) vis($(id), st[id].o);',
         'for (const id of ["axis", "divider", "grp_a", "grp_b", "note", "c0", "c1", "c2", "c3"]) vis($(id), st[id].o);'),
    ],
}

# Where a scene's own script reads its portrait layout (scenes/portrait/<name>.js, PORTRAIT_HEAD above): exact text,
# each must occur once. Outside portrait mode window.PORTRAIT is null and every hook keeps the deck's value.
PORTRAIT_HOOKS = {
    "intro": [
        ("const FPS = 30, W = 1920, H = 1080;",
         "const FPS = 30, W = PORTRAIT ? PORTRAIT.W : 1920, H = PORTRAIT ? PORTRAIT.H : 1080;"),
        # portrait: context and text feed the Video Model from above, and it feeds the plan below it; the plan's arrow
        # to the "?" stays a row, and the "?" points up to the environment
        ("const h2 = (A, B) => [[A.r + GAP, A.cy], [B.l - GAP, B.cy]];",
         "const h2 = (A, B) => [[A.r + GAP, A.cy], [B.l - GAP, B.cy]];\n"
         "const v2 = (y, B) => [[B.cx, y], [B.cx, B.t - GAP]];\n"
         "const underLabel = A => A.b + 66 * A.s;   // just under the label that hangs below a video\n"
         "const v2up = (A, B) => [[B.cx, A.t - GAP], [B.cx, underLabel(B)]];"),
        ('arrow("a_q_env", st => h2(geom(st, "q"), geom(st, "env")),',
         'arrow("a_q_env", st => PORTRAIT ? v2up(geom(st, "q"), geom(st, "env")) : h2(geom(st, "q"), geom(st, "env")),'),
        ('arrow("a_txt_vm", st => h2(geom(st, "txt"), geom(st, "vm")));',
         'arrow("a_txt_vm", st => PORTRAIT ? v2(Math.max(geom(st, "ctx").b, geom(st, "txt").b) + GAP, geom(st, "vm"))\n'
         '  : h2(geom(st, "txt"), geom(st, "vm")));'),
        ('arrow("a_vm_plan", st => h2(geom(st, "vm"), geom(st, "plan")));',
         'arrow("a_vm_plan", st => PORTRAIT ? v2(geom(st, "vm").b + GAP, geom(st, "plan")) : h2(geom(st, "vm"), geom(st, "plan")));'),
        # portrait: down from the plan into the model's left side, and from its right side up to the environment
        ('arrow("a_plan_v2a", st => h2(geom(st, "plan"), geom(st, "v2a")));',
         'arrow("a_plan_v2a", st => { const P = geom(st, "plan"), V = geom(st, "v2a");\n'
         '  return PORTRAIT ? rounded([[P.cx, underLabel(P)], [P.cx, V.cy], [V.l - GAP, V.cy]]) : h2(P, V); });'),
        # (with the noise beat's sum in, u = 1, it ends under the sum on that vertical run; the sum's own arrow runs
        # on up to the environment, and the noise feeds the sum from its right)
        ("  return [[V.r + GAP, V.cy], [(1 - u) * (Ev.l - GAP) + u * (O.l - GAP), V.cy]]; });",
         "  if (PORTRAIT) return rounded([[V.r + GAP, V.cy], [Ev.cx, V.cy], [Ev.cx, (1 - u) * underLabel(Ev) + u * (O.b + GAP)]]);\n"
         "  return [[V.r + GAP, V.cy], [(1 - u) * (Ev.l - GAP) + u * (O.l - GAP), V.cy]]; });"),
        ("  return [[(1 - u) * O.cx + u * (O.r + GAP), y], [Ev.l - GAP, y]]; });",
         "  if (PORTRAIT) return [[Ev.cx, (1 - u) * O.cy + u * (O.t - GAP)], [Ev.cx, underLabel(Ev)]];\n"
         "  return [[(1 - u) * O.cx + u * (O.r + GAP), y], [Ev.l - GAP, y]]; });"),
        ("  return [[O.cx, Nn.t - GAP], [O.cx, O.b + GAP]]; }, { color: \"#8a8a8a\" });",
         "  if (PORTRAIT) return [[Nn.l - GAP, O.cy], [O.r + GAP, O.cy]];\n"
         "  return [[O.cx, Nn.t - GAP], [O.cx, O.b + GAP]]; }, { color: \"#8a8a8a\" });"),
        # portrait: the loop (and the card on it) leaves the environment's right side, runs down a rail LOOP_DX right
        # of it and LOOP_DY under the model, and comes up into the model as in the deck; it moves with the camera
        ("const LOOP_Y = 985;",
         "const LOOP_Y = 985, LOOP_DX = PORTRAIT ? PORTRAIT.LOOP_DX : null, LOOP_DY = PORTRAIT ? PORTRAIT.LOOP_DY : null;"),
        ("return rounded([[E.cx, E.b + 58], [E.cx, LOOP_Y], [V.cx, LOOP_Y], [V.cx, V.b + GAP]]);",
         "const X = E.r + LOOP_DX, Y = V.b + LOOP_DY;\n"
         "  return rounded(PORTRAIT ? [[E.r + GAP, E.cy], [X, E.cy], [X, Y], [V.cx, Y], [V.cx, V.b + GAP]]\n"
         "    : [[E.cx, E.b + 58], [E.cx, LOOP_Y], [V.cx, LOOP_Y], [V.cx, V.b + GAP]]);"),
        ("const P = rounded([[E.cx, E.cy], [E.cx, LOOP_Y], [V.cx, LOOP_Y], [V.cx, V.b + 40]], 110, 24);",
         "const X = E.r + LOOP_DX, Y = V.b + LOOP_DY;\n"
         "  const P = rounded(PORTRAIT ? [[E.cx, E.cy], [X, E.cy], [X, Y], [V.cx, Y], [V.cx, V.b + 40]]\n"
         "    : [[E.cx, E.cy], [E.cx, LOOP_Y], [V.cx, LOOP_Y], [V.cx, V.b + 40]], 110, 24);"),
        # portrait: camera moves inside existing beats (scenes/portrait/intro.js), timed with their own tweens
        ("const CHAIN = new Set(", "if (PORTRAIT) PORTRAIT.moves(STEPS, layout);\nconst CHAIN = new Set("),
        ("const LAYOUT = {", "const LAYOUT = PORTRAIT ? PORTRAIT.LAYOUT : {"),
        ("const DEFAULT = {", "const DEFAULT = PORTRAIT ? PORTRAIT.DEFAULT : {"),
        ("const CARD_FULL = 400 * .95 / (190 * .72);", "const CARD_FULL = PORTRAIT ? PORTRAIT.CARD_FULL : 400 * .95 / (190 * .72);"),
    ],
    "basalt": [
        ("const FPS = 20, W = 1920, H = 1080;",
         "const FPS = 20, W = PORTRAIT ? PORTRAIT.W : 1920, H = PORTRAIT ? PORTRAIT.H : 1080;"),
        # portrait: the task card, the timeline and the (transposed) table change shape
        ("tbl: [1680, 410] };", "tbl: [1680, 410] };\nif (PORTRAIT) Object.assign(NODE, PORTRAIT.NODE);"),
        # portrait: the demonstrations stand in a column under the video model; their branches join a trunk on the
        # right, which runs up into the model's side
        ('const D = geom(st, id), V = geom(st, "vm"), ym = (D.t + V.b) / 2 + 8;',
         'const D = geom(st, id), V = geom(st, "vm"), ym = (D.t + V.b) / 2 + 8;\n'
         '  if (PORTRAIT) return rounded([[D.r + GAP, D.cy], [PORTRAIT.FAN, D.cy], [PORTRAIT.FAN, V.cy], [V.r + GAP, V.cy]], 34);'),
        # portrait: the loop runs down the frame (plan -> V2A -> environment) and returns up a rail on the right
        ("const h2 = (A, B) => [[A.r + GAP, A.cy], [B.l - GAP, B.cy]];",
         "const h2 = (A, B) => PORTRAIT ? [[A.cx, A.b + GAP], [B.cx, B.t - GAP]] : [[A.r + GAP, A.cy], [B.l - GAP, B.cy]];"),
        ("return rounded([[E.cx, E.t - GAP], [E.cx, V.cy], [V.r + GAP, V.cy]], 60); };",
         "if (PORTRAIT) return rounded([[E.r + GAP, E.cy], [PORTRAIT.RAIL, E.cy], [PORTRAIT.RAIL, V.cy], [V.r + GAP, V.cy]], 60);\n"
         "  return rounded([[E.cx, E.t - GAP], [E.cx, V.cy], [V.r + GAP, V.cy]], 60); };"),
        ("const fx = f => 1680 * f / (EP_FRAMES - 1);",
         "const fx = f => (PORTRAIT ? PORTRAIT.NODE.tl[0] : 1680) * f / (EP_FRAMES - 1);"),
        # portrait: the table is transposed, the methods running down the side (scenes/portrait/basalt.js)
        ('{\n  const tb = $("tbl"), add = (html) => tb.insertAdjacentHTML("beforeend", html);',
         'if (PORTRAIT) PORTRAIT.table($("tbl"), { TASKS, COLS, GROUPS, MIRROR });\n'
         'else {\n  const tb = $("tbl"), add = (html) => tb.insertAdjacentHTML("beforeend", html);'),
        ("const LAYOUT = {", "const LAYOUT = PORTRAIT ? PORTRAIT.LAYOUT : {"),
        ("  env_lab: { o: 1 },\n};",
         "  env_lab: { o: 1 },\n};\nif (PORTRAIT) for (const id in PORTRAIT.INIT) Object.assign(INIT[id], PORTRAIT.INIT[id]);"),
        ('move("plan", "cy", 652, 1.0, .85), move("plan", "sc", 1, 1.0, .85)',
         'move("plan", "cy", PORTRAIT ? PORTRAIT.PLAN[0] : 652, 1.0, .85), '
         'move("plan", "sc", PORTRAIT ? PORTRAIT.PLAN[1] : 1, 1.0, .85)'),
        # portrait: "fine-tune" and "new plan every 0.8 s" sit centred over the top runs of their arrows
        ("translate(${V.cx + 18}px,${V.b + 24}px)",
         "translate(${PORTRAIT ? (V.r + GAP + PORTRAIT.FAN) / 2 : V.cx + 18}px,${PORTRAIT ? V.cy - 52 : V.b + 24}px)"),
        ("translate(${(V.r + Ev.cx) / 2 - 140}px,${V.cy - 52}px)",
         "translate(${PORTRAIT ? (V.r + GAP + PORTRAIT.RAIL) / 2 : (V.r + Ev.cx) / 2 - 140}px,${V.cy - 52}px)"),
        # portrait: no strips above the table, which gets the frame. A push: the table fades in below the gallery's last
        # row, PORTRAIT.PUSH lower than its place, and the two move up together until the gallery has left the frame,
        # the table settling when the deck's does
        ('...layout("strip_wf", .1, .9), ...layout("strip_cave", .3, 1.1, "io", "late", "early"),\n'
         '      fade("tbl", 1, .95, .5), move("tbl", "dy", 0, .95, .7, "out")]',
         '...(PORTRAIT\n'
         '      ? [...["g_wf0", "g_wf1", "g_wf2", "g_cave0", "g_cave1", "g_cave2", "lab_wf", "lab_cave"]\n'
         '           .map(id => move(id, "dy", -PORTRAIT.PUSH, .35, 1.3)),\n'
         '         fade("tbl", 1, .35, .25), move("tbl", "dy", 0, .35, 1.3)]\n'
         '      : [...layout("strip_wf", .1, .9), ...layout("strip_cave", .3, 1.1, "io", "late", "early"),\n'
         '         fade("tbl", 1, .95, .5), move("tbl", "dy", 0, .95, .7, "out")])]'),
    ],
    "exploration": [
        ("const W = 1920, H = 1080;", "const W = PORTRAIT ? PORTRAIT.W : 1920, H = PORTRAIT ? PORTRAIT.H : 1080;"),
        ("const LAYOUT = {", "const LAYOUT = PORTRAIT ? PORTRAIT.LAYOUT : {"),
    ],
    "suites": [
        ("const W = 1920, H = 1080;", "const W = PORTRAIT ? PORTRAIT.W : 1920, H = PORTRAIT ? PORTRAIT.H : 1080;"),
        ("const PW = 380, PH = 440, PT = 424;            // plot width, height, top",
         "const PW = PORTRAIT ? PORTRAIT.PW : 380, PH = PORTRAIT ? PORTRAIT.PH : 440, PT = 424;   // plot width, height, top\n"
         "const PTS = PORTRAIT ? PORTRAIT.PT : [PT, PT, PT];   // each plot's top (portrait: stacked)\n"
         "let PS = PORTRAIT ? PORTRAIT.TEXT : 1;                // type scale (portrait: the table sets its own)"),
        ("const PX = [190, 730, 1270];", "const PX = PORTRAIT ? PORTRAIT.PX : [190, 730, 1270];"),
        ("const TILE_HEAD = i => [PX[i] - 64, 236, .25];",
         "const TILE_HEAD = i => PORTRAIT ? PORTRAIT.TILE_HEAD(i) : [PX[i] - 64, 236, .25];"),
        ("const CAM_SUMMARY = { s: .6, tx: 40, ty: 250 };",
         "const CAM_SUMMARY = PORTRAIT ? PORTRAIT.CAM_SUMMARY : { s: .6, tx: 40, ty: 250 };"),
        ('const t = el("text", { x, y, "font-size": size,', 'const t = el("text", { x, y, "font-size": size * PS,'),
        ("{ transform: `translate(${PX[i]},${PT})` }, cam);",
         "{ transform: `translate(${PX[i]},${PTS[i]})` },\n"
         "                 PORTRAIT ? (NODES[\"pan_\" + s.key] = el(\"g\", {}, cam)) : cam);   // portrait: moves into the summary row"),
        ('NODES.xlabel = text(cam, "Environment steps", PX[1] + PW / 2, PT + PH + 92,',
         'NODES.xlabel = text(PORTRAIT ? (NODES.pan_xlabel = el("g", {}, cam)) : cam, "Environment steps",\n'
         '                     ...(PORTRAIT ? PORTRAIT.XLABEL : [PX[1] + PW / 2, PT + PH + 92]),'),
        ("const gap = 29;", "const gap = 29 * PS;"),
        ("const TL = 1110, TR = 1822, TCOL = { method: 1268, dmc: 1515, ogbench: 1655, atari: 1776 };",
         "if (PORTRAIT) PS = PORTRAIT.TABLE.TEXT;\n"
         "const SUBHEAD = PORTRAIT ? PORTRAIT.TABLE.SUBHEAD * PS : 0;   // portrait: each group's name heads its rows\n"
         "const { TL, TR, TCOL } = PORTRAIT ? PORTRAIT.TABLE\n"
         "  : { TL: 1110, TR: 1822, TCOL: { method: 1268, dmc: 1515, ogbench: 1655, atari: 1776 } };"),
        ("const TY = { top: 352, headRule: 440 };", "const TY = { top: PORTRAIT ? PORTRAIT.TABLE.top : 352 };\nTY.headRule = TY.top + 88 * PS;"),
        ("const ROW_H = 40, GROUP_GAP = 14;", "const ROW_H = 40 * PS, GROUP_GAP = 14 * PS;"),
        ("text(head, name, TCOL[k], TY.top + 42,", "text(head, name, TCOL[k], TY.top + 42 * PS,"),
        ("text(head, unit, TCOL[k], TY.top + 72,", "text(head, unit, TCOL[k], TY.top + 72 * PS,"),
        ('LAYOUT.intro["sub_" + s.key] = [CX[i] - wid("sub_" + s.key) / 2, 828, 1];',
         'LAYOUT.intro["sub_" + s.key] = [CX[i] - wid("sub_" + s.key) / 2, 828, 1];\n'
         '    if (PORTRAIT) Object.assign(LAYOUT.intro, PORTRAIT.intro(i, s.key));'),
        ('LAYOUT.head["sub_" + s.key] = [tx + 122, ty + 82, 24 / SUB_SIZE];',
         'LAYOUT.head["sub_" + s.key] = [tx + 122, ty + 82, 24 / SUB_SIZE];\n'
         '    if (PORTRAIT) Object.assign(LAYOUT.head, PORTRAIT.head(i, s.key, NAME_SIZE, SUB_SIZE));'),
        ("const ax = PX[2] + PW + 16 + p.dx, ay = PT + LAB_Y[m];", "const ax = PX[2] + PW + 16 + p.dx, ay = PTS[2] + LAB_Y[m];"),
        ("if (last !== null && group !== last) y += GROUP_GAP;",
         "if (last !== null && group !== last) y += GROUP_GAP;\n    if (group !== last) y += SUBHEAD;"),
        ("rule(TAB[key] - ROW_H / 2 - GROUP_GAP / 2, 1.2)", "rule(TAB[key] - ROW_H / 2 - SUBHEAD - GROUP_GAP / 2, 1.2)"),
        ("text(table, group, TL, TAB[key], {", "text(table, group, TL, TAB[key] - (SUBHEAD ? ROW_H / 2 + SUBHEAD / 2 : 0), {"),
        # portrait: each plot's metric reads up its left side, as an axis label, rather than above the plot
        ('NODES["metric_" + s.key] = text(g, s.metric, -64, -30, { size: 22, fill: MUTED });',
         'NODES["metric_" + s.key] = text(g, s.metric, ...(PORTRAIT ? [PORTRAIT.YLABEL, PH / 2] : [-64, -30]),\n'
         '                                { size: 22, fill: MUTED, ...(PORTRAIT ? { anchor: "middle" } : {}) });\n'
         '  if (PORTRAIT) NODES["metric_" + s.key].setAttribute("transform", `rotate(-90 ${PORTRAIT.YLABEL} ${PH / 2})`);'),
        # portrait summary: the table rises in from below the plots (pan_table) as they leave the frame
        ('const rules = el("g", {',
         'if (PORTRAIT) NODES.pan_table = table;\n  const rules = el("g", {'),
        ("INIT.trow_expert = { dy: 10 };",
         "INIT.trow_expert = { dy: 10 };\n  if (PORTRAIT) Object.assign(INIT, PORTRAIT.INIT);"),
        ('if (!n || id === "cam") continue;',
         'if (!n || id === "cam") continue;\n'
         '    if (id.startsWith("pan_")) { putA(n, "transform", `translate(${f2(p.x)},${f2(p.y)})`); continue; }'),
        # portrait summary: the table pushes the plots out of the frame (PORTRAIT.SUMMARY), and the labels grow to its type
        ('move("cam", "ty", CAM_SUMMARY.ty, .1, 1.3),',
         'move("cam", "ty", CAM_SUMMARY.ty, .1, 1.3),\n'
         '      ...(PORTRAIT ? PORTRAIT.SUMMARY(LAYOUT).map(([id, prop, to]) => move(id, prop, to, .1, 1.3)) : []),\n'
         '      ...(PORTRAIT ? Object.entries(FLY).map(([m, at]) => move("lab_" + m, "s", PORTRAIT.TABLE.TEXT / PORTRAIT.TEXT, at, FLY_DUR)) : []),'),
        # portrait: the stacked DMC and OGBench plots name their curves too (static labels at the curve ends, in each
        # plot's band); they arrive as their own curve lands, dim with the baselines, and leave for the summary
        ('  NODES["lab_" + m] = t;\n}',
         '  NODES["lab_" + m] = t;\n}\n'
         'const SLAB = [];\n'
         'if (PORTRAIT) SUITES.slice(0, 2).forEach((s, i) => {\n'
         '  const g = el("g", { transform: `translate(${PX[i] + PW + 16},${PTS[i]})` }, NODES["pan_" + s.key]);\n'
         '  const ys = LAB.filter(m => DATA.curves[`${s.key}/${m}`])\n'
         '    .map(m => { const c = DATA.curves[`${s.key}/${m}`]; return [m, sy(s, c.y[c.y.length - 1])]; });\n'
         '  ys.sort((a, b) => a[1] - b[1]);\n'
         '  for (let it = 0; it < 50; it++) for (let j = 1; j < ys.length; j++) {\n'
         '    const d = ys[j][1] - ys[j - 1][1];\n'
         '    if (d < 29 * PS) { ys[j - 1][1] -= (29 * PS - d) / 2; ys[j][1] += (29 * PS - d) / 2; }\n'
         '  }\n'
         '  for (const [m, y] of ys) {\n'
         '    const t = text(g, M[m].name, 0, y, { size: 24, fill: M[m].color, weight: m.startsWith("mirror") ? 600 : 500,\n'
         '                                         base: "central" });\n'
         '    if (M[m].suffix) el("tspan", { "font-weight": 500 }, t).textContent = M[m].suffix;\n'
         '    const id = `slab_${s.key}_${m}`;\n'
         '    NODES[id] = t;\n'
         '    SLAB.push(id);\n'
         '  }\n'
         '});'),
        ('for (const m of LAB) INIT["lab_" + m] = { dx: -16 };',
         'for (const m of LAB) INIT["lab_" + m] = { dx: -16 };\n  for (const id of SLAB) INIT[id] = { dx: -16 };'),
        ('    if (pulse) for (const m of ms)',
         '    SUITES.slice(0, 2).forEach((s, i) => ms.forEach((m, j) => {\n'
         '      const id = `slab_${s.key}_${m}`, t = at + .14 * i + dur - .3 + .07 * j;\n'
         '      if (NODES[id]) tw.push(fade(id, 1, t, .45), move(id, "dx", 0, t, .6, "out"));\n'
         '    }));\n'
         '    if (pulse) for (const m of ms)'),
        ('...BASELINES.map(m => fade("lab_" + m, LAB_DIM, .1, .7)),',
         '...BASELINES.map(m => fade("lab_" + m, LAB_DIM, .1, .7)),\n'
         '      ...SLAB.filter(id => BASELINES.some(m => id.endsWith("_" + m))).map(id => fade(id, LAB_DIM, .1, .7)),'),
        ('fade("lab_viper", 0, .05, .35),', 'fade("lab_viper", 0, .05, .35), ...SLAB.map(id => fade(id, 0, .05, .35)),'),
        ('    if (id.startsWith("lab_")) {',
         '    if (id.startsWith("slab_")) { putA(n, "transform", `translate(${f2(p.dx)},0)`); vis(n, p.o); continue; }\n'
         '    if (id.startsWith("lab_")) {'),
    ],
    "textcond": [
        ("const W = 1920, H = 880;", "const W = PORTRAIT ? PORTRAIT.W : 1920, H = PORTRAIT ? PORTRAIT.H : 880;"),
        ("const SPAWN_OPEN = { cx: 960, cy: 420, w: 820 }, SPAWN = { cx: 960, cy: 250, w: 600 };",
         "const SPAWN_OPEN = PORTRAIT ? PORTRAIT.SPAWN_OPEN : { cx: 960, cy: 420, w: 820 },\n"
         "      SPAWN = PORTRAIT ? PORTRAIT.SPAWN : { cx: 960, cy: 250, w: 600 };"),
        ("const TILE_W = 390, TILE_H", "const TILE_W = PORTRAIT ? PORTRAIT.TILE_W : 390, TILE_H"),
        # portrait: each task also gives its tile's top and pill's y, and whether its route runs up from the ring
        ("const TASKS = [", "const TASKS = PORTRAIT ? PORTRAIT.TASKS : ["),
        ('place($("tile_" + T.id), T.x - TILE_W / 2, TILE_T, TILE_W, TILE_H);',
         'const dir = T.up ? -1 : 1, tileT = T.tileT ?? TILE_T;\n'
         '  place($("tile_" + T.id), T.x - TILE_W / 2, tileT, TILE_W, TILE_H);'),
        ("sy = SPAWN.t + (fy + fry) * K + 3, ex = T.x, ey = TILE_T - GAP, dy = ey - sy;",
         "sy = SPAWN.t + (fy + dir * fry) * K + 3 * dir, ex = T.x,\n"
         "        ey = T.up ? tileT + TILE_H + GAP : tileT - GAP, dy = ey - sy;"),
        ("${ex},${ey - dy * .55} ${ex},${ey - HEAD * .8}`;", "${ex},${ey - dy * .55} ${ex},${ey - dir * HEAD * .8}`;"),
        ("d: `M${ex},${ey + 3} L${ex - hw - 3},${ey - HEAD - 2} L${ex + hw + 3},${ey - HEAD - 2} Z`,",
         "d: `M${ex},${ey + 3 * dir} L${ex - hw - 3},${ey - dir * (HEAD + 2)} L${ex + hw + 3},${ey - dir * (HEAD + 2)} Z`,"),
        ("d: `M${ex},${ey} L${ex - hw},${ey - HEAD} L${ex + hw},${ey - HEAD} Z`, fill: T.color",
         "d: `M${ex},${ey} L${ex - hw},${ey - dir * HEAD} L${ex + hw},${ey - dir * HEAD} Z`, fill: T.color"),
        ("const BASE_Y = 650, PCT = 5.2, BAR_W = 96;",
         "const BASE_Y = PORTRAIT ? PORTRAIT.BASE_Y : 650, PCT = PORTRAIT ? PORTRAIT.PCT : 5.2, BAR_W = PORTRAIT ? PORTRAIT.BAR_W : 96;"),
        ("const BARS = {", "const BARS = PORTRAIT ? PORTRAIT.BARS : {"),
        ('place($("axis"), 975, BASE_Y, 815, 2);', 'place($("axis"), ...(PORTRAIT ? PORTRAIT.AXIS : [975, BASE_Y, 815, 2]));'),
        ("const GROUP_Y = 110;", "const GROUP_Y = PORTRAIT ? PORTRAIT.GROUP_Y : 110;"),
        ("const FIG_SIDE = { gs: .46, cx: 500, cy: 430 };",
         "const FIG_SIDE = PORTRAIT ? PORTRAIT.FIG_SIDE : { gs: .46, cx: 500, cy: 430, ox: 960, oy: 433 };"),
        ("FIG_SIDE.cx - 960 * FIG_SIDE.gs", "FIG_SIDE.cx - FIG_SIDE.ox * FIG_SIDE.gs"),
        ("FIG_SIDE.cy - 433 * FIG_SIDE.gs", "FIG_SIDE.cy - FIG_SIDE.oy * FIG_SIDE.gs"),
        ("translate(${T.x}px,${PILL_Y + ps.dy}px)", "translate(${T.x}px,${(T.pillY ?? PILL_Y) + ps.dy}px)"),
    ],
}

BRIDGE = re.compile(r'<script data-deckwerk-bridge>.*?</script>\s*', re.S)
DATA_URI = re.compile(r'data:(video/mp4|image/jpeg|image/png);base64,([A-Za-z0-9+/=]+)')

HEAD = """<link rel="stylesheet" href="scene-fonts.css">
<script>
// mirror: with ?scroll the parent page renders every frame (scene-adapter.js), so the page's own
// presentation loop is never scheduled; without it the page works as in the deck (click or arrow keys to step).
window.SCENE_SCROLL = /[?&]scroll\\b/.test(location.search);
if (window.SCENE_SCROLL) {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (cb && cb.name === "loop" ? 0 : raf(cb));
  document.documentElement.classList.add("scene-scroll");
}
// start loading the website's face (scene-fonts.css) before the page measures any text (its document.fonts.ready
// then waits for it)
['400 20px "Source Sans 3"', '500 20px "Source Sans 3"', '600 20px "Source Sans 3"', '700 20px "Source Sans 3"',
 'italic 400 20px "Source Sans 3"'].forEach(f => document.fonts.load(f).catch(() => {}));
</script>
"""
# Phones held upright load the scene with ?portrait: scenes/portrait/<name>.js then sets window.PORTRAIT (a tall stage
# and the layouts that fill it), which the scene's own script reads at the PORTRAIT_HOOKS below. Its titles are
# hidden, since the page shows them above the frame.
PORTRAIT_HEAD = """<script>
window.SCENE_PORTRAIT = /[?&]portrait\\b/.test(location.search);
window.PORTRAIT = null;
if (window.SCENE_PORTRAIT) document.documentElement.classList.add("portrait");
</script>
<script src="portrait/{name}.js"></script>
<script>
if (window.PORTRAIT) document.head.insertAdjacentHTML("beforeend", "<style>#stage{width:" + PORTRAIT.W + "px!important;" +
  "height:" + PORTRAIT.H + "px!important}html.portrait .title,html.portrait #ptitle,html.portrait .callout" +
  "{display:none!important}</style>");
</script>
"""
TAIL = '<script src="scene-adapter.js"></script>\n<script>SceneAdapter.init("{name}");</script>\n'
# In scroll mode a scene fetches only what its opening shows (scenes/scene-adapter.js): its images go in data-src, which
# the adapter fills as a frame shows each (and, opened on its own, at once), and its clips start with preload none, so
# the browser asks for none of them before the adapter has taken their sources. lazy_media() is idempotent:
#   python3 -c "import sys; sys.path.insert(0, 'mirror/tools'); import build_scenes as b; b.relazy()"
# applies it to the built scenes in place (dreamer.html is edited by hand and never rebuilt).
LAZY_MEDIA = [
    (re.compile(r'(<img\b[^>]*?)(?<![-\w])src="(media/[^"]+)"'), r'\1data-src="\2"'),
    ("im => im.src = STILLS[im.dataset.still]",
     "im => { if (window.SCENE_SCROLL) im.dataset.src = STILLS[im.dataset.still]; else im.src = STILLS[im.dataset.still]; }"),
    ('v.preload = "auto"; v.src = CLIPS[clip].src;', 'v.preload = window.SCENE_SCROLL ? "none" : "auto"; v.src = CLIPS[clip].src;'),
]


def lazy_media(html):
    for a, b in LAZY_MEDIA:
        html = a.sub(b, html) if isinstance(a, re.Pattern) else html.replace(a, b)
    return html


def relazy():
    for name in SOURCES:
        path = os.path.join(OUT, name + ".html")
        html = open(path, encoding="utf-8").read()
        new = lazy_media(html)
        if new != html:
            open(path, "w", encoding="utf-8").write(new)
            print(name, "made lazy")


def encode_video(raw, name, key, opts):
    """Re-encode one clip; returns its file name in scenes/media/."""
    fn = f"{name}_{key}{opts.get('tag', '')}.mp4"
    dst = os.path.join(MEDIA, fn)
    with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
        tmp.write(raw)
        tmp.flush()
        if opts.get("copy"):
            subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", tmp.name, "-an", "-c:v", "copy",
                            "-movflags", "+faststart", dst], check=True)
            return fn
        vf = []
        if opts.get("scale"):   # (never up: the data clips are 480 px)
            vf.append(f"scale='min({opts['scale']},iw)':-2:flags=lanczos")
        cmd = [FFMPEG, "-y", "-loglevel", "error", "-i", tmp.name, "-an", "-c:v", "libx264", "-preset", "slow",
               "-crf", str(opts["crf"]), "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", str(opts["gop"]),
               "-keyint_min", str(opts["gop"]), "-sc_threshold", "0", "-movflags", "+faststart"]
        if vf:
            cmd += ["-vf", ",".join(vf)]
        subprocess.run(cmd + [dst], check=True)
    return fn


def media_key(html, start, used):
    """A readable name for the data URI starting at `start`: its JSON key, or the alt text of its <img>."""
    before = html[max(0, start - 400):start]
    m = re.search(r'"(\w+)"\s*:\s*\{\s*"src"\s*:\s*"$', before)          # CLIPS = {"plan": {"src": "data:...
    if m:
        key = m.group(1)
    else:
        m = re.search(r'"(\w+)"\s*:\s*"$', before)                        # STILLS = {"wf0": "data:... / "poster":
        key = m.group(1) if m else None
        if key == "poster":                                               # suites: {"dmc": {"src": ..., "poster":
            m2 = re.findall(r'"(\w+)"\s*:\s*\{\s*"src"', html[max(0, start - 600000):start])
            key = (m2[-1] + "_poster") if m2 else "poster"
        if key is None:
            m = re.search(r'<img[^>]*\balt="([^"]+)"[^>]*\bsrc="$', before)
            key = re.sub(r"[^a-z0-9]+", "_", m.group(1).lower()).strip("_")[:28] if m else "media"
    k, i = key, 2
    while k in used:
        k, i = f"{key}{i}", i + 1
    used.add(k)
    return k


def build(name, keep_media=False):
    src = SOURCES[name]
    html = open(src, encoding="utf-8").read()
    html, n = BRIDGE.subn("", html)
    assert n == 1, f"{name}: expected one DeckWerk bridge, found {n}"
    for a, b in PATCHES.get(name, []) + PORTRAIT_HOOKS.get(name, []):
        assert html.count(a) == 1, f"{name}: patch target not found once: {a[:60]}"
        html = html.replace(a, b)
    # media
    used, out, last, manifest = set(), [], 0, []
    for m in DATA_URI.finditer(html):
        mime, raw = m.group(1), base64.b64decode(m.group(2))
        key = media_key(html, m.start(), used)
        if mime == "video/mp4":
            opts = ENCODE.get(name, dict(scale=None, crf=21, gop=10))
            for o in [opts.get("phone")] if opts.get("phone") else []:   # the phone set: same names, its own tag
                if not (keep_media and os.path.exists(os.path.join(MEDIA, f"{name}_{key}{o['tag']}.mp4"))):
                    encode_video(raw, name, key, o)
            fn = f"{name}_{key}{opts.get('tag', '')}.mp4"
            if not (keep_media and os.path.exists(os.path.join(MEDIA, fn))):
                fn = encode_video(raw, name, key, opts)
        else:
            fn = f"{name}_{key}.{'jpg' if mime == 'image/jpeg' else 'png'}"
            open(os.path.join(MEDIA, fn), "wb").write(raw)
        manifest.append([key, fn, len(raw), os.path.getsize(os.path.join(MEDIA, fn))])
        out.append(html[last:m.start()])
        out.append("media/" + fn)
        last = m.end()
    out.append(html[last:])
    html = "".join(out)
    # the website's theme: role colours, fonts and caption keywords (tools/theme.py, css/theme.css)
    html, themed = theme.apply(html, name)
    html = lazy_media(html)
    # head / tail
    assert html.count("<head>") == 1 and html.count("</body>") == 1
    phone = ENCODE.get(name, {}).get("phone")
    clip_phone = f'<script>window.CLIP_PHONE = {json.dumps(phone["tag"])};</script>\n' if phone else ""
    html = html.replace("<head>", "<head>\n" + HEAD + clip_phone + PORTRAIT_HEAD.replace("{name}", name), 1)
    html = html.replace("</body>", TAIL.format(name=name) + "</body>", 1)
    tmp = os.path.join(OUT, f".{name}.html.tmp")   # the page switches to the new media in one rename
    open(tmp, "w", encoding="utf-8").write(html)
    os.replace(tmp, os.path.join(OUT, name + ".html"))
    print(f"{name:12s} {len(html) / 1e3:7.1f} KB html, theme: {themed}, media:",
          ", ".join(f"{k} {a / 1e3:.0f}->{b / 1e3:.0f}KB" for k, f, a, b in manifest) or "none")
    return manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(SOURCES))
    ap.add_argument("--keep-media", action="store_true", help="reuse already encoded videos")
    a = ap.parse_args()
    os.makedirs(MEDIA, exist_ok=True)
    report = {}
    for name in a.only.split(","):
        report[name] = build(name, a.keep_media)
    path = os.path.join(HERE, "media_manifest.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    old.update(report)
    json.dump(old, open(path, "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
