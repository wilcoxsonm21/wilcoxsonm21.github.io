"""Builds the survival section's two diamond episodes: video plan | execution, milestone-paced.

Each episode is the fastest to its tab's furthest milestone in the episode viewer (eval/): Online (Generative VP, the
self-improving V2A model) episode 3 (index 2), an iron pickaxe at 6:34 with no deaths (no Online episode gets a diamond),
and Oracle VP episode 52 (index 51), a diamond at 17:15 after one death.
Both clips hold only game pixels: the plan on the left and the execution on the right at 640x360 each (and a stacked
version, plan above execution, for phones held upright), with green flashes on the plan where it re-syncs to the real
observation. Every label (the goal, the speed, the milestones) is drawn by the page over the clip from
js/survival-data.js, so text is as sharp as the screen.

Playback is 1x around the first time the agent gets, crafts or places each thing (from the episode's own event log,
eval/data/<tab>/<n>.json, the same one the viewer reads), and up to 32x otherwise, with log-space ramps outside the 1x
windows, as the earlier iron-ingot and oracle-diamond videos were. Repeats (after the oracle episode's death the agent
rebuilds everything) stay fast.

Sources (kept off the site, in SRC_DIR):
  online02_raw.mp4, online02_plan_idm.mp4         huggingface.co/datasets/hwryu/mirror_diamond_eval:
                                                  active_idm/raw/02.mp4, active_idm/plan_idm/02.mp4
  oracle51_pov.mp4, oracle51_vp_plan.mp4          the first 1045 s of pov.mp4 and vp_plan.mp4 in
      /data/scene-rep/vpt/mine_diamonds_results/idm_step576512_mask50_markov_128episodes_60min/sampled_execute8/
      episode_00051/ (the cluster; the dataset has no oracle plan video)

  python3 mirror/tools/build_survival.py               # both episodes
  python3 mirror/tools/build_survival.py oracle --sheet # contact sheet of the 1x windows, no encode
"""
import argparse
import json
import os
import subprocess

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
SRC_DIR = os.path.expanduser("~/mirror_talk/source_videos/survival")
OUT_DIR = os.path.join(SITE, "media", "survival")
POSTERS = os.path.join(SITE, "media", "posters")
DATA_JS = os.path.join(SITE, "js", "survival-data.js")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

SRC_FPS, OUT_FPS = 20, 40   # 1x shows every source frame twice, so 32x still shows every 16th
PW, PH = 640, 360           # one pane
SLOW, FAST = 1.0, 32.0
RAMP = 60                   # source frames for each speed transition
BEFORE, AFTER = 3.0, 1.0    # the 1x window around a first-time event (s)
GREEN = np.array([30, 255, 83], np.float32)

EPISODES = {
    "generated": dict(
        tab="online", n=2, exec="online02_raw.mp4", plan="online02_plan_idm.mp4", final="iron_pickaxe",
        plan_box=(320, 20, 640, 211),   # the debug render's plan panel (320x191, the 16:9 view squashed), upscaled
        plan_lag=1,                      # the panel video starts one frame after the recording (eval.js PLAN_LAG)
        resync=(8, 1),                   # a new plan every 8 frames, at composite frames 1, 9, 17, ...
        firsts=["pick_up_crafting_table", "load_furnace"],   # first completions of these subgoals, from the stages
        name="survival_iron_pickaxe_generated"),
    "oracle": dict(
        tab="oracle", n=51, exec="oracle51_pov.mp4", plan="oracle51_vp_plan.mp4",
        final="diamond", plan_box=None, plan_lag=0, resync=(8, 1), firsts=[],
        name="survival_diamond_oracle"),
}
NAMES = {
    "log": "log", "planks": "planks", "stick": "sticks", "crafting_table": "crafting table",
    "place_crafting_table": "placed the crafting table", "wooden_pickaxe": "wooden pickaxe",
    "cobblestone": "cobblestone", "stone_pickaxe": "stone pickaxe", "furnace": "furnace", "iron_ore": "iron ore",
    "place_furnace": "placed the furnace", "load_furnace": "loaded the furnace", "iron_ingot": "iron ingot",
    "iron_pickaxe": "iron pickaxe", "diamond": "diamond", "pick_up_crafting_table": "picked up the crafting table",
}
GOALS = dict(NAMES, stick="sticks", place_crafting_table="place the crafting table", place_furnace="place the furnace",
             load_furnace="load the furnace", pick_up_crafting_table="pick up the crafting table")
ICONS = {"place_crafting_table": "crafting_table", "pick_up_crafting_table": "crafting_table",
         "place_furnace": "furnace", "load_furnace": "furnace"}
PAPER = ["log", "planks", "stick", "crafting_table", "wooden_pickaxe", "cobblestone", "stone_pickaxe", "furnace",
         "iron_ore", "iron_ingot", "iron_pickaxe", "diamond"]


def events_of(ep):
    """First-time events (t, key) and deaths up to the episode's final milestone, from the viewer's event log."""
    d = json.load(open(os.path.join(SITE, "eval", "data", ep["tab"], f"{ep['n']:02d}.json")))
    ms = d["milestones"]
    end = ms[ep["final"]]
    ev = [(t, k) for k, t in ms.items() if t <= end]
    if "load_furnace" in ms and ms["load_furnace"] > ms.get("iron_ingot", 1e9):
        ev.remove((ms["load_furnace"], "load_furnace"))   # a later reload: the first load is a stage completion below
    stages = d.get("stages") or []
    for key in ep["firsts"]:
        done = next((stages[i + 1][0] for i in range(len(stages) - 1) if stages[i][1] == key), None)
        if done is not None and done <= end:
            ev.append((done, key))
    deaths = [x["t"] for x in d["deaths"] if x["t"] <= end]
    goals = [(t, g) for t, g, _ in stages if t <= end]
    return sorted(ev), deaths, goals, end


def speed_profile(n, windows):
    slow = np.zeros(n, bool)
    for a, b in windows:
        slow[max(0, int(a * SRC_FPS)):min(n, int(b * SRC_FPS))] = True
    slow[: int(1.5 * SRC_FPS)] = True   # open on the start
    logs = np.where(slow, np.log(SLOW), np.log(FAST))
    smooth = np.convolve(np.pad(logs, RAMP, mode="edge"), np.ones(RAMP) / RAMP, mode="same")[RAMP:-RAMP]
    return np.where(slow, SLOW, np.maximum(np.exp(smooth), SLOW))   # the windows stay at 1x; ramps sit outside


def pulse(plan, age, weight, period):
    """A green border that fades over a few frames after each re-sync; weight fades it out when fast-forwarding."""
    if age >= 6 or weight <= 0:
        return plan
    out = plan.astype(np.float32)
    a, b = weight * (1 - age / 6) ** 1.5, 6
    for sl in (np.s_[:b], np.s_[-b:], np.s_[b:-b, :b], np.s_[b:-b, -b:]):
        out[sl] = out[sl] * (1 - a) + GREEN * a
    return np.rint(out).astype(np.uint8)


def frames(path):
    reader = imageio_ffmpeg.read_frames(os.path.join(SRC_DIR, path))
    meta = next(reader)
    w, h = meta["size"]
    for b in reader:
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)


def plan_pane(frame, box):
    if box is None:
        return frame
    return np.asarray(Image.fromarray(frame[box[1]:box[3], box[0]:box[2]]).resize((PW, PH), Image.LANCZOS))


def encoder(path, w, h):
    return subprocess.Popen([
        FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
        "-r", str(OUT_FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-tune", "film",
        "-pix_fmt", "yuv420p", "-g", str(OUT_FPS * 2), "-movflags", "+faststart", path], stdin=subprocess.PIPE)


def build(key, sheet=False):
    ep = EPISODES[key]
    ev, deaths, goals, t_end = events_of(ep)
    windows = [(t - BEFORE, t + AFTER) for t, k in ev if k != ep["final"]]
    windows += [(t - 2.5, t + 1.5) for t in deaths]
    windows.append((t_end - 6, t_end + 4))
    end = int((t_end + 3) * SRC_FPS)
    speed = speed_profile(end + 1, windows)
    out_time = np.concatenate([[0], np.cumsum(1.0 / (SRC_FPS * speed))])
    n_out = int(out_time[end] * OUT_FPS)
    targets = np.searchsorted(out_time[1:], np.arange(n_out) / OUT_FPS, side="right")
    want = {int(f * SRC_FPS) for w in windows for f in (w[0], (w[0] + w[1]) / 2, w[1] - .05)} if sheet else None

    period, phase = ep["resync"]
    os.makedirs(OUT_DIR, exist_ok=True)
    land = port = None
    if not sheet:
        land = encoder(os.path.join(OUT_DIR, ep["name"] + ".mp4"), 2 * PW, PH)
        port = encoder(os.path.join(OUT_DIR, ep["name"] + "_portrait.mp4"), PW, 2 * PH)
    shots, k, last_plan, read = [], 0, None, -1
    plans = frames(ep["plan"])
    for j, ex in enumerate(frames(ep["exec"])):
        if j > end or (not sheet and k >= n_out):
            break
        while read < max(0, j - ep["plan_lag"]):   # the plan frame shown with execution frame j
            try:
                last_plan, read = next(plans), read + 1
            except StopIteration:
                break
        if sheet:
            if j in want:
                shots.append((j, np.concatenate([plan_pane(last_plan, ep["plan_box"]), ex], 1)))
            continue
        if targets[k] != j:
            continue
        weight = float(np.clip((4.0 - speed[j]) / 2.0, 0, 1))
        plan = pulse(plan_pane(last_plan, ep["plan_box"]), (j - phase) % period if j >= phase else period, weight,
                     period)
        lw = np.concatenate([plan, ex], 1).tobytes()
        pt = np.concatenate([plan, ex], 0).tobytes()
        while k < n_out and targets[k] == j:
            land.stdin.write(lw)
            port.stdin.write(pt)
            k += 1
    if sheet:
        cols = 3
        rows = (len(shots) + cols - 1) // cols
        s = Image.new("RGB", (cols * PW, rows * (PH // 2 + 18)), "black")
        d = ImageDraw.Draw(s)
        for i, (j, im) in enumerate(shots):
            x, y = (i % cols) * PW, (i // cols) * (PH // 2 + 18)
            s.paste(Image.fromarray(im).resize((PW, PH // 2)), (x, y + 18))
            d.text((x + 4, y + 2), f"{j / SRC_FPS:.2f}s", fill="white",
                   font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13))
        path = os.path.join("/tmp", f"survival_{key}_sheet.png")
        s.save(path)
        print(path)
        return None
    for p in (land, port):
        p.stdin.close()
        p.wait()
    for suffix in ("", "_portrait"):
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", os.path.join(OUT_DIR, ep["name"] + suffix + ".mp4"),
                        "-frames:v", "1", "-q:v", "3", os.path.join(POSTERS, ep["name"] + suffix + ".jpg")], check=True)

    o = lambda t: round(float(out_time[min(end, int(round(t * SRC_FPS)))]), 3)
    # the speed badge: its label at each change, over the output frames
    labels, last = [], None
    for i in range(n_out):
        s = speed[targets[i]]
        lab = f"{s:.0f}" if s >= 1.5 else "1"
        if lab != last:
            labels.append([round(i / OUT_FPS, 3), int(lab)])
            last = lab
    firsts = [{"t": o(t), "src": round(t, 2), "key": k, "label": NAMES.get(k, k.replace("_", " ")),
               "icon": ICONS.get(k, k)} for t, k in ev]
    data = {
        "episode": f"{ep['tab']}/{ep['n']}", "final": ep["final"], "duration": round(n_out / OUT_FPS, 3), "src_end": round(t_end, 2),
        "events": firsts, "deaths": [{"t": o(t), "src": round(t, 2)} for t in deaths],
        "goals": [[o(t), GOALS.get(g, g.replace("_", " "))] for t, g in goals],
        "milestones": [[k, o(t)] for t, k in ev if k in PAPER],
        "speed": labels,
        # the game clock: the source time at every quarter second of the clip
        "clock": [[round(i / OUT_FPS, 3), round(targets[i] / SRC_FPS, 2)] for i in range(0, n_out, OUT_FPS // 4)],
    }
    print(ep["name"], data["duration"], "s")
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("which", nargs="*", default=list(EPISODES))
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()
    old = {}
    if os.path.exists(DATA_JS):
        txt = open(DATA_JS).read()
        old = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    for key in args.which:
        d = build(key, args.sheet)
        if d:
            old[key] = d
    if not args.sheet:
        with open(DATA_JS, "w") as f:
            f.write("// Generated by tools/build_survival.py from the episodes' event logs (eval/data). Do not edit.\n")
            f.write("window.SURVIVAL = " + json.dumps(old, separators=(",", ":")) + ";\n")


if __name__ == "__main__":
    main()
