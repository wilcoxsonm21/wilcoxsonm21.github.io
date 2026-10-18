"""Write manifest_auto.json for worker_auto.py: every Diamond episode of the viewer (eval/data), with whether it has
a plan video and the size of its execution (the biggest first, so the long ones start early).

    python make_manifest_auto.py SITE/mirror/eval/data OUT.json
"""
import json, os, sys
from huggingface_hub import HfApi

REV = "efacff62f69be8367c448b1c13ee21869f56ece2"
data, out = sys.argv[1], sys.argv[2]
sizes = {s.rfilename: s.size for s in HfApi().dataset_info("hwryu/mirror_diamond_eval", revision=REV, files_metadata=True).siblings}
items = []
for tab, arm in json.load(open(os.path.join(data, "index.json"))).items():
    for e in arm["episodes"]:
        d = json.load(open(os.path.join(data, tab, f"{e['n']:02d}.json")))
        views = d.get("views") or arm["features"]["views"]
        name = f"{e['n']:02d}.mp4"
        size = sizes[f"{arm['folder']}/raw/{name}"] + (sizes[f"{arm['folder']}/plan_idm/{name}"] if "plan_idm" in views else 0)
        items.append({"folder": arm["folder"], "n": name, "tab": tab, "plan": "plan_idm" in views, "lag": 1, "size": size})
items.sort(key=lambda i: -i["size"])
json.dump({"revision": REV, "items": items}, open(out, "w"))
print(len(items), "episodes,", sum(i["plan"] for i in items), "with a plan,", round(sum(i["size"] for i in items) / 1e9, 1), "GB of sources")
