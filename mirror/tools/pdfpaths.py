"""A small PDF content-stream interpreter: every painted path, image and text run on a page, in page coordinates.

Tracks the transformation matrix (q/Q/cm), fill and stroke colours (sc/scn/rg/g/k and their stroke forms), alpha
(gs: /ca, /CA), line width, and form XObjects (with their /Matrix), recursively. Used by extract_lava.py.
"""
import re

import numpy as np
from pypdf import PdfReader
from pypdf.generic import ContentStream

PAINT = {"S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"}


def mat(a, b, c, d, e, f):
    return np.array([[a, b, 0.0], [c, d, 0.0], [e, f, 1.0]])


class Item(dict):
    pass


def interpret(path, page_index=0):
    reader = PdfReader(path)
    page = reader.pages[page_index]
    items = []

    def run(stream, resources, ctm0):
        gs_res = resources.get("/ExtGState", {}) if resources else {}
        xo_res = resources.get("/XObject", {}) if resources else {}
        st = {"ctm": ctm0, "fill": (0, 0, 0), "stroke": (0, 0, 0), "ca": 1.0, "CA": 1.0, "w": 1.0}
        stack = []
        subpaths, cur = [], None

        def tx(x, y):
            v = np.array([x, y, 1.0]) @ st["ctm"]
            return (float(v[0]), float(v[1]))

        ops = ContentStream(stream, reader).operations
        for operands, op in ops:
            op = op.decode() if isinstance(op, bytes) else op
            if op == "q":
                stack.append(dict(st))
            elif op == "Q":
                st = stack.pop()
            elif op == "cm":
                st["ctm"] = mat(*[float(v) for v in operands]) @ st["ctm"]
            elif op in ("sc", "scn", "rg"):
                vals = [float(v) for v in operands if not isinstance(v, str) or not v.startswith("/")]
                st["fill"] = tuple(vals[:3]) if len(vals) >= 3 else (vals[0],) * 3
            elif op in ("SC", "SCN", "RG"):
                vals = [float(v) for v in operands if not isinstance(v, str) or not v.startswith("/")]
                st["stroke"] = tuple(vals[:3]) if len(vals) >= 3 else (vals[0],) * 3
            elif op == "g":
                st["fill"] = (float(operands[0]),) * 3
            elif op == "G":
                st["stroke"] = (float(operands[0]),) * 3
            elif op == "w":
                st["w"] = float(operands[0])
            elif op == "gs":
                g = gs_res[operands[0]].get_object()
                if "/ca" in g:
                    st["ca"] = float(g["/ca"])
                if "/CA" in g:
                    st["CA"] = float(g["/CA"])
            elif op == "m":
                cur = [tx(*map(float, operands))]
                subpaths.append(cur)
            elif op == "l":
                cur.append(tx(*map(float, operands)))
            elif op == "c":
                v = list(map(float, operands))
                p0 = cur[-1]
                pts = [tx(v[0], v[1]), tx(v[2], v[3]), tx(v[4], v[5])]
                # flatten the cubic into a few points (only caps and joins use curves)
                for t in np.linspace(0, 1, 7)[1:]:
                    a, b, c_, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                    cur.append((a * p0[0] + b * pts[0][0] + c_ * pts[1][0] + d * pts[2][0],
                                a * p0[1] + b * pts[0][1] + c_ * pts[1][1] + d * pts[2][1]))
            elif op == "re":
                x, y, w, h = map(float, operands)
                cur = [tx(x, y), tx(x + w, y), tx(x + w, y + h), tx(x, y + h)]
                subpaths.append(cur)
            elif op == "h":
                pass
            elif op in PAINT:
                if op != "n" and subpaths:
                    items.append(Item(kind="path", op=op, subpaths=subpaths, fill=st["fill"], stroke=st["stroke"],
                                      ca=st["ca"], CA=st["CA"], w=st["w"]))
                subpaths, cur = [], None
            elif op in ("W", "W*"):
                pass
            elif op == "Do":
                x = xo_res[operands[0]].get_object()
                if x["/Subtype"] == "/Form":
                    m = x.get("/Matrix")
                    ctm = (mat(*[float(v) for v in m]) if m else np.eye(3)) @ st["ctm"]
                    items.append(Item(kind="form-begin", name=operands[0]))
                    run(x, x.get("/Resources") or resources, ctm)
                    items.append(Item(kind="form-end", name=operands[0]))
                else:
                    corners = [tx(0, 0), tx(1, 0), tx(1, 1), tx(0, 1)]
                    items.append(Item(kind="image", name=operands[0], corners=corners))
            elif op in ("TJ", "Tj"):
                items.append(Item(kind="text", ctm=st["ctm"]))

    run(page["/Contents"].get_object(), page["/Resources"], np.eye(3))
    return reader, page, items
