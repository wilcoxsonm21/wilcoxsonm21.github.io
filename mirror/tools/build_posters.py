#!/usr/bin/env python3
"""Each animation's opening frame as a still, shown while its scene loads (scenes/posters/).

A chapter shows its poster as soon as it comes near, so a reader on a slow connection sees the animation's first frame
at once instead of an empty box, and the live scene fades in over it, on the same frame, once it has loaded. Every scene
gets three: the deck's 16:9 frame with its title (wide screens), its 1920 x 880 body with no title (narrow screens and
phones held sideways, where the page draws the title), and its tall portrait stage (phones held upright), cut to the
height the frame shows at the start (PORTRAIT.FILL). Each is drawn the way the page draws it: the scene opened with
?scroll, rendered at the chapter's data-lead (index.html), its videos on their frame.

scenes/posters/posters.js holds what the page needs to lay a chapter's box out before its scene has loaded: the
posters, the portrait stage's size, the scene's titles and notes (the caption block is sized for the longest) and the
title it opens on. Rebuild after changing a scene, a portrait layout, a data-lead or the theme:

    python3 mirror/tools/build_posters.py              # all six
    python3 mirror/tools/build_posters.py --only basalt

Needs Playwright with its Chromium (pip install playwright; playwright install chromium) and Pillow.
"""
import argparse
import functools
import http.server
import io
import json
import os
import re
import threading

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)                       # mirror/
OUT = os.path.join(SITE, "scenes", "posters")
SCENES = ["intro", "exploration", "dreamer", "basalt", "textcond", "suites"]
# widths the posters are stored at: a placeholder for a second or two, sharp enough that the live scene replacing it
# doesn't visibly sharpen (the frame is at most ~1500 css px wide on a desktop; a phone's portrait box ~370)
WIDE_W, NARROW_W, PORTRAIT_W = 1600, 1440, 900
QUALITY = 80

READY_JS = """async ({ narrow, T }) => {
  const info = await window.SCENE.ready;
  window.SCENE.setNarrow(narrow);
  const draw = () => window.SCENE.render(T, { rate: 0, visible: false });
  draw();
  // the frame's videos on their frames, its images in, its fonts loaded
  const busy = () => document.fonts.status !== "loaded"
    || [...document.querySelectorAll("video")].some(v => v.currentSrc && (v.seeking || v.readyState < 2))
    || [...document.images].some(im => im.currentSrc && !im.complete);
  for (let i = 0; i < 300 && busy(); i++) { await new Promise(r => setTimeout(r, 50)); draw(); }
  for (let i = 0; i < 3; i++) { await new Promise(r => requestAnimationFrame(r)); draw(); }
  await new Promise(r => setTimeout(r, 150));
  const P = window.PORTRAIT;
  return { info, cap: window.SCENE.caption(), caps: window.SCENE.captions(), W: P ? P.W : 1920, H: P ? P.H : 1080,
           busy: busy() };
}"""


def leads():
    """data-lead of each scene's chapter in index.html (seconds of still opening the page skips)."""
    html = open(os.path.join(SITE, "index.html"), encoding="utf-8").read()
    out = {}
    for tag in re.findall(r'<section class="chapter"[^>]*>', html):
        m = re.search(r'data-scene="(\w+)"', tag)
        if m:
            lead = re.search(r'data-lead="([\d.]+)"', tag)
            out[m.group(1)] = float(lead.group(1)) if lead else 0.0
    return out


def fill_height(info, T):
    """Stage px of the portrait stage the frame shows at time T (js/site.js fillFrame)."""
    F, segs = info.get("fill"), info["segs"]
    if not F:
        return None
    clamp = lambda x, a=0.0, b=1.0: min(b, max(a, x))
    lerp = lambda a, b, u: a + (b - a) * u

    def steps(i):
        f = F[int(clamp(i, 0, len(F) - 1))]
        return [{"h": x} if isinstance(x, (int, float)) else x for x in (f if isinstance(f, list) else [f])]

    i = 0
    for k, g in enumerate(segs):
        if T >= g["start"]:
            i = k
    local, here = T - segs[i]["start"], steps(i)
    fh = steps(i - 1)[-1]["h"] if i else here[0]["h"]
    for x in here:
        u = clamp((local - x.get("at", .1)) / x.get("dur", 1))
        fh = lerp(fh, x["h"], 4 * u ** 3 if u < .5 else 1 - (2 - 2 * u) ** 3 / 2)
    return min(info["h"], fh)


def save(png, path, width, crop=None):
    im = Image.open(io.BytesIO(png)).convert("RGB")
    if crop:
        im = im.crop(crop)
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(path, "WEBP", quality=QUALITY, method=6)
    return os.path.getsize(path), im.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(SCENES))
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    # the scenes need ranges for their videos: the preview server's handler, on a free port
    import serve   # tools/serve.py
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), serve.RangeHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_port}/{os.path.basename(SITE)}/scenes/"
    lead = leads()
    path = os.path.join(OUT, "posters.js")
    manifest = {}
    if os.path.exists(path):   # (--only keeps the others)
        manifest = json.loads(re.search(r"=\s*(\{.*\});?\s*$", open(path).read(), re.S).group(1))
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        for name in a.only.split(","):
            T = lead.get(name, 0.0)
            entry = {"lead": T}
            # wide and narrow: the 1920 x 1080 frame at 1:1
            page = browser.new_page(viewport={"width": 1920, "height": 1080})
            page.goto(base + name + ".html?scroll", wait_until="load")
            r = page.evaluate(READY_JS, {"narrow": False, "T": T})
            n1, s1 = save(page.screenshot(), os.path.join(OUT, f"{name}.webp"), WIDE_W)
            r = page.evaluate(READY_JS, {"narrow": True, "T": T})
            n2, s2 = save(page.screenshot(), os.path.join(OUT, f"{name}_narrow.webp"), NARROW_W,
                          crop=(0, 200, 1920, 1080))
            entry.update(wide=f"scenes/posters/{name}.webp", narrow=f"scenes/posters/{name}_narrow.webp",
                         cap=r["cap"], caps=r["caps"])
            page.close()
            # portrait: the tall stage at 1:1, cut to what the frame shows at the start
            probe = browser.new_page(viewport={"width": 1080, "height": 1600})
            probe.goto(base + name + ".html?scroll&portrait", wait_until="load")
            W, H = probe.evaluate("[PORTRAIT.W, PORTRAIT.H]")
            probe.close()
            page = browser.new_page(viewport={"width": W, "height": H})
            page.goto(base + name + ".html?scroll&portrait", wait_until="load")
            r = page.evaluate(READY_JS, {"narrow": True, "T": T})
            fh = fill_height(r["info"], T)
            crop = (0, 0, W, round(fh)) if fh else None
            n3, s3 = save(page.screenshot(), os.path.join(OUT, f"{name}_portrait.webp"), PORTRAIT_W, crop)
            entry["portrait"] = {"src": f"scenes/posters/{name}_portrait.webp", "w": W, "h": H,
                                 "fh": round(fh) if fh else H}
            if r["caps"] != entry["caps"]:
                entry["pcaps"] = r["caps"]
            if r["cap"] != entry["cap"]:
                entry["pcap"] = r["cap"]
            page.close()
            manifest[name] = entry
            print(f"{name:12s} T={T:<4} wide {s1[0]}x{s1[1]} {n1 / 1e3:.0f} KB, narrow {s2[0]}x{s2[1]} {n2 / 1e3:.0f} KB, "
                  f"portrait {s3[0]}x{s3[1]} {n3 / 1e3:.0f} KB{'  (media still loading!)' if r['busy'] else ''}")
        browser.close()
    srv.shutdown()
    with open(path, "w") as f:
        f.write("// Generated by tools/build_posters.py: each animation's opening frame, and what the page needs to lay its box\n"
                "// out before the scene has loaded. Do not edit.\n"
                "window.SCENE_POSTERS = " + json.dumps({k: manifest[k] for k in SCENES if k in manifest},
                                                       separators=(",", ":"), ensure_ascii=False) + ";\n")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, HERE)
    main()
