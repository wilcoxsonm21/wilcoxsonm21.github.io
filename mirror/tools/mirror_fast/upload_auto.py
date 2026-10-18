"""Send one folder of the Auto clips in ROOT/auto_out (from worker_auto.py) to the website's video dataset as a single
commit: piece INDEX of the sorted folders ({folder}/{raw,side,stack}_auto, frag/{folder}/{view}_auto, {folder}/auto).

The hub allows 128 commits per repo per hour and 1000 API requests per 5 minutes per account, so each array task sends
its folder as one commit and waits 10 minutes after a refusal (as upload_frag.py).

    python upload_auto.py ROOT INDEX        (python upload_auto.py ROOT list: the pieces and their file counts)
"""
import glob, os, sys, time
from huggingface_hub import HfApi

REPO = "mwilcoxson/selfimprovingvisiontoactionmodelswebsitevideos"
root, index = sys.argv[1], sys.argv[2]
out = os.path.join(root, "auto_out")
pieces = sorted({os.path.relpath(os.path.dirname(p), out) for p in glob.glob(os.path.join(out, "**", "*.*"), recursive=True)
                 if p.endswith((".mp4", ".json"))})
if index == "list":
    for i, rel in enumerate(pieces):
        print(i, rel, len(glob.glob(os.path.join(out, rel, "*.*"))))
    raise SystemExit
rel = pieces[int(index)]
files = [f for f in glob.glob(os.path.join(out, rel, "*.*")) if f.endswith((".mp4", ".json"))]
for attempt in range(30):
    try:
        print(f"{rel}: sending {len(files)} files (attempt {attempt})", flush=True)
        HfApi().upload_folder(repo_id=REPO, repo_type="dataset", folder_path=out, allow_patterns=[f"{rel}/*.mp4", f"{rel}/*.json"],
                              commit_message=f"Auto clips: {rel} ({len(files)} files)")
        print(f"{rel}: committed", flush=True)
        break
    except Exception as e:
        print(f"{rel}: attempt {attempt} failed: {str(e)[:400]!r}", flush=True)
        time.sleep(600)
else:
    raise SystemExit(f"{rel}: gave up")
