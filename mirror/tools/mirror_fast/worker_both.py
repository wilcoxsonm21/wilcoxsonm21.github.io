"""Make the plan-and-execution videos of the Mirror episode viewers: one video holding both, so the two can never drift
apart, side by side (the desktop layout) and stacked plan over execution (a phone held upright), each at 1x, 4x and 16x.

The plan is the right half of the plan_idm video below its 20 px label row (x 320-640, y 20-211, as css/watch.css
crops it), stretched back to 640x360 beside or above the 640x360 execution. The Diamond plan is one frame behind the
execution (the recording starts one frame before the first executed step: PLAN_LAG in eval/watch.js), so frame n holds
execution frame n and plan frame n-1; BASALT's are aligned. A k-times copy keeps every k-th frame at 20 fps.

    python worker_both.py ROOT [--threads N]
ROOT holds manifest_both.json; outputs go to ROOT/out/{folder}/{side,stack}{,_4x,_16x}/NN.mp4, claims to ROOT/state_both.
"""
import argparse, json, os, shutil, socket, subprocess, sys, threading, time, uuid

SOURCE = "hwryu/mirror_diamond_eval"
LAYOUTS = {"side": "hstack", "stack": "vstack"}
SPEEDS = (1, 4, 16)
FPS = 20
STALE = 900

ap = argparse.ArgumentParser()
ap.add_argument("root")
ap.add_argument("--threads", type=int, default=8)
ap.add_argument("--crf", type=int, default=23)
args = ap.parse_args()

root = args.root
manifest = json.load(open(os.path.join(root, "manifest_both.json")))
state_dir, out_dir = os.path.join(root, "state_both"), os.path.join(root, "out")
os.makedirs(state_dir, exist_ok=True)
me = f"{socket.gethostname()}:{os.environ.get('SLURM_JOB_ID', os.getpid())}"


def free(d):
    try:
        st = os.statvfs(d)
        return st.f_bavail * st.f_frsize
    except OSError:
        return -1


base = max(["/dev/shm", "/tmp", os.environ.get("TMPDIR", "/tmp")], key=free)
scratch = os.path.join(base, f"mirror_both_{uuid.uuid4().hex[:8]}")
os.makedirs(scratch, exist_ok=True)
os.environ.setdefault("HF_HOME", os.path.join(scratch, "hf"))

from huggingface_hub import hf_hub_download  # noqa: E402  (after HF_HOME)


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


def frames(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                        "stream=nb_read_packets,r_frame_rate", "-of", "json", f], capture_output=True, text=True, check=True)
    s = json.loads(r.stdout)["streams"][0]
    assert s["r_frame_rate"] == f"{FPS}/1", (f, s)
    return int(s["nb_read_packets"])


def process(item):
    folder, name = item["folder"], item["n"]
    t0 = time.time()
    dl = os.path.join(scratch, "dl")
    ex = hf_hub_download(SOURCE, f"{folder}/raw/{name}", repo_type="dataset", revision=manifest["revision"], local_dir=dl)
    pl = hf_hub_download(SOURCE, f"{folder}/plan_idm/{name}", repo_type="dataset", revision=manifest["revision"], local_dir=dl)
    t1 = time.time()
    n = frames(ex)
    lag = f",tpad=start={item['lag']}:start_mode=clone" if item["lag"] else ""
    graph = [f"[1:v]crop=320:191:320:20,scale=640:360,setsar=1{lag}[p]", "[0:v]scale=640:360,setsar=1[e]", "[p]split=2[p0][p1]",
             "[e]split=2[e0][e1]"]
    outs, tmp = [], {}
    for i, (layout, stack) in enumerate(LAYOUTS.items()):
        graph.append(f"[p{i}][e{i}]{stack}=inputs=2,trim=end_frame={n},split={len(SPEEDS)}" + "".join(f"[{layout}{k}]" for k in SPEEDS))
        for k in SPEEDS:
            graph.append(f"[{layout}{k}]select='not(mod(n\\,{k}))',setpts=N/({FPS}*TB)[o{layout}{k}]")
            tmp[(layout, k)] = os.path.join(scratch, f"{layout}_{k}.mp4")
            outs += ["-map", f"[o{layout}{k}]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", str(args.crf),
                     "-pix_fmt", "yuv420p", "-g", str(2 * FPS), "-r", str(FPS), "-movflags", "+faststart", tmp[(layout, k)]]
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-threads", str(args.threads), "-i", ex, "-i", pl,
           "-filter_complex", ";".join(graph)] + outs
    subprocess.run(cmd, check=True)
    t2 = time.time()
    sizes = {}
    for (layout, k), f in tmp.items():
        got, want = frames(f), (n + k - 1) // k
        assert got == want, (folder, name, layout, k, got, want)
        dest = os.path.join(out_dir, folder, layout + ("" if k == 1 else f"_{k}x"), name)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(f, dest + ".part")
        os.replace(dest + ".part", dest)
        sizes[f"{layout}_{k}"] = os.path.getsize(f)
        os.remove(f)
    os.remove(ex)
    os.remove(pl)
    return {"item": item, "frames": n, "sizes": sizes, "t_download": round(t1 - t0, 1), "t_encode": round(t2 - t1, 1), "host": me}


done_count, failures = 0, 0
try:
    for item in manifest["items"]:
        if failures >= 3:
            print(f"[{me}] {failures} failures in a row, leaving the rest to other workers", flush=True)
            break
        key = f"{item['folder']}__{item['n']}"
        done = os.path.join(state_dir, key + ".done")
        if os.path.exists(done):
            continue
        c = claim(key)
        if c is None:
            continue
        if free(scratch) < 3 * item["size"] + 3e9:   # both downloads plus six copies, with room to spare
            print(f"[{me}] not enough room in {base} for {key}, leaving it", flush=True)
            os.rmdir(c)
            continue
        stop = threading.Event()
        threading.Thread(target=heartbeat, args=(c, stop), daemon=True).start()
        try:
            info = process(item)
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
            shutil.rmtree(os.path.join(scratch, "dl"), ignore_errors=True)
            for f in os.listdir(scratch):
                if f.endswith(".mp4"):
                    os.remove(os.path.join(scratch, f))
        finally:
            stop.set()
finally:
    shutil.rmtree(scratch, ignore_errors=True)
print(f"[{me}] finished, {done_count} episodes", flush=True)
