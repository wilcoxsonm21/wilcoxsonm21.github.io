#!/usr/bin/env python3
"""Build media/hero.mp4, the montage seen through the letters of "Mirror" in the hero.

One agent, many worlds: Minecraft (diamonds first, then a waterfall, lava, a cave, a tree) and the benchmark suites (DeepMind
Control, OGBench, Atari, and OGBench manipulation), each shown for a couple of seconds. A soft edge sweeps from left
to right between shots, so the letters change one after another, M first. The last shot sweeps back into the first,
so the video loops without a seam. SHOTS below is the whole edit.

Every clip is the agent's own execution: the "Executed" panel of the site's side-by-side videos, the raw survival
episode (diamonds_oracle_student.mp4, which only the talk folder has), or the trained rollout of the intro
animation. Nothing from the video plans or human demos.

usage:
  python3 mirror/tools/build_hero.py                 # writes media/hero.mp4 and media/hero_poster.jpg
  (then media/hero_small.mp4, for small screens and slow connections: $FFMPEG -i media/hero.mp4 -vf
   scale=960:288:flags=lanczos -c:v libx264 -preset veryslow -crf 27 -tune film -pix_fmt yuv420p -movflags +faststart -an)
  python3 mirror/tools/build_hero.py --sheet out.jpg  # contact sheet of the montage, no encode
  python3 mirror/tools/build_hero.py --sheet out.jpg --mask clip.png --only lava   # one shot, as the
      page shows it; clip.png is a screenshot of .hero-video-clip with the video hidden and the clip painted red

The hero box is about 3.35:1 at every width (css: .hero-mark is 3.25:1, the clip is inset 8 px), so the video is
1280x384 and `object-fit: cover` only trims a pixel or two. The rows of benchmark clips split the frame at gaps
between letters (GAP: "M | irr | or", "Mi | rror"), measured in Chromium on desktop and phone layouts, so no letter
is cut in two.

Needs numpy, Pillow and an ffmpeg with libx264 ($FFMPEG, ffmpeg on PATH, or imageio-ffmpeg's binary).
"""
import argparse
import os
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SITE = HERE.parent                                  # mirror/
VIDEOS = SITE.parent / "mirror" / "static" / "videos"
SCENE_MEDIA = SITE / "scenes" / "media"
TALK = Path.home() / "mirror_talk"                  # talk sources that are not on the site

W, H, FPS = 1280, 384, 30
SWEEP = 1.0                     # seconds a sweep takes
FEATHER = 0.42 * W              # width of the sweep's soft edge
TILT = 0.30                     # the edge leans: x shifts by TILT px per px of height
GAP = {"M|i": 0.2749, "i|r": 0.3779, "r|o": 0.6599}  # gaps between letters, as fractions of the width
# (Source Sans 3 ExtraBold, no tracking: the middle of each gap that is open at 1440, 1280, 1920 and 390 px wide)
GUTTER = 4                      # px of dark gap at a seam
DARK = (13, 14, 16)


def ffmpeg_bin():
    exe = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


FF = ffmpeg_bin()


# ---------------------------------------------------------------------------------------------------- sources
class Source:
    """A video, cropped to the region that shows the agent's own view (x, y, w, h in source pixels).

    hud: the Minecraft crosshair (and the attack meter under it), as a box (x0, y0, x1, y1) in the cropped frame; it
    is painted out, since through the letters it reads as a speck of dirt rather than as part of the game.
    """
    _probe = {}

    def __init__(self, path, rect, hud=None):
        self.path, self.rect, self.hud = Path(path), rect, hud
        if not self.path.exists():
            raise SystemExit(f"missing source: {self.path}")

    @property
    def fps(self):
        if self.path not in Source._probe:
            err = subprocess.run([FF, "-hide_banner", "-i", str(self.path)], capture_output=True, text=True).stderr
            Source._probe[self.path] = float(re.search(r"([\d.]+) fps", err).group(1))
        return Source._probe[self.path]

    def load(self, t0, t1):
        """Frames from t0 to t1 (seconds) as uint8 [n, h, w, 3]."""
        x, y, w, h = self.rect
        cmd = [FF, "-hide_banner", "-loglevel", "error", "-ss", f"{t0:.3f}", "-t", f"{t1 - t0:.3f}",
               "-i", str(self.path), "-vf", f"crop={w}:{h}:{x}:{y}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
        raw = subprocess.run(cmd, capture_output=True, check=True).stdout
        n = len(raw) // (w * h * 3)
        frames = np.frombuffer(raw, np.uint8)[: n * w * h * 3].reshape(n, h, w, 3)
        if self.hud:
            frames = frames.copy()
            fill_patch(frames, *self.hud)
        return frames


def fill_patch(frames, x0, y0, x1, y1):
    """Replace the box [x0, x1] x [y0, y1] by blending its four edges inwards (a Coons patch)."""
    f = frames.astype(np.float32)
    u = (np.arange(x0, x1 + 1, dtype=np.float32) - (x0 - 1)) / (x1 - x0 + 2)
    v = (np.arange(y0, y1 + 1, dtype=np.float32) - (y0 - 1)) / (y1 - y0 + 2)
    left, right = f[:, y0:y1 + 1, x0 - 1], f[:, y0:y1 + 1, x1 + 1]
    top, bottom = f[:, y0 - 1, x0:x1 + 1], f[:, y1 + 1, x0:x1 + 1]
    across = left[:, :, None] * (1 - u)[None, None, :, None] + right[:, :, None] * u[None, None, :, None]
    down = top[:, None] * (1 - v)[None, :, None, None] + bottom[:, None] * v[None, :, None, None]
    frames[:, y0:y1 + 1, x0:x1 + 1] = np.clip((across + down) / 2 + .5, 0, 255).astype(np.uint8)


def side_by_side(path, frame_h=284, header=28):
    """The site's c10m benchmark clips: plan (left) | executed (right), 256 px squares under a 28 px header."""
    return Source(path, (256, header, 256, frame_h - header))


def crosshair(x, y):
    return (x - 7, y - 7, x + 7, y + 13)


WATERFALL = Source(SCENE_MEDIA / "basalt_ep5_pov.mp4", (0, 0, 640, 300), hud=crosshair(319, 166))
# FindCave and lava come from the episodes' own recordings (640x360, above the hotbar): the cave was a panel of the
# comparison grid (a 320 px pane upscaled into a 2.7 Mbps VP9 grid), and zoomed 1.2x on top, so it was the one blurry
# shot; lava was a panel of a two-up composite. FindCave is the self-improving arm's episode 00, as the BASALT episodes
# viewer streams it (hwryu/mirror_diamond_eval, basalt_findcave_self_improving/raw/00.mp4), copied to the talk folder.
FINDCAVE = Source(TALK / "source_videos" / "hero" / "basalt_findcave_self_improving_00.mp4", (0, 0, 640, 312),
                  hud=crosshair(319, 179))
LAVA = Source(TALK / "source_videos" / "gallery" / "lava_pov.mp4", (0, 0, 640, 300), hud=crosshair(319, 179))
SURVIVAL = Source(TALK / "source_videos" / "diamonds_oracle_student.mp4", (0, 0, 640, 316),   # above the hotbar
                  hud=crosshair(319, 179))
ROBOT = Source(TALK / "intro_anim" / "data" / "clips" / "trained.mp4", (0, 0, 1024, 1024))
WALKER = side_by_side(VIDEOS / "c10m" / "walker-walk_mirror_c10m_s6_ep19.mp4")
ANTMAZE = side_by_side(VIDEOS / "c10m" / "antmaze_large_mirror_c10m_s3_ep8.mp4")
CUBES = side_by_side(VIDEOS / "c10m" / "cube_double_mirror_c10m_s5_ep1.mp4")
PONG = side_by_side(VIDEOS / "c10m" / "pong_mirror_c10m_s7_ep0.mp4")


# ---------------------------------------------------------------------------------------------------- shots
class Layer:
    """One clip placed in a box of the frame.

    t_in: source time at the moment the shot is fully in; speed: playback rate; focus: centre of the view, as
    fractions of the source rect; zoom: (start, end) over the time the shot is visible, 1 = the largest view of the
    box's aspect that fits the source; grade: gamma (<1 brightens), gain, sat; nearest: pixel-art scaling.
    """

    def __init__(self, src, t_in, box=(0, 0, W, H), speed=1.0, focus=(.5, .5), zoom=(1.0, 1.06), grade=None,
                 nearest=False):
        self.src, self.t_in, self.box, self.speed = src, t_in, box, speed
        self.focus, self.zoom, self.grade, self.nearest = focus, zoom, grade or {}, nearest
        self.frames = None

    def prepare(self, t_lo, t_hi):
        a = self.t_in + t_lo * self.speed
        b = self.t_in + t_hi * self.speed
        self.f0 = max(0.0, a - 2 / self.src.fps)
        self.frames = self.src.load(self.f0, b + 2 / self.src.fps)
        if len(self.frames) == 0:
            raise SystemExit(f"no frames from {self.src.path} at {a:.2f}-{b:.2f}s")

    def render(self, out, tau, u):
        """Draw at shot time tau; u in [0, 1] is how far through its visible span the shot is (for the zoom)."""
        ts = self.t_in + tau * self.speed
        i = int(round((ts - self.f0) * self.src.fps))
        f = self.frames[min(max(i, 0), len(self.frames) - 1)]
        bx, by, bw, bh = self.box
        sh, sw = f.shape[:2]
        aspect = bw / bh
        cw, ch = (sh * aspect, sh) if sw / sh > aspect else (sw, sw / aspect)
        z = self.zoom[0] + (self.zoom[1] - self.zoom[0]) * u
        cw, ch = cw / z, ch / z
        cx = min(max(self.focus[0] * sw, cw / 2), sw - cw / 2)
        cy = min(max(self.focus[1] * sh, ch / 2), sh - ch / 2)
        img = Image.fromarray(f).resize((bw, bh), Image.NEAREST if self.nearest else Image.LANCZOS,
                                        box=(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2))
        a = np.asarray(img, np.float32) / 255
        g = self.grade
        if g.get("gamma", 1) != 1:
            a = a ** g["gamma"]
        if g.get("gain", 1) != 1:
            a = a * g["gain"]
        if g.get("sat", 1) != 1:
            lum = a @ np.float32([.299, .587, .114])
            a = lum[..., None] + (a - lum[..., None]) * g["sat"]
        out[by:by + bh, bx:bx + bw] = np.clip(a, 0, 1)


class Shot:
    """hold: seconds fully in view; seams: the tile seams of a row of clips, drawn as thin dark gutters."""

    def __init__(self, name, hold, layers, seams=()):
        self.name, self.hold, self.layers, self.seams = name, hold, layers, seams

    def render(self, tau):
        out = np.empty((H, W, 3), np.float32)
        out[:] = np.float32(DARK) / 255
        u = (tau + SWEEP) / (self.hold + 2 * SWEEP)
        for layer in self.layers:
            layer.render(out, tau, u)
        for s in self.seams:
            x = round(s * W)
            out[:, x - GUTTER // 2:x + GUTTER // 2] = np.float32(DARK) / 255
        return out


def row(*seams):
    """Boxes of the tiles of a row split at the given seams, and the seams."""
    xs = [0] + [round(s * W) for s in seams] + [W]
    return [(xs[i], 0, xs[i + 1] - xs[i], H) for i in range(len(xs) - 1)], seams


MC = {"sat": 1.08}                    # a touch more colour for Minecraft, which reads paler than the cream page

ROW3, SEAMS3 = row(GAP["M|i"], GAP["r|o"])          # M | irr | or
ROW2, SEAMS2 = row(GAP["i|r"])                      # Mi | rror

SHOTS = [
    # the loop opens on diamonds
    Shot("diamonds", 2.2, [Layer(SURVIVAL, 460.3, speed=0.9, focus=(.5, .45), zoom=(1.0, 1.06),
                                 grade={"gamma": .55, "gain": 1.25, "sat": 1.35})]),   # lifted: it is underground
    Shot("waterfall", 2.3, [Layer(WATERFALL, 27.4, focus=(.5, .42), zoom=(1.0, 1.08), grade=MC)]),
    Shot("dmc-ogbench-atari", 2.5, [
        Layer(WALKER, 6.0, box=ROW3[0], zoom=(1.0, 1.04)),                     # its limbs show in the M
        Layer(PONG, 30.0, box=ROW3[1], zoom=(1.0, 1.0), nearest=True),
        Layer(ANTMAZE, 18.0, box=ROW3[2], speed=1.5, zoom=(1.0, 1.04)),        # the ant fills the o
    ], SEAMS3),
    Shot("lava", 2.2, [Layer(LAVA, 15.0, focus=(.5, .55), zoom=(1.0, 1.07), grade=MC)]),
    Shot("cave", 2.4, [Layer(FINDCAVE, 109.0, focus=(.5, .5), zoom=(1.0, 1.06), grade=MC)]),   # down into the cave
    Shot("manipulation", 2.3, [
        Layer(CUBES, 0.9, box=ROW2[0], speed=0.72, focus=(.5, .68), zoom=(1.13, 1.17)),   # table edges above
        Layer(ROBOT, 1.0, box=ROW2[1], speed=0.76, focus=(.5, .56), zoom=(1.0, 1.05)),    # the letters
    ], SEAMS2),
    Shot("tree", 2.2, [Layer(SURVIVAL, 63.4, focus=(.5, .45), zoom=(1.0, 1.06), grade=MC)]),
]


# ---------------------------------------------------------------------------------------------------- timeline
START, LENGTH = [], 0.0           # set by prepare()
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
XS = XX - TILT * (YY - H / 2)               # the edge leans to the right at the bottom


def sweep(p):
    """Alpha of the incoming shot, p in [0, 1] through the sweep."""
    e = 0.5 - 0.5 * np.cos(np.pi * p)
    lo, hi = -FEATHER / 2 - TILT * H / 2, W + FEATHER / 2 + TILT * H / 2
    edge = lo + (hi - lo) * e
    a = np.clip((edge - XS) / FEATHER + 0.5, 0, 1)
    return (a * a * (3 - 2 * a))[..., None]


def frame(t):
    t %= LENGTH
    for k, shot in enumerate(SHOTS):
        tau = t - START[k]
        if 0 <= tau < shot.hold:
            return shot.render(tau)
        if shot.hold <= tau < shot.hold + SWEEP:
            nxt = (k + 1) % len(SHOTS)
            tau_in = tau - shot.hold - SWEEP          # the next shot is fully in at tau_in = 0
            a = sweep((tau - shot.hold) / SWEEP)
            return shot.render(tau) * (1 - a) + SHOTS[nxt].render(tau_in) * a
    raise AssertionError(t)


def prepare(only=None):
    global SHOTS, START, LENGTH
    if only:
        SHOTS = [s for s in SHOTS if s.name in only]
    START, t = [], 0.0
    for shot in SHOTS:
        START.append(t)
        t += shot.hold + SWEEP
        for layer in shot.layers:
            layer.prepare(-SWEEP, shot.hold + SWEEP)
    LENGTH = t


def to8(f):
    return (np.clip(f, 0, 1) * 255 + .5).astype(np.uint8)


# ---------------------------------------------------------------------------------------------------- outputs
def sheet(path, mask=None, cols=4, step=0.8):
    """Frames every `step` seconds; with a mask (the measured letter openings), as the page shows them."""
    ts = np.arange(0, LENGTH, step)
    m = None
    if mask:
        mi = Image.open(mask).convert("RGB")
        a = np.asarray(mi.resize((W, round(W * mi.height / mi.width)))).astype(int)
        red = ((a[..., 0] > 160) & (a[..., 1] < 110) & (a[..., 2] < 110)).astype(np.float32)
        m = np.zeros((H, W), np.float32)
        oy = (H - red.shape[0]) // 2
        m[max(oy, 0):max(oy, 0) + min(H, red.shape[0])] = red[max(-oy, 0):max(-oy, 0) + min(H, red.shape[0])]
        m = m[..., None]
    cream = np.float32([250, 249, 245]) / 255
    tw, th = W // 2, H // 2
    rows = (len(ts) + cols - 1) // cols
    out = Image.new("RGB", (cols * (tw + 6), rows * (th + 6)), (255, 255, 255))
    for i, t in enumerate(ts):
        f = frame(t)
        if m is not None:
            f = f * m + cream * (1 - m)
        out.paste(Image.fromarray(to8(f)).resize((tw, th), Image.LANCZOS), ((i % cols) * (tw + 6), (i // cols) * (th + 6)))
    out.save(path, quality=88)
    print(f"{path}: {len(ts)} frames of {LENGTH:.2f} s")


def encode(path, poster, crf):
    n = int(round(LENGTH * FPS))
    cmd = [FF, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryslow", "-crf", str(crf), "-tune", "film",
           "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", "-an", str(path)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        f = to8(frame(i / FPS))
        if i == 0:
            Image.fromarray(f).save(poster, quality=86)
        p.stdin.write(f.tobytes())
    p.stdin.close()
    if p.wait():
        raise SystemExit("ffmpeg failed")
    print(f"{path}: {n} frames, {LENGTH:.2f} s, {path.stat().st_size / 1e6:.2f} MB; poster {poster}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=SITE / "media" / "hero.mp4")
    ap.add_argument("--poster", type=Path, default=SITE / "media" / "hero_poster.jpg")
    ap.add_argument("--crf", type=int, default=23)   # (23: about 4.4 MB, the size it was at 20 with the blurry cave)
    ap.add_argument("--sheet", type=Path, help="write a contact sheet instead of encoding")
    ap.add_argument("--mask", help="letter mask (red openings) to view the sheet through")
    ap.add_argument("--step", type=float, default=0.8)
    ap.add_argument("--only", nargs="+", help="preview just these shots (by name)")
    a = ap.parse_args()
    prepare(a.only)
    if a.sheet:
        sheet(a.sheet, a.mask, step=a.step)
    else:
        encode(a.out, a.poster, a.crf)


if __name__ == "__main__":
    main()
