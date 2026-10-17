"""One shard of the upload of ROOT/out to the website's video dataset: the files not on the hub yet whose index in the
sorted list falls to this shard, in commits of up to BATCH files. When it is done it waits for every combined video and
sends its share of whatever is new.

    python shard_upload.py ROOT SHARD NSHARDS
"""
import os, sys, time
from huggingface_hub import HfApi

REPO = "mwilcoxson/selfimprovingvisiontoactionmodelswebsitevideos"
BATCH = 40
root, shard, nshards = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
out = os.path.join(root, "out")
api = HfApi()


def pending():
    have = set(api.list_repo_files(REPO, repo_type="dataset"))
    files = sorted(os.path.relpath(os.path.join(d, f), out) for d, _, fs in os.walk(out) if "/.cache" not in d + "/"
                   for f in fs if f.endswith(".mp4"))
    return [f for f in files if f not in have][shard::nshards]


def send(files):
    for i in range(0, len(files), BATCH):
        batch = files[i:i + BATCH]
        for attempt in range(8):
            try:
                api.upload_folder(repo_id=REPO, repo_type="dataset", folder_path=out, allow_patterns=batch,
                                  commit_message=f"Episode videos, shard {shard} ({len(batch)} files)")
                print(f"shard {shard}: sent {i + len(batch)}/{len(files)}", flush=True)
                break
            except Exception as e:   # a commit racing another shard's, or a hiccup: wait and try again
                print(f"shard {shard}: attempt {attempt} failed: {e!r}", flush=True)
                time.sleep(20 * (attempt + 1))
        else:
            raise SystemExit(f"shard {shard}: gave up on {batch[:3]}")


send(pending())
while sum(f.endswith(".done") for f in os.listdir(os.path.join(root, "state_both"))) < 275:
    time.sleep(60)
send(pending())
print(f"shard {shard}: finished", flush=True)
