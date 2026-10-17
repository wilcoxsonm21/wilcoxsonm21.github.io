"""Send one piece of the fragmented videos in ROOT/frag_out (from worker_frag.py) to frag/ in the website's video
dataset: piece INDEX of the sorted run/view folders (45 of them), as a single commit.

The hub allows 128 commits per repo per hour and 1000 API requests per 5 minutes per account. Workers committing
their own batches, and then upload_large_folder (which retries a refused commit at once, tens of thousands of times),
both ran into these. So each array task sends its folder as one commit and waits 10 minutes after a refusal; file
contents already uploaded are kept by the hub, so a retried commit sends no data again.

    python upload_frag.py ROOT INDEX
"""
import glob, os, sys, time
from huggingface_hub import HfApi

REPO = "mwilcoxson/selfimprovingvisiontoactionmodelswebsitevideos"
root, index = sys.argv[1], int(sys.argv[2])
out = os.path.join(root, "frag_out")
pieces = sorted(os.path.relpath(p, out) for p in glob.glob(os.path.join(out, "*", "frag", "*", "*")))
run, rel = pieces[index].split("/", 1)   # active_idm, frag/active_idm/raw_4x
n = len(glob.glob(os.path.join(out, run, rel, "*.mp4")))
for attempt in range(30):
    try:
        print(f"{rel}: sending {n} files (attempt {attempt})", flush=True)
        HfApi().upload_folder(repo_id=REPO, repo_type="dataset", folder_path=os.path.join(out, run),
                              allow_patterns=[f"{rel}/*.mp4"], commit_message=f"Fragmented episode videos: {rel} ({n} files)")
        print(f"{rel}: committed", flush=True)
        break
    except Exception as e:
        print(f"{rel}: attempt {attempt} failed: {str(e)[:400]!r}", flush=True)
        time.sleep(600)
else:
    raise SystemExit(f"{rel}: gave up")
