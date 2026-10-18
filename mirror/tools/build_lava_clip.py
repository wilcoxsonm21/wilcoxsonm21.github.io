#!/usr/bin/env python3
"""Builds the in-context learning figure's opening clip: the lava escape episode (six lives, the last one escapes) as
the agent saw it, fast-forwarded STEP times (every STEP-th frame at the recording's 20 fps), with the keys box taken
out as in the gallery (tools/build_gallery.py). js/lava.js plays it over media/lava_challenge.jpg in the figure's first
step; its length there is CLIP_DUR in js/lava.js, which must match the clip this writes.

Source: lava_pov.mp4 and lava_actions.jsonl in ~/mirror_talk/source_videos/gallery (see tools/build_gallery.py).

  ~/miniconda3/envs/supe/bin/python mirror/tools/build_lava_clip.py
"""
import os
import subprocess

from build_gallery import FFMPEG, SRC_DIR, SITE, frames, key_tokens, unkey

STEP = 3
FPS = 20
CRF = 26
OUT = os.path.join(SITE, "media", "lava_escape.mp4")


def main():
    pov = os.path.join(SRC_DIR, "lava_pov.mp4")
    clean = list(frames(pov))
    keys = key_tokens(os.path.join(SRC_DIR, "lava_actions.jsonl"), len(clean))
    # (every STEP-th frame, and always the last, where the agent is out of the lava)
    pick = list(range(0, len(clean), STEP))
    if pick[-1] != len(clean) - 1:
        pick.append(len(clean) - 1)
    h, w = clean[0].shape[:2]
    enc = subprocess.Popen([
        FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(FPS),
        "-i", "-", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", str(CRF), "-pix_fmt", "yuv420p",
        "-g", str(FPS * 2), "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)
    for i in pick:
        enc.stdin.write(unkey(clean[i], keys[i]).tobytes())
    enc.stdin.close()
    enc.wait()
    print(f"{OUT}: {len(pick)} frames, {len(pick) / FPS:.2f} s, {os.path.getsize(OUT) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
