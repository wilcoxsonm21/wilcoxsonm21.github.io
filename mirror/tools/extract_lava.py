#!/usr/bin/env python3
"""Pull the in-context-learning (lava escape) figure's data out of the paper figure, for the page's scroll animation.

There is no script for this figure in the paper sources, so this reads figures/lava_escape.pdf itself (the same file
as website_figures/lava_escape.pdf). Every line in that PDF was exported as a filled outline, not a stroke: each line
is a round start cap, its join wedges, a round end cap, then one 7-point piece per segment whose points 0 and 3 lie
on the line's centre. Chaining those pieces gives each line's exact centreline (checked: consecutive pieces meet
exactly and every join pivots on a chained vertex). Page coordinates become data coordinates through the axes' grid
lines.

Writes js/lava-data.js (window.LAVA_DATA) and media/lava_challenge.jpg (panel a's screenshot).

usage: uv run --no-project --with pypdf --with numpy --with pillow python mirror/tools/extract_lava.py
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from pdfpaths import interpret  # noqa: E402

PDF = os.path.join(SITE, "..", "website_figures", "lava_escape.pdf")
GRID_B = (0.8471, 0.8667, 0.8902)      # trajectory panels' grid colour (alpha .65)
GRID_C = (0.8275, 0.8275, 0.8275)      # escape-rate panels' grid colour (alpha .5)


def close(a, b, tol=2e-3):
    return all(abs(x - y) < tol for x, y in zip(a, b))


def pts(path):
    return np.array([p for sp in path["subpaths"] for p in sp])


def centreline(path):
    """The exact centreline of an outlined stroke: chained 7-point segment pieces (points 0 and 3)."""
    bodies = [np.array(s) for s in path["subpaths"] if len(s) == 7]
    caps = [np.array(s) for s in path["subpaths"] if len(s) == 15]
    if not bodies:                     # a zero-length line: only its two caps
        c = caps[0][13]
        return np.array([c, c]), (np.linalg.norm(caps[0][0] - caps[0][13]) * 2 if caps else 0)
    chain = [bodies[0][0]]
    for b in bodies:
        gap = float(np.hypot(*(chain[-1] - b[0])))
        # where the agent reverses exactly, the exporter splits the stroke and restarts a hair away (< 0.04 pt);
        # keep both points
        assert gap < .1, "pieces do not chain (%.3f pt)" % gap
        if gap > 1e-3:
            chain.append(b[0])
        chain.append(b[3])
    width = 2 * np.linalg.norm(bodies[0][1] - bodies[0][0])
    return np.array(chain), width


def body_segments(path):
    """Centreline segments of every 7-point piece (for dashed lines, whose dashes do not chain)."""
    return [(np.array(s[0]), np.array(s[3])) for s in path["subpaths"] if len(s) == 7]


def grid_lines(paths, colour, box):
    """x of the vertical and y of the horizontal grid lines inside box (x0, y0, x1, y1)."""
    xs, ys = set(), set()
    for p in paths:
        if not close(p["fill"], colour):
            continue
        a = pts(p)
        lo, hi = a.min(0), a.max(0)
        c = (lo + hi) / 2
        if not (box[0] - 3 < c[0] < box[2] + 3 and box[1] - 3 < c[1] < box[3] + 3):
            continue
        if hi[1] - lo[1] > hi[0] - lo[0]:
            xs.add(round(float(c[0]), 3))
        else:
            ys.add(round(float(c[1]), 3))
    return sorted(xs), sorted(ys)


def affine(page_vals, data_vals):
    """Least-squares page -> data map along one axis; returns (scale, offset) and the worst residual."""
    A = np.vstack([page_vals, np.ones(len(page_vals))]).T
    (s, o), *_ = np.linalg.lstsq(A, np.array(data_vals, float), rcond=None)
    res = np.abs(A @ [s, o] - data_vals).max()
    return float(s), float(o), float(res)


def main():
    reader, page, items = interpret(PDF)
    paths = [it for it in items if it["kind"] == "path"]
    out = {"source": "figures/lava_escape.pdf (paper), page units pt"}

    # ---------------------------------------------------------------- the trajectory panels
    panels = {}
    bgs = [p for p in paths if close(p["fill"], (0.98, 0.98, 0.98), 5e-3) and len(p["subpaths"]) == 1]
    for p in bgs:
        a = pts(p)
        lo, hi = a.min(0), a.max(0)
        name = "shared" if lo[0] < 905 else "independent"
        xs, ys = grid_lines(paths, GRID_B, (lo[0], lo[1], hi[0], hi[1]))
        assert len(xs) == 5 and len(ys) == 5, (name, xs, ys)
        ticks = [-8, -4, 0, 4, 8]
        sx, ox, rx = affine(xs, ticks)
        sy, oy, ry = affine(ys, ticks)
        assert rx < 2e-3 and ry < 2e-3, (rx, ry)
        panels[name] = {"box": [float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1])], "sx": sx, "ox": ox, "sy": sy, "oy": oy,
                        "xlim": [lo[0] * sx + ox, hi[0] * sx + ox], "ylim": [lo[1] * sy + oy, hi[1] * sy + oy]}
    for name, P in panels.items():
        x0, y0, x1, y1 = P["box"]
        D = lambda q: [round(float(q[0] * P["sx"] + P["ox"]), 4), round(float(q[1] * P["sy"] + P["oy"]), 4)]
        inside = lambda a: x0 - 1 < (a[:, 0].min() + a[:, 0].max()) / 2 < x1 + 1 and y0 - 1 < (a[:, 1].min() + a[:, 1].max()) / 2 < y1 + 1
        trajs = []
        for p in paths:
            sizes = {len(s) for s in p["subpaths"]}
            if p["ca"] != .5 or 15 not in sizes or not inside(pts(p)):
                continue
            c, w = centreline(p)
            trajs.append({"colour": [round(float(v), 4) for v in p["fill"]], "w": round(float(w), 3),
                          "pts": [D(q) for q in c]})
        # deaths: grey x marks (two items each, same centre); escapes: green diamonds
        deaths, escapes = [], []
        for p in paths:
            a = pts(p)
            if not inside(a):
                continue
            c = (a.min(0) + a.max(0)) / 2
            if close(p["fill"], (0.3294, 0.3569, 0.3843), 1e-2) and p["ca"] == .65 and len(p["subpaths"]) == 2 and \
                    all(len(s) != 7 for s in p["subpaths"]):
                deaths.append(D(c))
            elif close(p["fill"], (0.1412, 0.5490, 0.3412), 1e-2) and len(p["subpaths"]) == 1 and \
                    a[:, 0].max() - a[:, 0].min() < 12:
                escapes.append(D(c))
        # which marker ends which life: an escape where the path first leaves the axes (or ends, for the one escape
        # inside them), a death at the path's end; matched greedily by distance, each marker used once
        lim = 8.5
        cands = []
        for i, t in enumerate(trajs):
            q = np.array(t["pts"])
            beyond = np.where(np.abs(q).max(1) > lim)[0]
            if len(beyond):
                k = beyond[0]
                a, b = q[k - 1], q[k]
                u = min((lim - abs(a[j])) / max(abs(b[j]) - abs(a[j]), 1e-9) for j in (0, 1) if abs(b[j]) > lim)
                exit_pt = a + (b - a) * u
                for j, e in enumerate(escapes):
                    cands.append((float(np.linalg.norm(exit_pt - e)), i, "escape", j))
            else:
                for j, e in enumerate(deaths):
                    cands.append((float(np.linalg.norm(q[-1] - e)), i, "death", j))
                for j, e in enumerate(escapes):
                    cands.append((float(np.linalg.norm(q[-1] - e)), i, "escape", j))
        used_t, used_m = set(), set()
        for dist, i, kind, j in sorted(cands):
            if i in used_t or (kind, j) in used_m or dist > 1.0:
                continue
            trajs[i]["end"] = {"kind": kind, "at": (escapes if kind == "escape" else deaths)[j], "d": round(dist, 3)}
            used_t.add(i)
            used_m.add((kind, j))
        orphans = [{"kind": k, "at": (escapes if k == "escape" else deaths)[j]} for k, n in (("death", len(deaths)), ("escape", len(escapes)))
                   for j in range(n) if (k, j) not in used_m]
        P["trajectories"] = trajs
        P["legend_markers"] = orphans      # markers that end no life: the paper's in-plot legend symbols (not drawn)
        print(name, "lives with a marker:", len(used_t), "of", len(trajs), "| markers left over:", orphans,
              "| worst match %.2f blocks" % max(t["end"]["d"] for t in trajs if "end" in t))
        print(name, "trajectories", len(trajs), "deaths", len(deaths), "escapes", len(escapes),
              "grid x/y scale %.4f %.4f" % (1 / P["sx"], 1 / P["sy"]))
    # the spawn star and the mean-displacement arrow (dark, 0.13 0.15 0.17, each over a white halo). The arrow's
    # shaft is one straight stroke: two round caps (centre = point 13) and a body; its head is a filled triangle.
    dark = [p for p in paths if close(p["fill"], (0.1255, 0.1451, 0.1686), 1e-2)]
    for name, P in panels.items():
        x0, y0, x1, y1 = P["box"]
        D = lambda q: [round(float(q[0] * P["sx"] + P["ox"]), 4), round(float(q[1] * P["sy"] + P["oy"]), 4)]
        mine = [p for p in dark if x0 < pts(p)[:, 0].mean() < x1 and y0 < pts(p)[:, 1].mean() < y1]
        shaft = next(p for p in mine if sorted(len(sp) for sp in p["subpaths"]) == [15, 15, 17])
        ends = [np.array(sp[13]) for sp in shaft["subpaths"] if len(sp) == 15]
        head = next(p for p in mine if [len(sp) for sp in p["subpaths"]] == [4])
        tri = np.array(head["subpaths"][0][:3])
        tip_side = min(ends, key=lambda e: np.linalg.norm(e - tri.mean(0)))
        start = ends[0] if tip_side is ends[1] else ends[1]
        w = 2 * np.linalg.norm(np.array(shaft["subpaths"][0][0]) - np.array(shaft["subpaths"][0][13]))
        # the head is the triangle filled, then outlined (dark) over a wider white outline; the shaft has a white halo
        def stroke_w(colour, sizes):
            p = next(p for p in paths if close(p["fill"], colour, 1e-2) and [len(sp) for sp in p["subpaths"]] == sizes and
                     x0 < pts(p)[:, 0].mean() < x1 and y0 < pts(p)[:, 1].mean() < y1)
            b = next(np.array(sp) for sp in p["subpaths"] if len(sp) in (7, 15))
            return round(float(2 * np.linalg.norm(b[1] - b[0]) if len(b) == 7 else 2 * np.linalg.norm(b[0] - b[13])), 3)
        P["arrow"] = {"from": D(start), "to": D(tip_side), "w": round(float(w), 3), "head": [D(q) for q in tri],
                      "head_w": stroke_w((0.1255, 0.1451, 0.1686), [5, 5, 5, 7, 7, 7]),
                      "head_halo_w": stroke_w((1, 1, 1), [5, 5, 5, 7, 7, 7]),
                      "halo_w": stroke_w((1, 1, 1), [15, 15, 17])}
        star = next(p for p in mine if len(p["subpaths"]) == 20)
        P["star"] = [D(np.array(sp[0])) for sp in star["subpaths"] if len(sp) == 7]
        P["spawn"] = P["trajectories"][0]["pts"][0]
        print(name, "arrow", P["arrow"]["from"], "->", P["arrow"]["to"], "w", P["arrow"]["w"], "spawn", P["spawn"],
              "star vertices", len(P["star"]))
    out["panels"] = panels

    # ---------------------------------------------------------------- the escape-rate panels
    rates = {}
    bgs = [p for p in paths if close(p["fill"], (0.9490, 0.9490, 1.0), 6e-3) and len(p["subpaths"]) == 1]
    curve_styles = {(0.2824, 0.4706, 0.8157): ("ours", "shared", "solid"), (0.9333, 0.5216, 0.2902): ("ours", "independent", "dashed"),
                    (0.5843, 0.4235, 0.7059): ("vpt", "shared", "dashdot"), (0.2275, 0.5725, 0.2275): ("vpt", "independent", "dotted")}
    for p in bgs:
        a = pts(p)
        lo, hi = a.min(0), a.max(0)
        name = "ours" if lo[0] < 1630 else "vpt"
        xs, ys = grid_lines(paths, GRID_C, (lo[0], lo[1], hi[0], hi[1]))
        dedup = lambda v: [x for i, x in enumerate(v) if i == 0 or x - v[i - 1] > .05]   # grid line + spine
        xs = dedup([x for x in xs if lo[0] - .5 <= x <= hi[0] + .5])
        ys = dedup([y for y in ys if lo[1] - .5 <= y <= hi[1] + .5])
        assert len(xs) == 4 and len(ys) == 6, (name, xs, ys)
        sx, ox, rx = affine(xs, [1, 10, 20, 30])
        sy, oy, ry = affine(ys, [0, .2, .4, .6, .8, 1.0])
        assert rx < 2e-3 and ry < 2e-3, (rx, ry)
        rates[name] = {"box": [float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1])], "sx": sx, "ox": ox, "sy": sy, "oy": oy,
                       "xlim": [lo[0] * sx + ox, hi[0] * sx + ox], "ylim": [lo[1] * sy + oy, hi[1] * sy + oy], "curves": {}}
    for colour, (panel, cond, style) in curve_styles.items():
        R = rates[panel]
        D = lambda q: (float(q[0] * R["sx"] + R["ox"]), float(q[1] * R["sy"] + R["oy"]))
        line = next(p for p in paths if close(p["fill"], colour, 1e-2) and p["ca"] == 1 and
                    sum(len(sp) == 7 for sp in p["subpaths"]) > 20)
        band = next(p for p in paths if close(p["fill"], colour, 1e-2) and abs(p["ca"] - .2) < 1e-3)
        bpoly = [D(q) for q in band["subpaths"][0]]
        # every dash piece lies on one segment between consecutive lives: fit each segment's line from its pieces
        segs = [(D(a), D(b)) for a, b in body_segments(line)]
        lines = {}
        for (xa, ya), (xb, yb) in segs:
            if abs(xb - xa) < 1e-6:
                continue
            # the segment(s) from life k to life k + 1 this piece lies on: a piece only spans a vertex where the
            # line goes straight on (same slope on both sides), and then it lies on both segments
            slope = (yb - ya) / (xb - xa)
            for k in range(int(np.floor(min(xa, xb) + 2e-3)), int(np.ceil(max(xa, xb) - 2e-3))):
                lines.setdefault(k, []).append((slope, ya - slope * xa))
        ys = {}
        for k, ls in lines.items():
            sl = np.array(ls)
            assert np.ptp(sl[:, 0]) < 2e-3 * max(1, abs(sl[:, 0]).max()) + 1e-4, (panel, cond, k, ls)   # pieces agree
            m, c = sl.mean(0)
            for x in (k, k + 1):
                ys.setdefault(x, []).append(m * x + c)
        lives = sorted(ys)
        vals = {x: float(np.mean(v)) for x, v in ys.items()}
        worst = max(np.ptp(v) for v in ys.values() if len(v) > 1)
        assert lives == list(range(1, 31)), (panel, cond, lives)
        # dash pattern, in page units, from the first few dashes (chained pieces) and gaps
        dashes, cur = [], None
        for a, b in body_segments(line):
            if cur is not None and np.allclose(cur[-1], a, atol=1e-3):
                cur.append(b)
            else:
                if cur is not None:
                    dashes.append(cur)
                cur = [a, b]
        dashes.append(cur)
        dl = [sum(np.linalg.norm(np.diff(np.array(d), axis=0), axis=1)) for d in dashes]
        gl = [float(np.linalg.norm(dashes[i + 1][0] - dashes[i][-1])) for i in range(len(dashes) - 1)]
        R["curves"][cond] = {"style": style, "colour": [round(v, 4) for v in colour], "y": [round(vals[x], 5) for x in lives],
                             "w": round(float(2 * np.linalg.norm(np.array(line["subpaths"][-1][1]) - np.array(line["subpaths"][-1][0]))), 3),
                             "band": [[round(x, 4), round(y, 5)] for x, y in bpoly],
                             "dash": [round(float(np.median(dl)), 3), round(float(np.median(gl)), 3)] if len(dashes) > 1 else None,
                             "dash_lengths": sorted({round(float(v), 2) for v in dl})[:6], "gap_lengths": sorted({round(v, 2) for v in gl})[:6]}
        print(panel, cond, style, "values at lives 1..30 (worst disagreement %.2g):" % worst,
              [round(vals[x], 3) for x in (1, 5, 10, 15, 20, 25, 30)], "dash", R["curves"][cond]["dash"],
              R["curves"][cond]["dash_lengths"], R["curves"][cond]["gap_lengths"])
    # the circle markers on the solid curve
    R = rates["ours"]
    ys = R["curves"]["shared"]["y"]
    marks, rad = set(), []
    for p in paths:
        if not (close(p["fill"], (0.2824, 0.4706, 0.8157), 1e-2) and p["ca"] == 1 and len(p["subpaths"]) == 1
                and len(p["subpaths"][0]) > 30):
            continue
        a = pts(p)
        if np.ptp(a[:, 0]) > 10:
            continue
        cx, cy = (a.min(0) + a.max(0)) / 2
        life, rate = cx * R["sx"] + R["ox"], cy * R["sy"] + R["oy"]
        k = int(round(life))
        if abs(life - k) < 2e-2 and 1 <= k <= 30 and abs(rate - ys[k - 1]) < 2e-3:     # on the curve, not the legend
            marks.add(k)
            rad.append(np.ptp(a[:, 0]) / 2)
    R["markers"] = sorted(marks)
    R["marker_r"] = round(float(np.median(rad)), 3)
    print("markers at lives", R["markers"], "radius pt", R["marker_r"])
    out["rates"] = rates

    # panel (a): the challenge's screenshot
    from PIL import Image  # noqa: F401
    im = next(im for im in page.images if "X1" in im.name).image.convert("RGB")
    im.save(os.path.join(SITE, "media", "lava_challenge.jpg"), quality=84, optimize=True, progressive=True)
    out["challenge"] = {"w": im.size[0], "h": im.size[1]}

    path = os.path.join(SITE, "js", "lava-data.js")
    with open(path, "w") as f:
        f.write("// Generated by tools/extract_lava.py from the paper's figures/lava_escape.pdf. Do not edit.\n")
        f.write("window.LAVA_DATA = " + json.dumps(out, separators=(",", ":")) + ";\n")
    print("wrote", path, os.path.getsize(path))
    return out


if __name__ == "__main__":
    main()
