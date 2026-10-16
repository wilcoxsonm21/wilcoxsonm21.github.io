#!/usr/bin/env python3
"""The website's theme pass over the talk animations; tools/build_scenes.py runs it on every scene it builds.

The deck pages keep the talk's look (cream ground, Charter titles, Avenir labels). On the website every colour literal
in a scene is swapped for the colour of the role it plays, read from css/theme.css, and the fonts become the page's
Source Sans 3, so the animations and the page share one palette:

  - Mirror's rollouts, trajectories, bars, curves and its V2A box: --mirror (one blue in every figure);
    trained with action labels (supervised): --sup; plans and oracle plans: --plan; problems and failures: --fail;
  - neutrals: the old warm greys move onto the theme's ink-to-tile ramp at the same perceived lightness (CIE L*), so
    a faint grid stays faint and a dark label stays dark;
  - the caption keywords follow the page's headlines: a key claim (classes blue, violet, teal) is set in the gold
    gradient, problems stay red and plans green.

Two scenes are special: the Minecraft results chart (dreamer) keeps its original colours (only its ground, text ink
and fonts change, at the user's request), and the text-conditioning scene's instruction colours are categorical.

    python3 tools/theme.py --check          # theme the built scenes in memory and report what would change
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # mirror/
THEME_CSS = os.path.join(ROOT, "css", "theme.css")

SANS = '"Source Sans 3", "Helvetica Neue", Helvetica, Arial, sans-serif'
MARK = "<!-- mirror theme (tools/theme.py) -->"


def tokens():
    """--name: #rrggbb pairs of css/theme.css (tokens that point at other tokens are skipped)."""
    css = open(THEME_CSS, encoding="utf-8").read()
    return {m.group(1): m.group(2).lower() for m in re.finditer(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})\b", css)}


def hx(h):
    h = h.lower().lstrip("#")
    return "#" + ("".join(c * 2 for c in h) if len(h) == 3 else h)


def rgb(h):
    h = hx(h)
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def to_hex(c):
    return "#" + "".join(f"{max(0, min(255, round(v))):02x}" for v in c)


def mix(a, b, t):
    a, b = rgb(a), rgb(b)
    return to_hex([a[i] + (b[i] - a[i]) * t for i in range(3)])


def lum(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb(h)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def lstar(h):
    y = lum(h)
    return 116 * (y ** (1 / 3) if y > 216 / 24389 else (24389 / 27 * y + 16) / 116) - 16


OLD_INK, OLD_GROUND = "#191918", "#faf9f5"
# the deck's warm greys (rules, ticks, dashed boxes, inactive labels, timeline marks, the suites' VIPER curve)
OLD_GREYS = ["#999999", "#8a8a8a", "#6a6a6a", "#c9c9c9", "#c5bfb5", "#cfcac0", "#dcd8cf", "#bdb9b0", "#8d897f",
             "#8a8780", "#d3cec2", "#e7e3d9", "#9b978d", "#a39e94"]
# the exploration scene's rollouts, light (early in training) to dark (late), from the paper figure
EXPLORATION_RAMP = ["#a2a6c6", "#9fa3c3", "#7c82a8", "#71779f", "#616792", "#5f6691", "#515885", "#4c5482",
                    "#3c4475", "#333c6e", "#30386b", "#1d265c"]
# kept as they are: white and black marks, the navy backing matched to the OGBench floor, and the suites' baseline
# hues (BCO, LAIfO, Grounding, Random-V2A), which only tell the baselines apart
KEEP = {"#ffffff", "#000000", "#1b2233", "#e8833f", "#8e6cc0", "#2e7d32", "#8c613c"}


def grey_like(old, ink, ground):
    """The colour between ink and ground at old's perceived position between the deck's ink and ground."""
    t = (lstar(old) - lstar(OLD_INK)) / (lstar(OLD_GROUND) - lstar(OLD_INK))
    target = lstar(ink) + t * (lstar(ground) - lstar(ink))
    lo, hi = 0.0, 1.0
    for _ in range(40):
        m = (lo + hi) / 2
        if (lstar(mix(ink, ground, m)) < target) == (lstar(ink) < lstar(ground)):
            lo = m
        else:
            hi = m
    return mix(ink, ground, (lo + hi) / 2)


def ramp(stops, t):
    t = max(0.0, min(1.0, t))
    n = len(stops) - 1
    i = min(int(t * n), n - 1)
    return mix(stops[i], stops[i + 1], t * n - i)


def tables(T):
    """(hex map, rgb map) from the deck's literals to the theme's colours, for a scene with the full theme."""
    ground = T["bg-2"]
    hexmap = {g: grey_like(g, T["ink"], ground) for g in OLD_GREYS}
    hexmap.update({
        "#faf9f5": ground, "#f1efe8": T["card"],
        "#191918": T["ink"], "#3a3936": T["ink-2"], "#6b6862": T["muted"], "#a8a49c": T["faint"],
        "#3d74dc": T["mirror"], "#a261ff": T["mirror"], "#7a3fe0": T["mirror-text"], "#e4ecfb": T["mirror-tint"],
        "#cdb4f5": T["mirror-light"],
        "#2dd4bf": T["sup"], "#0e8a7a": T["sup-text"],
        "#507a61": T["plan"],
        "#df3a3f": T["fail"],
        "#e0782f": T["crit"], "#f7cf62": T["star"],
        # text conditioning's instructions (swim takes Mirror's blue above): chop tree, dig ground, ascend hill
        "#3f9a52": T["plan"], "#c96442": "#8e5bd9", "#d9932b": "#e0a000",
    })
    lo, hi = lum(EXPLORATION_RAMP[-1]), lum(EXPLORATION_RAMP[0])
    for h in EXPLORATION_RAMP:                    # light -> dark onto a blue ramp around Mirror's colour
        hexmap[h] = ramp(["#bacdf2", T["mirror"], "#173e92"], (hi - lum(h)) / (hi - lo))
    rgbmap = {(25, 25, 24): rgb(T["ink"]), (250, 249, 245): rgb(ground),
              (162, 97, 255): rgb(T["mirror"]), (45, 212, 191): rgb(T["sup"])}
    return hexmap, rgbmap


HEX_RE = re.compile(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])")
RGB_RE = re.compile(r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,[^()]*)?\)")


def remap(text, hexmap, rgbmap):
    hits = {}

    def sub_hex(m):
        old = hx(m.group(0))
        if old not in hexmap:
            return m.group(0)
        hits[old] = hits.get(old, 0) + 1
        return hexmap[old]

    def sub_rgb(m):
        key = tuple(int(m.group(i)) for i in (1, 2, 3))
        if key not in rgbmap:
            return m.group(0)
        hits[str(key)] = hits.get(str(key), 0) + 1
        r, g, b = rgbmap[key]
        return f"rgba({r},{g},{b}{m.group(4)})" if m.group(4) else f"rgb({r},{g},{b})"

    return RGB_RE.sub(sub_rgb, HEX_RE.sub(sub_hex, text)), hits


def fonts(html):
    """Charter and Avenir become Source Sans 3: CSS font-family values and the suites' list of faces to load. Glyph
    ids such as AvenirNext-Medium-36 (the dreamer chart's text, drawn as outlines) are not font declarations and stay."""
    n0 = html.count("Source Sans 3")
    html = re.sub(r"(?<!@font-face\{)font-family:\s*(?:[^;{}<>]*?)(?:Charter|Avenir)[^;{}<>]*",
                  lambda m: "font-family: " + SANS, html)
    html = re.sub(r"'(\d{3} |italic \d{3} )(\d+px) (?:\"Avenir Next\"|Charter)'", r"'\1\2 \"Source Sans 3\"'", html)
    return html, html.count("Source Sans 3") - n0


def caption_css(T):
    """Caption type and keyword colours, the same as the page's headlines."""
    gold = f"linear-gradient(90deg, {T['gold-1']}, {T['gold-2']})"
    return f"""<style>
/* website theme (tools/theme.py): captions in Source Sans 3; a key claim in the page's gold, problems red, plans green */
.title, #ptitle {{ font-weight: 600 !important; letter-spacing: -0.012em; }}
.title b {{ font-weight: 700; }}
.title .blue, .title .violet, .title .teal {{ background: {gold}; -webkit-background-clip: text; background-clip: text;
                                           color: transparent; -webkit-text-fill-color: transparent; }}
.title .red {{ color: {T['fail']}; }}
.title .green {{ color: {T['plan-text']}; }}
</style>
"""


def apply(html, name, T=None):
    """Theme one built scene. Returns (html, report). Raises if a colour literal is left that the theme does not
    know, so a new deck colour can't slip onto the site in the talk's palette."""
    if MARK in html:
        return html, {"skipped": "already themed"}
    T = T or tokens()
    if name == "dreamer":                         # the results chart keeps its original colours; only the ground
        hexmap = {"#faf9f5": T["bg-2"], "#191918": T["ink"], "#6b6862": T["muted"]}   # and the text's ink change
        rgbmap = {(250, 249, 245): rgb(T["bg-2"]), (25, 25, 24): rgb(T["ink"])}
    else:
        hexmap, rgbmap = tables(T)
    html, hits = remap(html, hexmap, rgbmap)
    html, nf = fonts(html)
    assert html.count("</head>") == 1, f"{name}: expected one </head>"
    html = html.replace("</head>", MARK + "\n" + caption_css(T) + "</head>", 1)
    report = {"colours": sum(hits.values()), "fonts": nf}
    if name != "dreamer":
        allowed = KEEP | set(hexmap.values()) | {hx(v) for v in T.values()}
        body = re.sub(r"data:[^\"')]+", "", html)
        left = sorted({hx(m.group(0)) for m in HEX_RE.finditer(body)} - allowed)
        if left:
            raise SystemExit(f"{name}: colours the theme does not map: {', '.join(left)} (add them to tools/theme.py)")
    return html, report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="theme the built scenes in memory and report")
    a = ap.parse_args()
    T = tokens()
    for name in ["intro", "exploration", "dreamer", "basalt", "textcond", "suites"]:
        html = open(os.path.join(ROOT, "scenes", name + ".html"), encoding="utf-8").read()
        out, rep = apply(html, name, T)
        print(f"{name:12s}", rep)


if __name__ == "__main__":
    sys.exit(main())
