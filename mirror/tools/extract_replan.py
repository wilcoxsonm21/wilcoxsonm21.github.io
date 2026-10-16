#!/usr/bin/env python3
"""Pull the closed-loop replanning figure's geometry out of the paper figure, for the page's scroll animation.

The source is website_figures/single_attempt_narrow_v2.pdf, the vector figure behind ../mirror/static/videos/
replanning.mp4 (website_figures/drift_animation/animate.py). The trajectory, re-plan points, failed attempts and
milestone are read from the page's content stream, at the same line ranges animate.py uses (each one is checked).
Its event indices and its plans through the milestone gap are reused as they are.

Writes js/replan-geometry.js (window.REPLAN_GEOM, PDF points with y up) and media/replan_log.png.

usage: uv run --no-project --with pypdf --with pillow --with numpy python mirror/tools/extract_replan.py
"""
import json
import os
import re

import numpy as np
from pypdf import PdfReader

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
PDF = os.path.join(SITE, "..", "website_figures", "single_attempt_narrow_v2.pdf")

# line ranges in the content stream (0-based, inclusive), as in drift_animation/animate.py
BLUE = (206, 365)
ORANGE = (390, 452)
ARROW0 = (461, 463)                                   # the first (short) plan: one cubic
ARROW0_HEAD = (467, 471)
DOTS = [(619, 628), (631, 640), (643, 652), (655, 664), (667, 676)]   # re-plan points
END_DOT = (591, 600)
FAILS = [(695, 699), (740, 744), (786, 790)]
CIRCLES = [(706, 715), (752, 761), (798, 807)]
REPLAN_AT = [6, 24, 73, 109, 147]                     # blue polyline indices of the events
FAIL_AT = [56, 92, 129]
MILESTONE_X = 72.0792
PLAN_END_X = 88.0
PLANS = [((35.40, 44.60), 35.62), ((62.60, 42.05), 33.33), ((59.50, 23.90), 39.53), ((53.00, 54.85), 36.42)]


def plan_curve(p0, y_gap, n=90):
    """animate.py's plan: a smooth path from p0 into the milestone gap (arriving level), then on past it."""
    p0 = np.asarray(p0, float)
    pb = np.array([MILESTONE_X, y_gap])
    c1 = p0 + (pb - p0) * 0.45
    c2 = pb - np.array([max((pb[0] - p0[0]) * 0.45, 4.0), 0.0])
    t = np.linspace(0, 1, n)[:, None]
    bez = (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t ** 2 * c2 + t ** 3 * pb
    tail = np.linspace(pb, [PLAN_END_X, y_gap], 20)[1:]
    return np.vstack([bez, tail])


def main():
    page = PdfReader(PDF).pages[0]
    L = page["/Contents"].get_object().get_data().decode("latin-1").split("\n")

    def cm(i):                        # the translation set on line i ("q 1 0 0 1 tx ty cm")
        m = re.match(r"\s*q 1 0 0 1 (\S+) (\S+) cm", L[i])
        assert m, (i, L[i])
        return np.array([float(m.group(1)), float(m.group(2))])

    def nums(rng):
        out = []
        for i in range(rng[0], rng[1] + 1):
            v = L[i].split()
            if v and v[-1] in ("m", "l", "c"):
                out += [[float(v[j]), float(v[j + 1])] for j in range(0, len(v) - 1, 2)]
        return np.array(out)

    def poly(rng):
        assert L[rng[0]].strip() == "0 0 m" and L[rng[1] + 1].strip() == "S", rng
        return (nums(rng) + cm(rng[0] - 1)).round(4).tolist()

    def circle(rng):                  # centre and radius from the path's bounding box
        P = nums(rng) + cm(rng[0] - 1)
        lo, hi = P.min(0), P.max(0)
        return [*((lo + hi) / 2).round(4).tolist(), round(float((hi - lo)[1] / 2), 4)]

    blue, orange = poly(BLUE), poly(ORANGE)
    a0 = nums(ARROW0) + cm(ARROW0[0] - 1)
    head = nums(ARROW0_HEAD) + cm(ARROW0_HEAD[0] - 1)
    fails = []
    for rng in FAILS:
        P = nums(rng) + cm(rng[0] - 1)
        lo, hi = P.min(0), P.max(0)
        fails.append([*((lo + hi) / 2).round(4).tolist(), round(float(hi[0] - lo[0]), 4)])
    # the milestone: two solid segments, dashed across the gap
    assert L[371].strip().startswith("q 1 0 0 1 72.0792 41.9118") and L[376].strip().startswith("q 1 0 0 1 72.0792 30.9273")
    wall = {"x": MILESTONE_X, "upper": [41.9118, 41.9118 + 21.282], "lower": [30.9273 - 21.282, 30.9273],
            "gap": [30.9273, 41.9118], "w": 2.6}
    # the plan corridor: 15 stacked translucent bands (Fm0..Fm14), all centred on one height
    xo = page["/Resources"]["/XObject"]
    halves, centre = [], None
    for k in range(15):
        d = xo[f"/Fm{k}"].get_object().get_data().decode("latin-1")
        top = float(re.search(r"q 1 0 0 1 \S+ (\S+) cm", d).group(1))
        h = -float(re.search(r"\n0 (-\S+) l", d).group(1))
        halves.append(round(h / 2, 4))
        centre = top - h / 2
    # the log icon
    # the log icon: its white surround becomes transparent (the page is cream), then it is cropped and shrunk
    from PIL import Image, ImageDraw, ImageFilter
    out_png = os.path.join(SITE, "media", "replan_log.png")
    im = next(im for im in page.images if "Im0" in im.name).image.convert("RGB")
    marker = im.copy()
    w, h = im.size
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(marker, xy, (255, 0, 255), thresh=40)
    m = np.asarray(marker)
    bg = (m[..., 0] == 255) & (m[..., 1] == 0) & (m[..., 2] == 255)
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    rgba = im.convert("RGBA")
    rgba.putalpha(alpha)
    box = alpha.getbbox()
    rgba = rgba.crop(box)
    rgba.thumbnail((180, 180), Image.LANCZOS)
    rgba.save(out_png, optimize=True)
    size = 11.9175                                            # the image's square on the page, in points
    log = {"x": 65.9635 + box[0] / w * size, "top": 64.0676 + size - box[1] / h * size,
           "w": (box[2] - box[0]) / w * size, "h": (box[3] - box[1]) / h * size}
    geom = {
        "W": 122.616, "H": 77.645,
        "blue": blue, "orange": orange,
        "arrow0": {"bez": a0.round(4).tolist(), "head": head.round(4).tolist()},
        "dots": [circle(r) for r in DOTS], "endDot": circle(END_DOT),
        "fails": fails, "circles": [circle(r) for r in CIRCLES],
        "wall": wall, "band": {"centre": round(centre, 4), "halves": halves, "alpha": 0.0420074},
        "log": {k: round(v, 4) for k, v in log.items()},
        "replanAt": REPLAN_AT, "failAt": FAIL_AT,
        "plans": [plan_curve(p0, y).round(3).tolist() for p0, y in PLANS],
    }
    path = os.path.join(SITE, "js", "replan-geometry.js")
    with open(path, "w") as f:
        f.write("// Generated by tools/extract_replan.py from website_figures/single_attempt_narrow_v2.pdf "
                "(PDF points, y up). Do not edit.\n")
        f.write("window.REPLAN_GEOM = " + json.dumps(geom, separators=(",", ":")) + ";\n")
    print("wrote", path, os.path.getsize(path), "bytes;", out_png)
    print("blue", len(blue), "orange", len(orange), "dots", geom["dots"], "fails", fails, "circles", geom["circles"])
    print("band centre", centre, "halves", halves[:3], "...", halves[-1])


if __name__ == "__main__":
    main()
