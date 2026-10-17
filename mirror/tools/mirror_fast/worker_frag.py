"""Fragment the website's episode videos for streaming piece by piece (FragStream in js/watch-player.js), and
keep them in ROOT/frag_out for upload_frag.py to send to frag/ in the website's video dataset.

Every video the viewers play is remuxed (no re-encoding) into a fragmented MP4: a fragment at each keyframe (two
seconds apart or less), the moov empty, and a global sidx index of the fragments right after it, so the whole header
is a few kilobytes. The 1x executions come from hwryu/mirror_diamond_eval; the 4x and 16x copies and the plan-and-
execution videos from ROOT/out (worker.py, worker_both.py). Workers take items off a shared queue (mkdir claims, as
worker.py), build each video on node-local disk and copy it to ROOT/frag_out; an item is done once it is there. (Each
worker committing its own uploads ran into the hub's limit on commits per repo, so one uploader per run sends them.)

    python worker_frag.py ROOT
ROOT holds manifest_frag.json ({"revision", "items": [{"src", "dest", "size"}]}); claims go to ROOT/state_frag.
"""
import argparse, json, os, shutil, socket, struct, subprocess, sys, threading, time, uuid

SOURCE = "hwryu/mirror_diamond_eval"
STALE = 900

ap = argparse.ArgumentParser()
ap.add_argument("root")
args = ap.parse_args()
root = args.root
manifest = json.load(open(os.path.join(root, "manifest_frag.json")))
state_dir = os.path.join(root, "state_frag")
os.makedirs(state_dir, exist_ok=True)
me = f"{socket.gethostname()}:{os.environ.get('SLURM_JOB_ID', os.getpid())}"


def free(d):
    try:
        st = os.statvfs(d)
        return st.f_bavail * st.f_frsize
    except OSError:
        return -1


base = max(["/dev/shm", "/tmp", os.environ.get("TMPDIR", "/tmp")], key=free)
scratch = os.path.join(base, f"mirror_frag_{uuid.uuid4().hex[:8]}")
stage = os.path.join(scratch, "stage")
os.makedirs(stage, exist_ok=True)
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
        os.rename(c, f"{c}.stale.{uuid.uuid4().hex[:6]}")
        os.mkdir(c)
        return c
    except OSError:
        return None


def heartbeat(claims, stop):
    while not stop.wait(30):
        for c in list(claims):
            try:
                os.utime(c)
            except OSError:
                pass


def top_boxes(path, limit=4):
    out, size = [], os.path.getsize(path)
    with open(path, "rb") as h:
        off = 0
        while off < size and len(out) < limit:
            h.seek(off)
            n, t = struct.unpack(">I4s", h.read(8))
            if n == 1:
                n = struct.unpack(">Q", h.read(8))[0]
            out.append(t.decode())
            off += n
    return out


def fragment(item):
    src = item["src"]
    if src.startswith("hub:"):
        local = hf_hub_download(SOURCE, src[4:], repo_type="dataset", revision=manifest["revision"],
                                local_dir=os.path.join(scratch, "dl"))
    else:
        local = os.path.join(root, src)
    dest = os.path.join(stage, item["dest"])
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", local, "-c", "copy", "-an",
                    "-movflags", "+frag_keyframe+empty_moov+default_base_moof+global_sidx", dest], check=True)
    boxes = top_boxes(dest)
    assert boxes[:3] == ["ftyp", "moov", "sidx"], (item, boxes)
    ratio = os.path.getsize(dest) / os.path.getsize(local)
    assert 0.98 < ratio < 1.05, (item, ratio)
    if src.startswith("hub:"):
        os.remove(local)
    return dest


claims = {}   # key -> claim dir
stop = threading.Event()
threading.Thread(target=heartbeat, args=(claims.values(), stop), daemon=True).start()


def keep(item, path):
    """Copy a finished video to ROOT/frag_out/FOLDER/DEST (FOLDER is its run, so each run uploads on its own)."""
    out = os.path.join(root, "frag_out", item["dest"].split("/")[1], item["dest"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    shutil.copyfile(path, out + ".part")
    os.replace(out + ".part", out)
    os.remove(path)


done_count, failures = 0, 0
try:
    for item in manifest["items"]:
        if failures >= 3:
            break
        key = item["dest"].replace("/", "__")
        if os.path.exists(os.path.join(state_dir, key + ".done")):
            continue
        c = claim(key)
        if c is None:
            continue
        claims[key] = c
        try:
            keep(item, fragment(item))
            with open(os.path.join(state_dir, key + ".done"), "w") as f:
                json.dump(item, f)
            done_count += 1
            failures = 0
        except Exception as e:
            print(f"[{me}] FAILED {item['dest']}: {e!r}", file=sys.stderr, flush=True)
            os.rename(c, f"{c}.failed.{uuid.uuid4().hex[:6]}")
            failures += 1
            shutil.rmtree(os.path.join(scratch, "dl"), ignore_errors=True)
        claims.pop(key, None)
finally:
    stop.set()
    shutil.rmtree(scratch, ignore_errors=True)
print(f"[{me}] finished, {done_count} videos", flush=True)
