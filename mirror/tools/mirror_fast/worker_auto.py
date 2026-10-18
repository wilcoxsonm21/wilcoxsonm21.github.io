"""Make the Auto clips of the Diamond episode viewer: each episode fast-forwarded the way the page's survival clips are
(mirror/tools/build_survival.py), so Auto plays one ready-made video instead of switching copies live.

The pace is the survival clips': 1x from 3 s before to 1 s after the first time the agent gets, crafts or places each
thing (the episode's milestones, and the first completion of the "pick up crafting table" and "load furnace" subgoals),
2.5 s before to 1.5 s after each death up to the last of those, 6 s before to 4 s after the last, and the first 1.5 s;
32x otherwise, with the speed eased in and out in log space over 60 source frames outside the 1x stretches. Unlike a
survival clip, which ends 3 s after its last milestone, an Auto clip runs to the end of the episode. The clips are at
40 fps (1x shows each frame twice, 32x every 16th frame), as the survival clips are. The windows are the same as
SKIM/windows() in mirror/eval/watch.js.

For each episode: the execution alone ({folder}/raw_auto/NN.mp4), and where the episode has a plan, the plan beside
the execution ({folder}/side_auto) and above it ({folder}/stack_auto), the plan cut and lagged as worker_both.py does;
each also fragmented for streaming (frag/{folder}/{view}_auto/NN.mp4, as worker_frag.py); and {folder}/auto/NN.json,
the clip's time map: "map" is [clip frame, source frame] knots (linear between, within a frame of the real map),
"speed" the badge's label from each clip time on.

    python worker_auto.py ROOT [--threads N]        (a queue worker: ROOT/manifest_auto.json, claims in ROOT/state_auto)
    python worker_auto.py --one EP.json RAW [PLAN] --lag L --out DIR     (one episode from local files, for trying out)
ROOT/eval_data holds the viewer's eval/data; outputs go to ROOT/auto_out/<path in the dataset>.
"""
import argparse, json, os, shutil, socket, subprocess, sys, threading, time, uuid

import numpy as np

SOURCE = "hwryu/mirror_diamond_eval"
SRC_FPS, OUT_FPS = 20, 40
SLOW, FAST, RAMP = 1.0, 32.0, 60
SKIM = dict(before=3.0, after=1.0, death=(2.5, 1.5), last=(6.0, 4.0), open=1.5)
FIRSTS = ["pick_up_crafting_table", "load_furnace"]
PW, PH = 640, 360
STALE = 900


# ------------------------------------------------------------------ the pace (eval/watch.js windows, build_survival.py)
def windows(ep):
    ms, st = ep["milestones"], ep.get("stages") or []
    firsts = [t for m, t in ms.items() if not (m == "load_furnace" and t > ms.get("iron_ingot", float("inf")))]
    last = max(firsts) if firsts else float("inf")
    for key in FIRSTS:
        i = next((j for j, s in enumerate(st[:-1]) if s[1] == key), None)
        if i is not None and st[i + 1][0] <= last:
            firsts.append(st[i + 1][0])
    spans = [(0, SKIM["open"])] + [(t - SKIM["before"], t + SKIM["after"]) for t in firsts if t < last]
    spans += [(d["t"] - SKIM["death"][0], d["t"] + SKIM["death"][1]) for d in ep["deaths"] if d["t"] <= last]
    if last != float("inf"):
        spans.append((last - SKIM["last"][0], last + SKIM["last"][1]))
    out = []
    for a, b in sorted((max(0.0, a), b) for a, b in spans):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def speed_profile(n, wins):   # build_survival.py's, over the whole episode (its windows already open on the start)
    slow = np.zeros(n, bool)
    for a, b in wins:
        slow[max(0, int(a * SRC_FPS)):min(n, int(b * SRC_FPS))] = True
    logs = np.where(slow, np.log(SLOW), np.log(FAST))
    smooth = np.convolve(np.pad(logs, RAMP, mode="edge"), np.ones(RAMP) / RAMP, mode="same")[RAMP:-RAMP]
    return np.where(slow, SLOW, np.maximum(np.exp(smooth), SLOW))


def plan_frames(n, wins):
    speed = speed_profile(n, wins)
    out_time = np.concatenate([[0], np.cumsum(1.0 / (SRC_FPS * speed))])
    n_out = max(1, int(out_time[n] * OUT_FPS))
    targets = np.minimum(n - 1, np.searchsorted(out_time[1:], np.arange(n_out) / OUT_FPS, side="right"))
    return speed, targets


def simplify(pts, tol):
    """Douglas-Peucker on [(clip frame, source frame)]: the knots a linear map needs to stay within tol source frames."""
    keep, stack = {0, len(pts) - 1}, [(0, len(pts) - 1)]
    p = np.asarray(pts, float)
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        x, y = p[a + 1:b, 0], p[a + 1:b, 1]
        line = p[a, 1] + (p[b, 1] - p[a, 1]) * (x - p[a, 0]) / (p[b, 0] - p[a, 0])
        i = int(np.argmax(np.abs(y - line)))
        if abs(y[i] - line[i]) > tol:
            keep.add(a + 1 + i)
            stack += [(a, a + 1 + i), (a + 1 + i, b)]
    return [[int(p[i, 0]), int(p[i, 1])] for i in sorted(keep)]


def time_map(speed, targets):
    labels, last = [], None
    for i, j in enumerate(targets):
        lab = int(f"{speed[j]:.0f}") if speed[j] >= 1.5 else 1
        if lab != last:
            labels.append([round(i / OUT_FPS, 3), lab])
            last = lab
    return {"fps": OUT_FPS, "src_fps": SRC_FPS, "frames": int(len(targets)), "src_frames": int(len(speed)),
            "map": simplify(list(enumerate(targets.tolist())), 0.5), "speed": labels}


# ------------------------------------------------------------------ video
def ffprobe_frames(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                        "stream=nb_read_packets,r_frame_rate", "-of", "json", f], capture_output=True, text=True, check=True)
    s = json.loads(r.stdout)["streams"][0]
    assert s["r_frame_rate"] == f"{SRC_FPS}/1", (f, s)
    return int(s["nb_read_packets"])


def encoder(path, w, h, crf, threads):
    return subprocess.Popen(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo",
                             "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(OUT_FPS), "-i", "-", "-an", "-c:v", "libx264",
                             "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p", "-g", str(2 * OUT_FPS),
                             "-threads", str(threads), "-movflags", "+faststart", path], stdin=subprocess.PIPE)


def fragment(src, dest):   # worker_frag.py's remux: a fragment per keyframe, empty moov, a global sidx after it
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-c", "copy", "-an",
                    "-movflags", "+frag_keyframe+empty_moov+default_base_moof+global_sidx", dest], check=True)


def build(ep, raw, plan, lag, tmp, crf=23, threads=8):
    """Encode the episode's Auto clips into tmp; returns {view: path} and the time map."""
    n = ffprobe_frames(raw)
    speed, targets = plan_frames(n, windows(ep))
    need = np.zeros(n, np.int32)
    np.add.at(need, targets, 1)   # how many clip frames show each source frame
    if plan:
        lagf = f",tpad=start={lag}:start_mode=clone" if lag else ""
        graph = (f"[1:v]crop=320:191:320:20,scale={PW}:{PH},setsar=1{lagf}[p];[0:v]scale={PW}:{PH},setsar=1[e];"
                 f"[p][e]hstack=inputs=2,trim=end_frame={n}[o]")
        dec = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", str(threads), "-i", raw, "-i", plan,
               "-filter_complex", graph, "-map", "[o]"]
        W = 2 * PW
    else:
        dec = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", str(threads), "-i", raw,
               "-vf", f"scale={PW}:{PH},setsar=1,trim=end_frame={n}"]
        W = PW
    dec += ["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    paths = {"raw": os.path.join(tmp, "raw.mp4")}
    if plan:
        paths.update(side=os.path.join(tmp, "side.mp4"), stack=os.path.join(tmp, "stack.mp4"))
    encs = {"raw": encoder(paths["raw"], PW, PH, crf, threads)}
    if plan:
        encs["side"] = encoder(paths["side"], 2 * PW, PH, crf, threads)
        encs["stack"] = encoder(paths["stack"], PW, 2 * PH, crf, threads)
    p = subprocess.Popen(dec, stdout=subprocess.PIPE, bufsize=0)
    size = W * PH * 3
    buf = bytearray(size)
    got = 0
    for j in range(n):
        view = memoryview(buf)
        k = 0
        while k < size:
            r = p.stdout.readinto(view[k:])
            if not r:
                break
            k += r
        if k < size:
            break
        got += 1
        if not need[j]:
            continue
        fr = np.frombuffer(buf, np.uint8).reshape(PH, W, 3)
        outs = {"raw": fr[:, -PW:]}
        if plan:
            outs["side"], outs["stack"] = fr, np.concatenate([fr[:, :PW], fr[:, PW:]], 0)
        for v, e in encs.items():
            data = np.ascontiguousarray(outs[v]).tobytes()
            for _ in range(need[j]):
                e.stdin.write(data)
    p.stdout.close()
    assert p.wait() == 0 and got == n, ("decode", got, n)
    for e in encs.values():
        e.stdin.close()
        assert e.wait() == 0
    for v, f in paths.items():
        assert ffprobe_frames_any(f) == len(targets), (v, ffprobe_frames_any(f), len(targets))
    return paths, time_map(speed, targets)


def ffprobe_frames_any(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                        "stream=nb_read_packets", "-of", "csv=p=0", f], capture_output=True, text=True, check=True)
    return int(r.stdout.strip())


def place(paths, tmap, folder, name, out_dir):
    """Into out_dir at their paths in the dataset (the .json last, so a map means its clips are in)."""
    stem = os.path.splitext(name)[0]
    sizes = {}
    for v, f in paths.items():
        for dest, src in [(os.path.join(out_dir, folder, f"{v}_auto", name), f),
                          (os.path.join(out_dir, "frag", folder, f"{v}_auto", name), None)]:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if src is None:
                fragment(f, dest + ".part.mp4")
                os.replace(dest + ".part.mp4", dest)
            else:
                shutil.copyfile(src, dest + ".part")
                os.replace(dest + ".part", dest)
            sizes[os.path.relpath(dest, out_dir)] = os.path.getsize(dest)
    dest = os.path.join(out_dir, folder, "auto", stem + ".json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest + ".part", "w") as h:
        json.dump(tmap, h, separators=(",", ":"))
    os.replace(dest + ".part", dest)
    return sizes


# ------------------------------------------------------------------ one episode from local files
def one(args):
    ep = json.load(open(args.one[0]))
    tmp = os.path.join(args.out, "tmp")
    os.makedirs(tmp, exist_ok=True)
    t0 = time.time()
    paths, tmap = build(ep, args.one[1], args.one[2] if len(args.one) > 2 else None, args.lag, tmp, args.crf, args.threads)
    sizes = place(paths, tmap, args.folder, args.name, args.out)
    shutil.rmtree(tmp)
    print(json.dumps({"seconds": round(time.time() - t0, 1), "clip_s": tmap["frames"] / OUT_FPS, "sizes": sizes}))


# ------------------------------------------------------------------ queue worker (as worker_both.py)
def worker(args):
    root = args.root
    manifest = json.load(open(os.path.join(root, "manifest_auto.json")))
    state_dir, out_dir = os.path.join(root, "state_auto"), os.path.join(root, "auto_out")
    os.makedirs(state_dir, exist_ok=True)
    me = f"{socket.gethostname()}:{os.environ.get('SLURM_JOB_ID', os.getpid())}"

    def free(d):
        try:
            st = os.statvfs(d)
            return st.f_bavail * st.f_frsize
        except OSError:
            return -1

    base = max(["/dev/shm", "/tmp", os.environ.get("TMPDIR", "/tmp")], key=free)
    scratch = os.path.join(base, f"mirror_auto_{uuid.uuid4().hex[:8]}")
    os.makedirs(scratch, exist_ok=True)
    os.environ.setdefault("HF_HOME", os.path.join(scratch, "hf"))
    from huggingface_hub import hf_hub_download

    def claim(key):
        c = os.path.join(state_dir, key + ".claim")
        try:
            os.mkdir(c)
            return c
        except FileExistsError:
            pass
        try:
            if time.time() - os.stat(c).st_mtime < STALE:
                return None
            os.rename(c, f"{c}.stale.{uuid.uuid4().hex[:6]}")   # atomic: only one taker wins
            os.mkdir(c)
            print(f"[{me}] took over stale claim {key}", flush=True)
            return c
        except OSError:
            return None

    def heartbeat(c, stop):
        while not stop.wait(30):
            try:
                os.utime(c)
            except OSError:
                pass

    done_count, failures = 0, 0
    try:
        for item in manifest["items"]:
            if failures >= 3:
                print(f"[{me}] {failures} failures in a row, leaving the rest to other workers", flush=True)
                break
            folder, name, tab = item["folder"], item["n"], item["tab"]
            key = f"{folder}__{name}"
            done = os.path.join(state_dir, key + ".done")
            if os.path.exists(done):
                continue
            c = claim(key)
            if c is None:
                continue
            if free(scratch) < 2 * item["size"] + 3e9:
                print(f"[{me}] not enough room in {base} for {key}, leaving it", flush=True)
                os.rmdir(c)
                continue
            stop = threading.Event()
            threading.Thread(target=heartbeat, args=(c, stop), daemon=True).start()
            try:
                t0 = time.time()
                dl = os.path.join(scratch, "dl")
                raw = hf_hub_download(SOURCE, f"{folder}/raw/{name}", repo_type="dataset", revision=manifest["revision"], local_dir=dl)
                plan = hf_hub_download(SOURCE, f"{folder}/plan_idm/{name}", repo_type="dataset", revision=manifest["revision"],
                                       local_dir=dl) if item["plan"] else None
                t1 = time.time()
                ep = json.load(open(os.path.join(root, "eval_data", tab, os.path.splitext(name)[0] + ".json")))
                tmp = os.path.join(scratch, "enc")
                os.makedirs(tmp, exist_ok=True)
                paths, tmap = build(ep, raw, plan, item["lag"], tmp, args.crf, args.threads)
                t2 = time.time()
                sizes = place(paths, tmap, folder, name, out_dir)
                info = {"item": item, "clip_s": tmap["frames"] / OUT_FPS, "sizes": sizes, "t_download": round(t1 - t0, 1),
                        "t_encode": round(t2 - t1, 1), "host": me}
                with open(done + ".part", "w") as f:
                    json.dump(info, f)
                os.replace(done + ".part", done)
                print(f"[{me}] done {key} {info}", flush=True)
                done_count += 1
                failures = 0
            except Exception as e:  # free the claim so another worker retries it
                print(f"[{me}] FAILED {key}: {e!r}", file=sys.stderr, flush=True)
                os.rename(c, f"{c}.failed.{uuid.uuid4().hex[:6]}")
                failures += 1
            finally:
                stop.set()
                shutil.rmtree(os.path.join(scratch, "dl"), ignore_errors=True)
                shutil.rmtree(os.path.join(scratch, "enc"), ignore_errors=True)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    print(f"[{me}] finished, {done_count} episodes", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?")
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--crf", type=int, default=23)
    ap.add_argument("--one", nargs="+")
    ap.add_argument("--lag", type=int, default=1)
    ap.add_argument("--out")
    ap.add_argument("--folder", default="active_idm")
    ap.add_argument("--name", default="02.mp4")
    a = ap.parse_args()
    one(a) if a.one else worker(a)
