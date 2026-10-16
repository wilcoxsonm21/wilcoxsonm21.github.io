#!/usr/bin/env python3
"""Builds the gallery's clips with no text in them: game pixels only, as the survival clips are.

Each clip is the video plan beside the execution (or, for "FindCave over training", three stages, each plan above
execution), plus a stacked version for phones held upright, with the plan above the execution (FindCave: one stage per
row, plan beside execution). The page draws every label over the clip ("Video plan", "Execution", the stage), so the
text is as sharp as the screen. Every plan gets the survival clips' green flash where it re-syncs to the real
observation: every 16 frames from frame 1 in Minecraft, and at each plan's first step (every 2-5 steps) in the
benchmarks, where it fades faster so each flash is over before the next.

The Minecraft recordings have the agent's keys drawn into their bottom-right corner (tasks/minerl/rollout_viz.py in
video_planner: white DejaVu Sans on black at alpha 180/255). Where the episode's actions.jsonl exists (MakeWaterfall,
the lava escape) the box is laid out again from the actions, its pixels are brightened back by 255/75, and the text
strokes are inpainted. The FindCave stages have no action log and are 320 px wide, too small for that, so their panes
are cropped above the HUD, where the keys sit.

Sources (kept off the site, in SRC_DIR):
  waterfall{5,1}_{pov,vp_plan}.mp4, waterfall{5,1}_actions.jsonl
      /data/scene-rep/vpt/waterfall_results/waterfall/ours_active/episode_0000{5,1}/{pov,vp_plan}.mp4, actions.jsonl
  lava_{pov,vp_plan}.mp4, lava_actions.jsonl     /data/scene-rep/vpt/lava_escape_icl_ep1/
  findcave_{0,3125,6250_success}.mp4             /data/scene-rep/u/echen/video_planner/findcave_viz/ (execution | plan,
                                                 labelled, 320x192 panes)
  the benchmark episodes                         website_figures/env_rollouts_c10m/recordings/<name>/ep<n>.npz

  ~/miniconda3/envs/supe/bin/python mirror/tools/build_gallery.py            # all of them (needs cv2)
  ~/miniconda3/envs/supe/bin/python mirror/tools/build_gallery.py lava pong  # some
  ... --preview DIR                                                          # one frame of each, no encode
"""
import argparse
import json
import os
import subprocess

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
SRC_DIR = os.path.expanduser("~/mirror_talk/source_videos/gallery")
RECORDINGS = os.path.join(os.path.dirname(SITE), "website_figures", "env_rollouts_c10m", "recordings")
OUT_DIR = os.path.join(SITE, "media", "gallery")
POSTERS = os.path.join(SITE, "media", "posters")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
GREEN = np.array([30, 255, 83], np.float32)
KEY_EVERY = 5   # seconds between keyframes, so turning the phone swaps the clips quickly
# x264 quality: 28 brings the Minecraft clips to the old gallery's ~1 Mbit/s; the benchmark clips are tiny and phones blow
# them up 2-3x, so they get 23 (as tools/build_gallery_portrait.py did)
CRF_MINECRAFT, CRF_BENCHMARK = 28, 23

MINECRAFT = {   # name: (execution, plan, actions)
    "gallery_waterfall_ep5": ("waterfall5_pov.mp4", "waterfall5_vp_plan.mp4", "waterfall5_actions.jsonl"),
    "gallery_waterfall_ep1_failure": ("waterfall1_pov.mp4", "waterfall1_vp_plan.mp4", "waterfall1_actions.jsonl"),
    "gallery_lava_escape": ("lava_pov.mp4", "lava_vp_plan.mp4", "lava_actions.jsonl"),
}
FINDCAVE = ["findcave_0.mp4", "findcave_3125.mp4", "findcave_6250_success.mp4"]
BENCHMARKS = {   # name: (recording, episode), the episodes the gallery has shown since 10-12
    "gallery_antmaze_large": ("antmaze_large_s3", 8),
    "gallery_cube_double": ("cube_double_s5", 1),
    "gallery_walker_walk": ("walker-walk_s6", 19),
    "gallery_pong": ("pong_s7", 0),
}
SHORT = {"waterfall5": "gallery_waterfall_ep5", "waterfall1": "gallery_waterfall_ep1_failure", "lava": "gallery_lava_escape",
         "findcave": "gallery_findcave_training", "antmaze": "gallery_antmaze_large", "cube": "gallery_cube_double",
         "walker": "gallery_walker_walk", "pong": "gallery_pong"}

# ------------------------------------------------------------------ the keys box (rollout_viz.py)
ORDER = [("forward", "↑"), ("back", "↓"), ("left", "←"), ("right", "→"), ("jump", "SPACE"), ("sneak", "SHIFT"),
         ("sprint", "CTRL"), ("attack", "LMB"), ("use", "RMB"), ("drop", "Q"), ("inventory", "E")] + \
        [(f"hotbar.{i}", str(i)) for i in range(1, 10)]
ALPHA = 180 / 255


def key_tokens(path, n):
    """the keys shown on each frame: action i produces frame i + 1"""
    out = [[] for _ in range(n)]
    for i, line in enumerate(open(path)):
        if i + 1 >= n:
            break
        a = json.loads(line)["action"]
        t = [lab for k, lab in ORDER if np.asarray(a.get(k, 0)).any()]
        if np.asarray(a.get("ESC", 0)).any():
            t.append("ESC")
        out[i + 1] = t
    return out


def key_box(tokens, w, h):
    """the box's (left, top, right, bottom), inclusive, as rollout_viz lays it out"""
    fs = max(10, h // 22)
    font = ImageFont.truetype("DejaVuSans.ttf", fs)
    margin, padding = max(3, h // 64), max(2, h // 96)
    d = ImageDraw.Draw(Image.new("L", (w, h)))
    lines, cur = [], ""
    for tk in tokens:
        c = f"{cur}  {tk}" if cur else tk
        b = d.textbbox((0, 0), c, font=font)
        if cur and b[2] - b[0] > w - 2 * (margin + padding):
            lines.append(cur)
            cur = tk
        else:
            cur = c
    lines.append(cur)
    boxes = [d.textbbox((0, 0), ln, font=font) for ln in lines]
    lh = max(b[3] - b[1] for b in boxes)
    th = len(lines) * lh + (len(lines) - 1) * max(1, fs // 6)
    tw = max(b[2] - b[0] for b in boxes)
    right, bottom = w - margin, h - margin
    return max(0, right - tw - 2 * padding), max(0, bottom - th - 2 * padding), right, bottom


def unkey(frame, tokens):
    """the frame without its keys box: brightened back, with the text strokes inpainted"""
    if not tokens:
        return frame
    h, w = frame.shape[:2]
    l, t, r, b = key_box(tokens, w, h)
    g = np.log1p(frame.astype(np.float32).mean(axis=2))
    # (the encoded edge sits within a pixel or two of the laid-out one: take the strongest darkening step there)
    l = max(range(max(1, l - 2), l + 3), key=lambda x: float(np.median(g[t + 2:b - 1, x - 1] - g[t + 2:b - 1, x])))
    out = frame.astype(np.float32)
    box = out[t:b + 1, l:r + 1]
    text = np.zeros((h, w), np.uint8)
    text[t:b + 1, l:r + 1] = (box.max(axis=2) > 95) * 255   # brighter than any scene darkened to 29% can be
    out[t:b + 1, l:r + 1] = box / (1 - ALPHA)
    out = np.clip(out, 0, 255).astype(np.uint8)
    mask = cv2.dilate(text, np.ones((3, 3), np.uint8), iterations=2)
    cv2.rectangle(mask, (l, t), (r, b), 255, 1)   # the box's edge, blurred by the encoder
    return cv2.inpaint(out, mask, 4, cv2.INPAINT_TELEA)


# ------------------------------------------------------------------ frames in, frames out
def frames(path):
    reader = imageio_ffmpeg.read_frames(path)
    meta = next(reader)
    w, h = meta["size"]
    for b in reader:
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)


def fps_of(path):
    return float(next(imageio_ffmpeg.read_frames(path))["fps"])


def pulse(plan, j, fps, first=1, every=16, border=6):
    """the survival clips' re-sync flash, for a plan made every `every` frames from frame `first`"""
    return flash(plan, ((j - first) % every) / fps if j >= first else None, border=border)


def flash(plan, age, fade=.15, border=6):
    """a green border that fades over `fade` seconds after each new plan; age: seconds since the plan's first frame"""
    if age is None or age >= fade:
        return plan
    a = (1 - age / fade) ** 1.5
    out = plan.astype(np.float32)
    b = border
    for sl in (np.s_[:b], np.s_[-b:], np.s_[b:-b, :b], np.s_[b:-b, -b:]):
        out[sl] = out[sl] * (1 - a) + GREEN * a
    return np.rint(out).astype(np.uint8)


def resize(im, w, h, nearest=False):
    return np.asarray(Image.fromarray(im).resize((w, h), Image.NEAREST if nearest else Image.BILINEAR))


class Out:
    """the landscape and the stacked clip, written together"""

    def __init__(self, name, land, port, fps, preview=None, crf=CRF_MINECRAFT):
        self.name, self.fps, self.preview, self.n, self.shot = name, fps, preview, 0, None
        self.procs = [] if preview else [self.encoder(os.path.join(OUT_DIR, name + s + ".mp4"), *size, fps, crf)
                                         for s, size in (("", land), ("_portrait", port))]

    @staticmethod
    def encoder(path, w, h, fps, crf):
        return subprocess.Popen([
            FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", f"{fps:g}",
            "-i", "-", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
            "-g", str(round(fps * KEY_EVERY)), "-movflags", "+faststart", path], stdin=subprocess.PIPE)

    def write(self, land, port):
        if self.preview:
            self.shot = (land, port)   # (the last frame it gets)
        else:
            self.procs[0].stdin.write(np.ascontiguousarray(land).tobytes())
            self.procs[1].stdin.write(np.ascontiguousarray(port).tobytes())
        self.n += 1

    def close(self):
        if self.preview:
            land, port = self.shot
            Image.fromarray(land).save(os.path.join(self.preview, self.name + ".png"))
            Image.fromarray(port).save(os.path.join(self.preview, self.name + "_portrait.png"))
            return
        for p in self.procs:
            p.stdin.close()
            if p.wait():
                raise RuntimeError(f"ffmpeg failed on {self.name}")
        for s in ("", "_portrait"):
            subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", os.path.join(OUT_DIR, self.name + s + ".mp4"),
                            "-frames:v", "1", "-q:v", "3", os.path.join(POSTERS, self.name + s + ".jpg")], check=True)
        print(f"{self.name}: {self.n} frames at {self.fps:g} fps", flush=True)


# ------------------------------------------------------------------ the clips
def minecraft(name, preview=None, limit=None):
    ex_name, plan_name, act_name = MINECRAFT[name]
    ex_path = os.path.join(SRC_DIR, ex_name)
    keys = key_tokens(os.path.join(SRC_DIR, act_name), 10 ** 6)
    fps = fps_of(ex_path)
    out = Out(name, (1280, 360), (640, 720), fps, preview)
    for j, (ex, plan) in enumerate(zip(frames(ex_path), frames(os.path.join(SRC_DIR, plan_name)))):
        if limit and j >= limit:
            break
        ex = unkey(ex, keys[j])
        plan = pulse(resize(plan, 640, 360), j, fps)
        out.write(np.concatenate([plan, ex], 1), np.concatenate([plan, ex], 0))
    out.close()


FC_TOP, FC_BOTTOM = 24, 168   # under the old label band, above the HUD (hearts from row 170, the keys from 178)


def findcave(preview=None, limit=None):
    paths = [os.path.join(SRC_DIR, f) for f in FINDCAVE]
    fps = fps_of(paths[0])
    pw, ph = 320, FC_BOTTOM - FC_TOP   # native: upscaling in the file only spends bits; the browser scales it
    out = Out("gallery_findcave_training", (3 * pw, 2 * ph), (2 * pw, 3 * ph), fps, preview)
    for j, fs in enumerate(zip(*(frames(p) for p in paths))):
        if limit and j >= limit:
            break
        stages = []
        for f in fs:   # each source is execution | plan, 320x192 apiece
            ex = f[FC_TOP:FC_BOTTOM, :320]
            plan = pulse(f[FC_TOP:FC_BOTTOM, 320:], j, fps, border=3)
            stages.append((plan, ex))
        land = np.concatenate([np.concatenate(s, 0) for s in stages], 1)
        port = np.concatenate([np.concatenate(s, 1) for s in stages], 0)
        out.write(land, port)
    out.close()


def benchmark(name, preview=None, limit=None):
    rec_name, episode = BENCHMARKS[name]
    rec = np.load(os.path.join(RECORDINGS, rec_name, f"ep{episode}.npz"))
    executed, plans, steps = rec["executed"], rec["plans"], rec["plan_steps"]
    K, T, fps = plans.shape[1], len(executed), float(rec["fps"])
    chunk, offset = np.full(T, -1), np.full(T, -1)
    for c, s in enumerate(steps):   # frame s + j shows the state plan c predicted j steps after its observation
        for j in range(K):
            if s + j < T:
                chunk[s + j], offset[s + j] = c, j
    assert (chunk >= 0).all()
    # a new plan every K steps: its flash fades by the next one (the survival clips' 0.15 s, or one chunk if shorter)
    fade = min(.15, K / fps)
    out = Out(name, (512, 256), (256, 512), fps, preview, CRF_BENCHMARK)
    for t in range(T if not limit else min(T, limit)):
        plan = plans[chunk[t], offset[t]]
        if plan.shape[-1] == 1:   # Atari plans are grayscale
            plan = np.repeat(plan, 3, axis=-1)
        plan = flash(resize(plan, 256, 256, nearest=True), offset[t] / fps, fade, border=3)
        out.write(np.concatenate([plan, executed[t]], 1), np.concatenate([plan, executed[t]], 0))
    out.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("which", nargs="*", help=", ".join(SHORT))
    ap.add_argument("--preview", metavar="DIR")
    args = ap.parse_args()
    names = [SHORT.get(w, w) for w in args.which] or list(SHORT.values())
    os.makedirs(args.preview or OUT_DIR, exist_ok=True)
    limit = 61 if args.preview else None
    for name in names:
        if name in MINECRAFT:
            minecraft(name, args.preview, limit)
        elif name in BENCHMARKS:
            benchmark(name, args.preview, limit)
        elif name == "gallery_findcave_training":
            findcave(args.preview, limit)
        else:
            raise SystemExit(f"unknown clip {name}")


if __name__ == "__main__":
    main()
