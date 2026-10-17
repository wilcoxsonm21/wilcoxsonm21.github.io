"""Write manifest_frag.json: every video the episode viewers can request as frag/..., with its source and size."""
import json
from huggingface_hub import HfApi

REV = "efacff62f69be8367c448b1c13ee21869f56ece2"
api = HfApi()
src_sizes = {s.rfilename: s.size for s in api.dataset_info("hwryu/mirror_diamond_eval", revision=REV, files_metadata=True).siblings}
out_sizes = {s.rfilename: s.size for s in api.dataset_info("mwilcoxson/selfimprovingvisiontoactionmodelswebsitevideos", files_metadata=True).siblings}


def paths(folder, n, views):
    n = f"{n:02d}.mp4"
    ps = [f"{folder}/raw{s}/{n}" for s in ("", "_4x", "_16x")]
    if "plan_idm" in views:
        ps += [f"{folder}/{v}{s}/{n}" for v in ("side", "stack") for s in ("", "_4x", "_16x")]
    return ps


need = []
ev = json.load(open("eval/data/index.json"))
for tab, arm in ev.items():
    for e in arm["episodes"]:
        d = json.load(open(f"eval/data/{tab}/{e['n']:02d}.json"))
        need += paths(arm["folder"], e["n"], d.get("views") or arm["features"]["views"])
bs = json.load(open("basalt/data/index.json"))
for task, vs in bs.items():
    for ver, arm in vs.items():
        if isinstance(arm, dict) and "episodes" in arm:
            for e in arm["episodes"]:
                need += paths(arm["folder"], e["n"], e["views"])
need = sorted(set(need))
items, missing = [], []
for p in need:
    if "/raw/" in p:
        size, src = src_sizes.get(p), "hub:" + p
    else:
        size, src = out_sizes.get(p), "out/" + p
    if not size:
        missing.append(p)
        continue
    items.append({"src": src, "dest": "frag/" + p, "size": size})
items.sort(key=lambda i: -i["size"])
json.dump({"revision": REV, "items": items}, open("/tmp/frag_build/manifest_frag.json", "w"))
print(len(items), "items", round(sum(i["size"] for i in items) / 1e9, 1), "GB; hub", sum(i["src"].startswith("hub:") for i in items),
      "missing", len(missing), missing[:5])
