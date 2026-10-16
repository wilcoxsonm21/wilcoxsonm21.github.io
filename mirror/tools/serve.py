#!/usr/bin/env python3
"""Preview server for the site, with HTTP Range support.

`python3 -m http.server` ignores Range requests, and without them Chrome cannot seek inside a video, so the
scroll-scrubbed clips of mirror would keep snapping back to their first frame. GitHub Pages serves ranges.

usage (from anywhere):  python3 mirror/tools/serve.py [port]
then open http://localhost:8000/mirror/
"""
import gzip
import http.server
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # the website repo


CHUNK = 1 << 20   # bytes


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # keep-alive: phones open dozens of Range requests at once; one connection each stalled them
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        # code revalidates on every load (edits show at once); media is cached for an hour, since no-cache plus Range
        # replies made browsers fetch the same clips again
        media = self.path.split("?")[0].lower().endswith((".mp4", ".webm", ".jpg", ".jpeg", ".png", ".woff2"))
        self.send_header("Cache-Control", "max-age=3600" if media else "no-cache")
        super().end_headers()

    def send_head(self):
        m = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range", "").strip())
        path = self.translate_path(self.path)
        # text goes out gzipped, as GitHub Pages sends it (dreamer.html is 263 KB raw, 95 KB gzipped)
        if not m and os.path.isfile(path) and path.endswith((".html", ".js", ".css", ".json", ".svg", ".txt")) \
                and "gzip" in self.headers.get("Accept-Encoding", ""):
            with open(path, "rb") as f:
                data = gzip.compress(f.read(), 6)
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return io.BytesIO(data)
        if not m or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2)))
        end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
        if start >= size:
            self.send_error(416, "Requested Range Not Satisfiable")
            return None
        end = min(end, size - 1)
        # a reply carries at most CHUNK bytes; the browser asks for the rest as it plays. A long reply to a video that then
        # pauses holds its connection, and over HTTP/1.1 Safari gets six per server: a few such videos and nothing else
        # (a scene, a font) could load at all. (GitHub Pages serves HTTP/2, which shares one connection.)
        end = min(end, start + CHUNK - 1)
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        n = getattr(self, "_remaining", None)
        if n is None:
            return super().copyfile(source, outputfile)
        try:
            while n > 0:
                buf = source.read(min(65536, n))
                if not buf:
                    break
                outputfile.write(buf)
                n -= len(buf)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            self._remaining = None

    # ?debug pages (js/debug.js) post what a real phone does here, one JSON object per line, for reading on this machine
    def do_POST(self):
        if self.path.split("?")[0] != "/__log":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        with open(os.environ.get("MIRROR_LOG", "/tmp/mirror_phone_log.jsonl"), "ab") as f:
            f.write(body.rstrip(b"\n") + b"\n")
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"serving {ROOT} on http://localhost:{port}/mirror/")
    http.server.ThreadingHTTPServer.request_queue_size = 128   # the default backlog of 5 refused bursts of video requests
    http.server.ThreadingHTTPServer.daemon_threads = True
    http.server.ThreadingHTTPServer(("", port), RangeHandler).serve_forever()
