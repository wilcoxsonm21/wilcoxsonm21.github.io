#!/usr/bin/env python3
"""Cut one still per evaluation episode for the episode grids: eval/thumbs/<tab>/<nn>.webp and
basalt/thumbs/<task>/<version>/<nn>.webp (448x252, the clips' 16:9).

Which moment: a Diamond episode shows the diamond if it got one, else the furthest block it mined (iron ore,
stone or a log; a moment too dark to read falls back to the next); a FindCave success shows the
cave it entered, a MakeWaterfall episode the view it ended on, and anything else the brightest of a few moments. A still
that is still dark (an unlit cave) is brightened with a gamma curve.

    python3 mirror/tools/build_thumbs.py                  # all, skipping stills that exist
    python3 mirror/tools/build_thumbs.py --only basalt --force
    python3 mirror/tools/build_thumbs.py --ffmpeg /path/to/ffmpeg --base http://127.0.0.1:5590   # through a proxy
"""
import argparse, io, json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://huggingface.co/datasets/hwryu/mirror_diamond_eval/resolve/main"
SIZE = (448, 252)
PAPER = ["log", "planks", "stick", "crafting_table", "wooden_pickaxe", "cobblestone", "stone_pickaxe", "furnace",
         "iron_ore", "iron_ingot", "iron_pickaxe", "diamond"]
MINED = ["iron_ore", "cobblestone", "log"]   # milestones reached in the world, the furthest first
DARK = 42   # mean luma (0-255) below which a still reads as a black tile
LIFT = 78   # the mean luma a dark still is brightened to (lift())


def grab(args, url, t):
    out = subprocess.run([args.ffmpeg, "-v", "error", "-ss", f"{max(0.0, t):.2f}", "-i", url, "-frames:v", "1",
                          "-vf", f"scale={SIZE[0]}:{SIZE[1]}:flags=lanczos", "-f", "image2pipe", "-c:v", "png", "-"],
                         capture_output=True, timeout=120)
    if out.returncode or not out.stdout:
        return None
    return Image.open(io.BytesIO(out.stdout)).convert("RGB")


def luma(image):
    return ImageStat.Stat(image.convert("L")).mean[0]


def pick(args, url, moments):
    """moments: times in order of preference; the first bright enough wins, else the brightest."""
    best = None
    for t in moments:
        image = grab(args, url, t)
        if image is None:
            continue
        if luma(image) >= DARK:
            return image
        if best is None or luma(image) > luma(best):
            best = image
    return best


def lift(image, target=LIFT):
    """A still darker than the target is brightened with a gamma curve (blacks stay black) until its mean luma reaches
    the target: most diamonds are mined in unlit caves, which read as black tiles in a grid. The videos are untouched."""
    if luma(image) >= target:
        return image
    low, high = 1.0, 3.0
    for _ in range(14):
        gamma = (low + high) / 2
        table = [round(255 * (i / 255) ** (1 / gamma)) for i in range(256)]
        if luma(image.point(table * 3)) < target:
            low = gamma
        else:
            high = gamma
    table = [round(255 * (i / 255) ** (1 / high)) for i in range(256)]
    return image.point(table * 3)


def save(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    lift(image).save(path, "WEBP", quality=74, method=6)


def diamond_jobs():
    index = json.loads((ROOT / "eval/data/index.json").read_text())
    for tab, arm in index.items():
        for summary in arm["episodes"]:
            n = summary["n"]
            yield (f"eval {tab}/{n:02d}", ROOT / f"eval/thumbs/{tab}/{n:02d}.webp",
                   f"{arm['folder']}/raw/{n:02d}.mp4", lambda tab=tab, n=n, seconds=summary["seconds"]: diamond_moments(tab, n, seconds))


def diamond_moments(tab, n, seconds):
    episode = json.loads((ROOT / f"eval/data/{tab}/{n:02d}.json").read_text())
    milestones = episode["milestones"]
    if "diamond" in milestones:
        return [milestones["diamond"] - 0.4]   # the ore as it breaks, however dark the cave
    # the furthest block it mined, as it breaks: the crafted milestones are moments in a crafting screen, which would
    # make every still the same grey window
    moments = [milestones[m] - 0.6 for m in MINED if m in milestones]
    return moments + [seconds * f for f in (0.5, 0.25, 0.75)]


def basalt_jobs():
    index = json.loads((ROOT / "basalt/data/index.json").read_text())
    for task, versions in index.items():
        for version, arm in versions.items():
            for e in arm["episodes"]:
                n = e["n"]
                yield (f"basalt {task}/{version}/{n:02d}", ROOT / f"basalt/thumbs/{task}/{version}/{n:02d}.webp",
                       f"{arm['folder']}/raw/{n:02d}.mp4", lambda e=e: basalt_moments(e))


def basalt_moments(e):
    if e.get("end") is not None:                       # MakeWaterfall: the view it ended on
        return [e["end"] - 1.0, e["end"] * 0.8]
    if e.get("success_time") is not None:              # FindCave: inside the cave
        return [e["success_time"] + 1.0, e["success_time"]]
    return [e["seconds"] * f for f in (0.6, 0.4, 0.8, 0.2)]


def run(args, job):
    name, path, video, moments = job
    if path.exists() and not args.force:
        return name, "kept"
    image = pick(args, f"{args.base}/{video}", moments())
    if image is None:
        return name, "FAILED"
    save(image, path)
    return name, f"{path.stat().st_size // 1024} KB"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", choices=["eval", "basalt"])
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--jobs", type=int, default=16)
    args = parser.parse_args()
    jobs = [*([] if args.only == "basalt" else diamond_jobs()), *([] if args.only == "eval" else basalt_jobs())]
    failed = 0
    with ThreadPoolExecutor(args.jobs) as pool:
        for name, result in pool.map(lambda job: run(args, job), jobs):
            failed += result == "FAILED"
            print(f"{name}: {result}", flush=True)
    print(f"{len(jobs)} stills, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
