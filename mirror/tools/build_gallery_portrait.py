#!/usr/bin/env python3
"""Build the stacked versions of the gallery's two-up videos, which phones held upright play.

Most gallery videos are two-up composites: the video plan on the left and the agent's execution on the right, each
under its label ("Video Plan", "Executed"). On a phone held upright each half would be a few centimetres wide, so there
the page plays a stacked version instead, the plan above the execution, each half as wide as the card. site.js swaps
a video's `data-portrait-src` in while html.portrait is set, and the card takes the stacked aspect from `--par`.
"FindCave over training" is three columns of plan over execution, one per stage of training. Its stacked version
turns the stages into rows, each row the stage's title on one line and then its plan beside its execution.

The pieces are copied pixel for pixel: the halves split at exactly half the width, and the labels and the green RESYNC
borders stay baked in. A strip of black on top lets the first label clear the card's rounded corner. Each output keeps
its source's frame rate and length, so the page can swap one for the other at the same time.

usage:
  python3 mirror/tools/build_gallery_portrait.py                  # all of them
  python3 mirror/tools/build_gallery_portrait.py --only lava pong # some, by name
  python3 mirror/tools/build_gallery_portrait.py --preview DIR    # one frame of each as DIR/<name>.png;
                                                                            # no encode

Writes <source name>_portrait.mp4 next to each source in mirror/static/videos/, and prints the `--par` (width /
height) to put on its card in index.html. Needs an ffmpeg with libx264 ($FFMPEG, ffmpeg on PATH, or imageio-ffmpeg's
binary).
"""
import argparse
import os
import re
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent                                  # mirror/
VIDEOS = SITE.parent / "mirror" / "static" / "videos"
CRF = 28                    # x264 quality: about the Minecraft sources' own bitrates, 37-40 dB PSNR against them.
                            # The benchmark clips are tiny and phones blow them up 2-3x, so they get 23 (42-46 dB)
KEY_EVERY = 5                                       # seconds between keyframes, so a swap seeks quickly


def ffmpeg_bin():
    exe = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


FF = ffmpeg_bin()


# ---------------------------------------------------------------------------------------------------- layouts
# A layout is the output size and its pieces, each a rectangle of the source (x, y, w, h) and where it goes (x, y).
# Every number is even, since the frames are yuv420 and odd crops would shift by a pixel.
def two_up(w, h, top):
    """the left half (the plan) above the right half (the execution), under `top` px of black"""
    half = w // 2
    return (half, top + 2 * h), [(0, 0, half, h, 0, top), (half, 0, half, h, 0, top + h)]


def findcave():
    """the three stages of training as rows: the stage's title on one line, then its plan beside its execution.

    Each 640 px column of the source (1920x900) is the title's two lines (text at y 10-52 and 66-108), "Video Plan"
    (y 143-170), the plan (y 182-515, green border included), "Executed" (y 527-554) and the execution (y 566-899).
    The title's second line moves up beside its first, a word space after it.
    """
    ends = [(360, 563), (385, 386), (385, 584)]     # where each title's two lines end, in the column (x)
    gap = 26                                        # black above each title; the first clears the card's corner
    even = lambda v: v + (v & 1)
    pieces, y = [], 0
    for c, (e1, e2) in enumerate(ends):
        x0, y = 640 * c, y + gap
        w1 = even(e1 + 13)
        pieces += [(x0, 0, w1, 60, 0, y),                           # "0 minutes of play:"
                   (x0 + 12, 56, even(e2 - 8), 60, w1, y),          # "Randomly initialized actions"
                   (x0, 132, 640, 50, 0, y + 60),                   # "Video Plan"
                   (x0, 516, 640, 50, 640, y + 60),                 # "Executed"
                   (x0, 182, 640, 334, 0, y + 110),                 # the plan
                   (x0, 566, 640, 334, 640, y + 110)]               # the execution
        y += 444
    return (1280, y), pieces


def iron_ingot():
    """the survival interlude's iron-ingot episode (966x348): its goal line, then the plan above the execution.

    The source is the goal line ("Goal: ..." on the left, text at y 10-28 and never past x 458; the speed, "1x" to
    "32x", at x 919-965), then "Video Plan" over the plan (x 0-479) and "Executed" over the execution (x 486-965),
    labels at y 41-54 and the panels at y 60-347. The goal line keeps its left half, and the speed moves down to the
    right end of the "Video Plan" row.
    """
    return (480, 664), [(0, 0, 480, 32, 0, 0),                      # the goal line
                        (0, 32, 480, 316, 0, 32),                   # "Video Plan" and the plan
                        (906, 4, 60, 26, 420, 32),                  # the speed
                        (486, 32, 480, 316, 0, 348)]                # "Executed" and the execution


# name: (source under mirror/static/videos, its size, layout[, crf])
CLIPS = {
    "waterfall": ("basalt/waterfall_combined/waterfall_ep5.mp4", (1280, 398), two_up(1280, 398, top=12)),
    "findcave": ("basalt/basalt_findcave_comparison_resync.webm", (1920, 900), findcave()),
    "lava": ("lava_escape/icl_escape.mp4", (1280, 410), two_up(1280, 410, top=12), 26),
    "antmaze": ("c10m/antmaze_large_mirror_c10m_s3_ep8.mp4", (512, 284), two_up(512, 284, top=4), 23),
    "cube": ("c10m/cube_double_mirror_c10m_s5_ep1.mp4", (512, 284), two_up(512, 284, top=4), 23),
    "walker": ("c10m/walker-walk_mirror_c10m_s6_ep19.mp4", (512, 284), two_up(512, 284, top=4), 23),
    "pong": ("c10m/pong_mirror_c10m_s7_ep0.mp4", (512, 284), two_up(512, 284, top=4), 23),
    "failure": ("basalt/waterfall_combined/waterfall_ep1_failure.mp4", (1280, 400), two_up(1280, 400, top=12), 30),
    # not in the gallery: the survival interlude's second tab (site.js swaps it in through the tab's data-portrait-video)
    "iron": ("survival/iron_ingot_generated_vp.mp4", (966, 348), iron_ingot(), 24),   # 24: the goal line stays crisp
}


def out_path(src):
    return src.with_name(src.stem + "_portrait.mp4")


def graph(layout):
    """an ffmpeg filter graph that pastes the layout's pieces onto black, ending in [v]"""
    (W, H), pieces = layout
    n = len(pieces)
    g = [f"[0:v]split={n}" + "".join(f"[s{i}]" for i in range(n))]
    for i, (sx, sy, sw, sh, dx, dy) in enumerate(pieces):
        g.append(f"[s{i}]crop={sw}:{sh}:{sx}:{sy}[c{i}]")
    g.append(f"[c0]pad={W}:{H}:{pieces[0][4]}:{pieces[0][5]}:black[o0]")
    for i in range(1, n):
        g.append(f"[o{i - 1}][c{i}]overlay={pieces[i][4]}:{pieces[i][5]}[o{i}]")
    g[-1] = g[-1].rsplit("[", 1)[0] + "[v]"
    return ";".join(g)


def check_size(src, size):
    err = subprocess.run([FF, "-hide_banner", "-i", str(src)], capture_output=True, text=True).stderr
    m = re.search(r"Video: .*?, (\d+)x(\d+)", err)
    if not m or (int(m[1]), int(m[2])) != size:
        raise SystemExit(f"{src}: expected {size[0]}x{size[1]}, got {m and m[0]}")


def build(name, preview=None, crf=None):
    rel, size, layout, *own = CLIPS[name]
    crf = crf or (own or [CRF])[0]
    src = VIDEOS / rel
    if not src.exists():
        raise SystemExit(f"missing source: {src}")
    check_size(src, size)
    (W, H), _ = layout
    cmd = [FF, "-hide_banner", "-loglevel", "error", "-y"]
    if preview:
        out = Path(preview) / f"{name}.png"
        cmd += ["-ss", "2", "-i", str(src), "-filter_complex", graph(layout), "-map", "[v]", "-frames:v", "1", str(out)]
    else:
        out = out_path(src)
        cmd += ["-i", str(src), "-filter_complex", graph(layout), "-map", "[v]", "-c:v", "libx264", "-preset", "slow",
                "-crf", str(crf), "-pix_fmt", "yuv420p", "-profile:v", "high",
                "-force_key_frames", f"expr:gte(t,n_forced*{KEY_EVERY})", "-movflags", "+faststart", "-an", str(out)]
    if subprocess.run(cmd).returncode:
        raise SystemExit(f"ffmpeg failed on {name}")
    note = "" if preview else f", {out.stat().st_size / 1e6:.2f} MB (source {src.stat().st_size / 1e6:.2f} MB)"
    print(f"{name}: {out.relative_to(SITE.parent) if not preview else out}  {W}x{H}  --par: {W / H:.3f}{note}")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="+", choices=list(CLIPS), help="build just these (by name)")
    ap.add_argument("--preview", help="write one frame of each into this folder instead of encoding")
    ap.add_argument("--crf", type=int, help=f"x264 crf for all of them (default {CRF}, or the clip's own)")
    a = ap.parse_args()
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
    for name in a.only or CLIPS:
        build(name, a.preview, a.crf)


if __name__ == "__main__":
    main()
