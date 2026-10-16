"""Make 4x and 16x copies of the Mirror episode videos (hwryu/mirror_diamond_eval) for the website's episode viewers.

Each worker takes the next unclaimed video from the manifest (largest first), downloads it to node-local storage, and
writes {folder}/{view}_4x/NN.mp4 and {folder}/{view}_16x/NN.mp4 under OUT. A k-times copy keeps every k-th frame at the
source's 20 fps, so its time t is the source's time k*t exactly. Claims are directories on the shared filesystem
(mkdir is atomic); a claim whose heartbeat stops for STALE seconds (a preempted job) is taken over.

    python worker.py ROOT [--threads N]
ROOT holds manifest.json; outputs go to ROOT/out, claims and done markers to ROOT/state.
"""
import argparse, json, os, shutil, socket, subprocess, sys, threading, time, uuid

SOURCE = "hwryu/mirror_diamond_eval"
SPEEDS = (4, 16)
FPS = 20
STALE = 600

ap = argparse.ArgumentParser()
ap.add_argument("root")
ap.add_argument("--threads", type=int, default=4)
ap.add_argument("--crf", type=int, default=23)
ap.add_argument("--max-files", type=int, default=0)
args = ap.parse_args()

root = args.root
manifest = json.load(open(os.path.join(root, "manifest.json")))
state_dir, out_dir = os.path.join(root, "state"), os.path.join(root, "out")
os.makedirs(state_dir, exist_ok=True)
me = f"{socket.gethostname()}:{os.environ.get('SLURM_JOB_ID', os.getpid())}"
# node-local room: whichever of these has the most free space (many workers can share a node's /dev/shm)
def free(d):
    try:
        st = os.statvfs(d)
        return st.f_bavail * st.f_frsize
    except OSError:
        return -1
base = max(["/dev/shm", "/tmp", os.environ.get("TMPDIR", "/tmp")], key=free)
scratch = os.path.join(base, f"mirror_fast_{uuid.uuid4().hex[:8]}")
os.makedirs(scratch, exist_ok=True)
os.environ.setdefault("HF_HOME", os.path.join(scratch, "hf"))

from huggingface_hub import hf_hub_download  # noqa: E402  (after HF_HOME)


def key(path):
    return path.replace("/", "__")


def outputs(path):
    folder, view, name = path.split("/")
    return {k: os.path.join(out_dir, folder, f"{view}_{k}x", name) for k in SPEEDS}


def claim(path):
    c = os.path.join(state_dir, key(path) + ".claim")
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
        print(f"[{me}] took over stale claim {path}", flush=True)
        return c
    except OSError:
        return None


def heartbeat(c, stop):
    while not stop.wait(30):
        try:
            os.utime(c)
        except OSError:
            pass


def probe_frames(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                        "stream=nb_read_packets,r_frame_rate", "-of", "json", f], capture_output=True, text=True, check=True)
    s = json.loads(r.stdout)["streams"][0]
    return int(s["nb_read_packets"]), s["r_frame_rate"]


def process(path):
    t0 = time.time()
    local = hf_hub_download(SOURCE, path, repo_type="dataset", revision=manifest["revision"],
                            local_dir=os.path.join(scratch, "dl"))
    t1 = time.time()
    n, rate = probe_frames(local)
    assert rate == f"{FPS}/1", (path, rate)
    outs = outputs(path)
    tmp = {k: os.path.join(scratch, f"{k}x.mp4") for k in SPEEDS}
    split = "".join(f"[s{k}]" for k in SPEEDS)
    chains = ";".join(f"[s{k}]select='not(mod(n\\,{k}))',setpts=N/({FPS}*TB)[o{k}]" for k in SPEEDS)
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-threads", str(args.threads), "-i", local,
           "-filter_complex", f"[0:v]split={len(SPEEDS)}{split};{chains}"]
    for k in SPEEDS:
        cmd += ["-map", f"[o{k}]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", str(args.crf), "-pix_fmt", "yuv420p",
                "-g", str(2 * FPS), "-r", str(FPS), "-threads", str(args.threads), "-movflags", "+faststart", tmp[k]]
    subprocess.run(cmd, check=True)
    t2 = time.time()
    sizes = {}
    for k in SPEEDS:
        got, _ = probe_frames(tmp[k])
        want = (n + k - 1) // k
        assert got == want, (path, k, got, want)
        os.makedirs(os.path.dirname(outs[k]), exist_ok=True)
        shutil.copyfile(tmp[k], outs[k] + ".part")
        os.replace(outs[k] + ".part", outs[k])
        sizes[k] = os.path.getsize(tmp[k])
        os.remove(tmp[k])
    os.remove(local)
    return {"path": path, "frames": n, "sizes": sizes,
            "t_download": round(t1 - t0, 1), "t_encode": round(t2 - t1, 1), "host": me}


done_count, failures = 0, 0
try:
    for item in manifest["files"]:
        if failures >= 3:
            print(f"[{me}] {failures} failures in a row, leaving the rest to other workers", flush=True)
            break
        path = item["path"]
        done = os.path.join(state_dir, key(path) + ".done")
        if os.path.exists(done):
            continue
        c = claim(path)
        if c is None:
            continue
        if free(scratch) < 2.5 * item["size"] + 2e9:   # the download plus both copies, with room to spare
            print(f"[{me}] not enough room in {base} for {path}, leaving it", flush=True)
            os.rmdir(c)
            continue
        stop = threading.Event()
        threading.Thread(target=heartbeat, args=(c, stop), daemon=True).start()
        try:
            info = process(path)
            info["src_bytes"] = item["size"]
            with open(done + ".part", "w") as f:
                json.dump(info, f)
            os.replace(done + ".part", done)
            print(f"[{me}] done {path} {info}", flush=True)
            done_count += 1
            failures = 0
        except Exception as e:  # leave the claim to go stale so another worker retries it
            print(f"[{me}] FAILED {path}: {e!r}", file=sys.stderr, flush=True)
            stop.set()
            os.rename(c, f"{c}.failed.{uuid.uuid4().hex[:6]}")
            failures += 1
            for f in os.listdir(scratch):
                if f.endswith(".mp4"):
                    os.remove(os.path.join(scratch, f))
            shutil.rmtree(os.path.join(scratch, "dl"), ignore_errors=True)
            continue
        stop.set()
        if args.max_files and done_count >= args.max_files:
            break
finally:
    shutil.rmtree(scratch, ignore_errors=True)
print(f"[{me}] finished, {done_count} videos", flush=True)
