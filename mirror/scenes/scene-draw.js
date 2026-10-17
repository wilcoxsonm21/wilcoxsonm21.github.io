// scene-draw.js: a scene's clips drawn from their own decoded frames, for when the browser won't play them. iOS Low
// Power Mode, and iOS's mitigation for a hot phone, refuse every video a page plays by itself until the reader taps, and
// the clips then drew nothing. scene-adapter.js loads this on the first refusal, where WebCodecs can decode the clips
// (iOS Safari 16.4 on), and draws each slot's clip on a canvas: SceneDraw.Clip reads the clip's MP4 itself (demux),
// decodes it with a VideoDecoder as the timeline moves, and hands back the frame on show at a time. Only a few frames are
// held at a time (a clip can have 650, at 0.75 MB each decoded), and a file comes in by ranges as it is needed (Source:
// the survival clip is 16 MB). js/site.js draws the hero's montage and the survival clip the same way: SceneDraw.takeOver
// lays a canvas over a <video> and runs the element's own play(), pause() and currentTime on a clock of its own.
(function () {
  "use strict";

  // ------------------------------------------------------------------ MP4: the video track's samples and decoder setup
  // (the scenes' clips: H.264 in an MP4 written by ffmpeg, with B-frames, so presentation follows the ctts offsets)
  function demux(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const fourcc = o => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    // the boxes in [start, end), as [type, payload start, box end]
    const boxes = (start, end) => {
      const out = [];
      for (let o = start; o + 8 <= end;) {
        let size = dv.getUint32(o), head = 8;
        if (size === 1) { size = Number(dv.getBigUint64(o + 8)); head = 16; }
        else if (size === 0) size = end - o;
        if (size < head || o + size > end) break;
        out.push([fourcc(o + 4), o + head, o + size]);
        o += size;
      }
      return out;
    };
    const kids = b => (b ? boxes(b[1], b[2]) : []);
    const find = (list, t) => list.find(b => b[0] === t);
    const path = (b, ...ts) => { for (const t of ts) b = find(kids(b), t); return b; };
    const moov = find(boxes(0, buf.byteLength), "moov");
    if (!moov) throw new Error("no moov box");
    const trak = kids(moov).filter(b => b[0] === "trak").find(t => {
      const h = path(t, "mdia", "hdlr");
      return h && fourcc(h[1] + 8) === "vide";   // (handler type, after version, flags and pre_defined)
    });
    if (!trak) throw new Error("no video track");
    const mdhd = path(trak, "mdia", "mdhd"), stbl = path(trak, "mdia", "minf", "stbl");
    const timescale = dv.getUint32(mdhd[1] + (u8[mdhd[1]] === 1 ? 20 : 12));
    const table = t => find(kids(stbl), t);

    // the sample description: avc1 with its avcC (the decoder's description), and the coded size
    const stsd = table("stsd"), entry = boxes(stsd[1] + 8, stsd[2])[0];
    if (!entry || !/^avc[13]$/.test(entry[0])) throw new Error("not H.264: " + (entry && entry[0]));
    const width = dv.getUint16(entry[1] + 24), height = dv.getUint16(entry[1] + 26);
    const avcC = find(boxes(entry[1] + 78, entry[2]), "avcC");
    if (!avcC) throw new Error("no avcC");
    const hex = x => x.toString(16).padStart(2, "0");
    const codec = "avc1." + hex(u8[avcC[1] + 1]) + hex(u8[avcC[1] + 2]) + hex(u8[avcC[1] + 3]);
    const description = u8.slice(avcC[1], avcC[2]);

    // sizes, decode times, composition offsets, keyframes, and where each sample sits (chunks)
    const stsz = table("stsz"), fixed = dv.getUint32(stsz[1] + 4), count = dv.getUint32(stsz[1] + 8);
    const size = i => (fixed || dv.getUint32(stsz[1] + 12 + 4 * i));
    const samples = [];
    for (let i = 0; i < count; i++) samples.push({ size: size(i), dts: 0, cts: 0, key: false, off: 0 });
    {
      const b = table("stts"), n = dv.getUint32(b[1] + 4);
      let i = 0, t = 0;
      for (let e = 0; e < n; e++) {
        const c = dv.getUint32(b[1] + 8 + 8 * e), d = dv.getUint32(b[1] + 12 + 8 * e);
        for (let k = 0; k < c && i < count; k++, i++) { samples[i].dts = t; samples[i].dur = d; t += d; }
      }
    }
    {
      const b = table("ctts");
      if (b) {
        const signed = u8[b[1]] === 1, n = dv.getUint32(b[1] + 4);
        let i = 0;
        for (let e = 0; e < n; e++) {
          const c = dv.getUint32(b[1] + 8 + 8 * e), o = signed ? dv.getInt32(b[1] + 12 + 8 * e) : dv.getUint32(b[1] + 12 + 8 * e);
          for (let k = 0; k < c && i < count; k++, i++) samples[i].cts = o;
        }
      }
      for (const s of samples) s.cts += s.dts;
    }
    {
      const b = table("stss");
      if (b) { const n = dv.getUint32(b[1] + 4); for (let e = 0; e < n; e++) { const k = dv.getUint32(b[1] + 8 + 4 * e) - 1; if (samples[k]) samples[k].key = true; } }
      else samples.forEach(s => { s.key = true; });
    }
    {
      const sc = table("stsc"), co = table("stco") || table("co64"), wide = co[0] === "co64";
      const nChunks = dv.getUint32(co[1] + 4), runs = [];
      for (let e = 0, n = dv.getUint32(sc[1] + 4); e < n; e++)
        runs.push([dv.getUint32(sc[1] + 8 + 12 * e), dv.getUint32(sc[1] + 12 + 12 * e)]);   // [first chunk, samples per chunk]
      let i = 0;
      for (let ch = 1; ch <= nChunks && i < count; ch++) {
        let per = 0;
        for (const [first, p] of runs) if (first <= ch) per = p;
        let o = wide ? Number(dv.getBigUint64(co[1] + 8 + 8 * (ch - 1))) : dv.getUint32(co[1] + 8 + 4 * (ch - 1));
        for (let k = 0; k < per && i < count; k++, i++) { samples[i].off = o; o += samples[i].size; }
      }
    }
    // presentation times in seconds from the first frame shown (the edit list's delay for B-frames is the least cts)
    const t0 = Math.min(...samples.map(s => s.cts));
    for (const s of samples) { s.pts = (s.cts - t0) / timescale; s.len = s.dur / timescale; }
    return { codec, description, width, height, samples };
  }

  // ------------------------------------------------------------------ a file, read by ranges as it is needed
  // The start of the file first (the clips are faststart: their moov is there), then each WIN-sized window a sample needs,
  // with the next one asked for ahead. Windows far behind the one in use go, so a long clip holds a few MB at most.
  const WIN = 1 << 19;   // 512 KB
  class Source {
    constructor(url) { this.url = url; this.wins = new Map(); this.asked = new Set(); this.size = Infinity; this.whole = null; }
    async get(a, b) {   // bytes [a, b], as an ArrayBuffer (the server may send the whole file: then that)
      const r = await fetch(this.url, { headers: { Range: `bytes=${a}-${b}` } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const buf = await r.arrayBuffer();
      if (r.status === 200) { this.whole = buf; this.size = buf.byteLength; return null; }
      const total = +((r.headers.get("Content-Range") || "").split("/")[1]);
      if (total) this.size = total;
      return buf;
    }
    async head() {   // the file's first window, its moov whole (fetched on if the moov runs past it)
      let buf = await this.get(0, WIN - 1);
      if (this.whole) return this.whole;
      this.wins.set(0, new Uint8Array(buf));
      const dv = new DataView(buf);
      for (let o = 0; o + 8 <= buf.byteLength;) {
        const size = dv.getUint32(o), t = String.fromCharCode(...new Uint8Array(buf, o + 4, 4));
        if (t === "moov" && o + size > buf.byteLength) {   // (a long clip's moov: fetch it whole)
          const more = await this.get(0, o + size - 1);
          return this.whole || more;
        }
        if (size < 8) break;
        o += size;
      }
      return buf;
    }
    bytes(off, len) {   // the bytes, if in; else null, and their windows are asked for
      if (this.whole) return new Uint8Array(this.whole, off, len);
      const w0 = Math.floor(off / WIN), w1 = Math.floor((off + len - 1) / WIN);
      let ok = true;
      for (let w = w0; w <= w1; w++) if (!this.wins.has(w)) { this.want(w); ok = false; }
      this.want(w1 + 1);   // (the next one, ahead)
      if (!ok) return null;
      if (w0 === w1) { const b = this.wins.get(w0), a = off - w0 * WIN; return b.subarray(a, a + len); }
      const out = new Uint8Array(len);
      for (let w = w0, at = 0; w <= w1; w++) {
        const b = this.wins.get(w), a = w === w0 ? off - w0 * WIN : 0, e = Math.min(b.length, off + len - w * WIN);
        out.set(b.subarray(a, e), at);
        at += e - a;
      }
      return out;
    }
    want(w) {
      if (this.whole || this.wins.has(w) || this.asked.has(w) || w * WIN >= this.size) return;
      this.asked.add(w);
      this.get(w * WIN, Math.min(this.size, (w + 1) * WIN) - 1).then(buf => {
        this.asked.delete(w);
        if (!buf) return;
        this.wins.set(w, new Uint8Array(buf));
        for (const k of this.wins.keys()) if (k > 0 && (k < w - 3 || k > w + 8)) this.wins.delete(k);   // (far behind or ahead)
      }, () => { this.asked.delete(w); });
    }
  }

  // ------------------------------------------------------------------ a clip, decoded as the timeline needs it
  const AHEAD = 8;     // samples fed past the one wanted (B-frames come out up to 3 later, and playing needs the next)
  const JUMP = 45;     // samples ahead at most before a jump starts over from the keyframe before the one wanted
  class Clip {
    constructor(url) {
      Clip.all.push(this);   // (for js/debug.js and tests)
      this.url = url;
      this.state = "loading";        // loading, ready, failed
      this.out = [];                 // decoded frames, by timestamp (µs), from the one on show on
      this.gen = 0;
      this.errors = 0;
      this.src = new Source(url);
      this.ready = this.src.head().then(buf => this.init(buf))
        .catch(e => { this.state = "failed"; console.warn("scene-draw:", url, e); });
    }
    async init(buf) {
      const t = demux(buf);
      this.track = t;
      this.cfg = { codec: t.codec, description: t.description, codedWidth: t.width, codedHeight: t.height, optimizeForLatency: true };
      const ok = await VideoDecoder.isConfigSupported(this.cfg).then(r => r.supported, () => false);
      if (!ok) throw new Error("can't decode " + t.codec);
      // presentation order, and each frame's place in it
      this.order = t.samples.map((s, i) => i).sort((a, b) => t.samples[a].pts - t.samples[b].pts);
      this.state = "ready";
    }
    get width() { return this.track ? this.track.width : 0; }
    // seconds: where the last frame stops showing
    get duration() { const s = this.track.samples, l = s[this.order[this.order.length - 1]]; return l.pts + l.len; }
    // the pts (µs) of the frame on show at t
    wantTs(t) { return Math.round(this.track.samples[this.at(t)].pts * 1e6); }
    get height() { return this.track ? this.track.height : 0; }
    // the decode index of the frame on show at t (seconds): the last one presented at or before it
    at(t) {
      const s = this.track.samples, o = this.order;
      let lo = 0, hi = o.length - 1;
      if (t <= s[o[0]].pts) return o[0];
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[o[m]].pts <= t + 1e-4) lo = m; else hi = m - 1; }
      return o[lo];
    }
    start(from) {   // a fresh decoder, fed from sample `from` (a keyframe)
      this.release();
      const gen = ++this.gen;
      this.dec = new VideoDecoder({
        output: f => { if (gen !== this.gen || f.timestamp < this.floor) { f.close(); return; } this.keep(f); },
        error: e => {   // (a decoder that fails starts again at the next frame wanted; three times, and the clip gives up)
          if (gen !== this.gen) return;
          console.warn("scene-draw:", this.url, e);
          this.dec = null;
          if (++this.errors >= 3) this.state = "failed";
        },
      });
      this.dec.configure(this.cfg);
      this.base = from;
      this.next = from;
      this.flushing = false;
    }
    keep(f) {
      let i = this.out.length;
      while (i > 0 && this.out[i - 1].timestamp > f.timestamp) i--;
      this.out.splice(i, 0, f);
      if (this.out.length > 24) this.out.shift().close();   // (a long jump's leftovers)
    }
    // the closest decoded frame to the one on show at t, decoding what that needs; null until one is in
    frame(t) {
      if (this.state !== "ready") return null;
      const s = this.track.samples, di = this.at(t), want = Math.round(s[di].pts * 1e6);
      // can the decoder under way get there? (not if it started after it, already passed it, or is far short of it)
      const passed = this.floor !== undefined && want < this.floor && !this.out.some(f => f.timestamp === want);
      if (!this.dec || this.dec.state === "closed" || di < this.base || passed || di - this.next > JUMP) {
        let k = di;
        while (k > 0 && !s[k].key) k--;
        this.start(k);
      }
      this.floor = want;
      // frames before the one on show are done with (but the newest of them stands in until it comes)
      while (this.out.length > 1 && this.out[1].timestamp <= want) this.out.shift().close();
      // feed up to AHEAD samples past it, and flush at the end (the last B-frames only come out then)
      const end = Math.min(s.length, di + 1 + AHEAD);
      while (this.next < end && this.dec.decodeQueueSize < 12) {
        const x = s[this.next], data = this.src.bytes(x.off, x.size);
        if (!data) break;   // (its window is on its way: the next frame wanted feeds it)
        this.next++;
        this.dec.decode(new EncodedVideoChunk({ type: x.key ? "key" : "delta", timestamp: Math.round(x.pts * 1e6),
          duration: Math.round(x.len * 1e6), data }));
      }
      if (this.next >= s.length && !this.flushing) { this.flushing = true; this.dec.flush().catch(() => {}); }
      const f = this.out[0];
      return f && f.timestamp <= want ? f : null;   // (null: the canvas keeps what it shows)
    }
    release() {   // the decoder and its frames go (the file stays: a clip comes back)
      this.gen++;
      if (this.dec && this.dec.state !== "closed") try { this.dec.close(); } catch (e) {}
      this.dec = null;
      for (const f of this.out) f.close();
      this.out = [];
      this.floor = undefined;
    }
  }

  Clip.all = [];

  // ------------------------------------------------------------------ a page's <video>, drawn instead of played
  // takeOver(v): a canvas laid over the element in its box (its class, so the page's css sizes and fits it; its inline
  // opacity, transform and background followed), the element hidden and its own native playback stopped. The element's
  // play(), pause(), currentTime, duration, paused, ended, playbackRate, src and buffered then run this Player, which fires
  // the element's media events (loadedmetadata, play, playing, waiting, pause, seeking, seeked, timeupdate, ended), so the
  // page's code works on as it was. The clock waits while the frame it wants isn't in, as a video waits for data.
  class Player {
    constructor(v) {
      this.v = v;
      this.t = 0;
      this.rate = 1;
      this.paused = true;
      this.clip = null;
      this.url = "";
      this.behind = 0;      // seconds the frame wanted hasn't been in
      const c = this.c = document.createElement("canvas");
      c.className = v.className;
      c.setAttribute("aria-hidden", "true");
      Object.assign(c.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%" });
      v.after(c);
      const mirror = () => { for (const k of ["opacity", "transform", "background", "transition"]) c.style[k] = v.style[k]; };
      new MutationObserver(mirror).observe(v, { attributes: true, attributeFilter: ["style"] });
      mirror();
      const native = HTMLMediaElement.prototype;
      native.pause.call(v);
      v.preload = "none";
      v.removeAttribute("autoplay");
      v.style.visibility = "hidden";
      const self = this, def = (k, get, set) => Object.defineProperty(v, k, { configurable: true, get, set });
      def("paused", () => self.paused);
      def("ended", () => self.ended());
      def("currentTime", () => self.t, x => self.seek(+x || 0));
      def("duration", () => (self.ready() ? self.clip.duration : NaN));
      def("readyState", () => (self.ready() ? 4 : 0));
      def("networkState", () => 1);
      def("error", () => null);
      def("buffered", () => { const d = self.ready() ? self.clip.duration : 0; return { length: d ? 1 : 0, start: () => 0, end: () => d }; });
      def("playbackRate", () => self.rate, x => { self.rate = +x || 1; });
      def("src", () => self.url, x => self.load(x));
      def("currentSrc", () => self.url);
      v.play = () => { self.play(); return Promise.resolve(); };
      v.pause = () => self.pause();
      v.load = () => {};
      const src = v.getAttribute("src");
      if (src) this.load(src);
    }
    fire(type) { this.v.dispatchEvent(new Event(type)); }
    ready() { return !!this.clip && this.clip.state === "ready"; }
    ended() { return this.ready() && !this.v.loop && this.t >= this.clip.duration - 1e-3; }
    load(src) {
      const url = new URL(src, location.href).href;
      if (url === this.url) return;
      this.url = url;
      Element.prototype.setAttribute.call(this.v, "src", src);   // (the attribute the page reads; preload none: nothing loads)
      if (this.clip) this.clip.release();
      const clip = this.clip = new Clip(url);
      this.t = 0;
      this.drawn = null;
      this.fire("emptied");
      this.fire("loadstart");
      clip.ready.then(() => {
        if (clip !== this.clip || clip.state !== "ready") return;
        this.fire("durationchange");
        this.fire("loadedmetadata");
        this.kick();
      });
    }
    play() {
      if (!this.paused) return;
      if (this.ended()) this.t = 0;
      this.paused = false;
      this.fire("play");
      this.kick();
    }
    pause() {
      if (this.paused) return;
      this.paused = true;
      this.fire("pause");
    }
    seek(t) {
      const d = this.ready() ? this.clip.duration : Infinity;
      this.t = Math.max(0, Math.min(t, d));
      this.seeking = true;
      this.fire("seeking");
      this.kick();
    }
    kick() { if (!this.raf) this.raf = requestAnimationFrame(now => this.frame(now)); }
    frame(now) {
      this.raf = 0;
      const dt = this.last != null ? Math.min(.1, (now - this.last) / 1000) : 0;
      this.last = now;
      const clip = this.clip;
      if (!this.ready()) { if (clip && clip.state === "loading") this.kick(); return; }
      if (!this.paused && !this.seeking) {
        if (this.behind > .3) { if (!this.waiting) { this.waiting = true; this.fire("waiting"); } }
        else {
          if (this.waiting) { this.waiting = false; this.fire("playing"); }
          this.t += dt * this.rate;
          const d = clip.duration;
          if (this.t >= d) {
            if (this.v.loop) this.t %= d;
            else { this.t = d; this.paused = true; this.fire("timeupdate"); this.fire("pause"); this.fire("ended"); }
          }
        }
        if (now - (this.tuAt || 0) > 250) { this.tuAt = now; this.fire("timeupdate"); }
      }
      // the frame for the clock's time
      const f = clip.frame(this.t), want = clip.wantTs(this.t);
      if (f && f.timestamp !== this.drawn) {
        const c = this.c;
        if (c.width !== clip.width || c.height !== clip.height) { c.width = clip.width; c.height = clip.height; }
        c.getContext("2d").drawImage(f, 0, 0, c.width, c.height);
        if (this.drawn == null) { this.fire("loadeddata"); this.fire("canplay"); this.fire("canplaythrough"); if (!this.paused) this.fire("playing"); }
        this.drawn = f.timestamp;
      }
      const there = f && want - f.timestamp < 1e5;   // (within 0.1 s of the frame wanted)
      this.behind = there ? 0 : this.behind + dt;
      if (this.seeking && there) { this.seeking = false; this.fire("seeked"); this.fire("timeupdate"); }
      if (!this.paused || this.seeking || !there) this.kick();
      else { this.last = null; clip.release(); }   // (paused, its frame drawn: the decoder goes until it plays or seeks)
    }
  }
  // the page's video v, drawn from now on (its Player)
  const takeOver = v => (v.drawnPlayer = v.drawnPlayer || new Player(v));

  window.SceneDraw = { Clip, demux, takeOver };
})();
