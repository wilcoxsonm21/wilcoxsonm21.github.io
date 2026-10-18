// site.js: the scroll engine of the Mirror page.
//
// Chapters pin a talk animation (an iframe running scenes/<name>.html?scroll, or a figure drawn in the page). Scrolling
// moves from chapter to chapter: it brings the headline in, lifts it away as the stage comes forward, and dissolves
// the stage as it scrolls on. Once the stage is in focus, the animation plays like a video, click after click, holding
// each click's last frame while its text is read. A thin bar along the bottom of each animation's box shows how far it
// has played, one segment per click. A tap or click on the box pauses or plays it, a swipe left (or the right arrow
// key, a trackpad swipe, a mouse drag) goes on to the next click and a swipe right back to the previous one, as a
// carousel pages. The box lets go once it leaves the screen or its animation ends.
// Everything else on the page (hero, statements, headlines, the dark interlude) is driven from the same frame loop.
(() => {
  "use strict";
  // the asset tag this script came with (?v=, index.html), for the scripts it loads later
  const ASSET_V = ((document.currentScript && /[?&]v=([^&#]+)/.exec(document.currentScript.src)) || [])[1] || "";
  // (a malformed % in the address, "#%", threw "URI malformed" and broke the page; it reads as no address)
  const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return ""; } };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  // a phone held sideways is covered by a note asking to turn it upright (js/turn.js): the page holds still under it
  const turned = () => root.classList.contains("turn");
  // a video of the page plays only while nothing covers the page: the note, or an episode modal (js/modal.js)
  const covered = () => turned() || root.classList.contains("modal-open");

  // style writes that skip unchanged values, so a page at rest invalidates nothing
  const memo = new WeakMap();
  function css(el, prop, v) {
    let m = memo.get(el);
    if (!m) memo.set(el, m = {});
    if (m[prop] !== v) { m[prop] = v; if (prop.startsWith("--")) el.style.setProperty(prop, v); else el.style[prop] = v; }
  }
  const docTop = el => { let t = 0; for (let e = el; e; e = e.offsetParent) t += e.offsetTop; return t; };
  // where the page's sections are and how tall: measured once per layout, not every frame, since a read after the
  // frame's style writes forces a style pass. geo.clear() drops them when the layout changes (relayout, and a
  // ResizeObserver on the sections, at the frame loop)
  const geo = new Map();
  const measure = (el, k, f) => { let m = geo.get(el); if (!m) geo.set(el, m = {}); return k in m ? m[k] : (m[k] = f(el)); };
  const topOf = el => measure(el, "top", docTop);
  const heightOf = el => measure(el, "h", e => e.offsetHeight);

  let vh = innerHeight, vw = innerWidth, narrow = false;
  let portrait = false;   // a phone held upright: the animations load their tall layouts (scenes/portrait/)
  let short = false;      // a window too short for the desktop layout, a laptop at 200% zoom (fitShort, css "fix: short
                          // landscape"); a phone held sideways is asked to turn upright instead (js/turn.js)
  let sy = scrollY, lastSy = -1;

  // ------------------------------------------------------------------ hero: "Mirror", seen through its letters
  const heroEl = $(".hero"), mark = $(".hero-mark"), heroVideo = $(".hero-video");
  const heroCopy = $(".hero-copy"), cue = $(".scroll-cue");
  // The knockout itself is markup and css (index.html, .hero-word), so it is right from the first paint. This measures
  // what depends on the text's layout: whether the scroll cue fits, and the statements' gold phrases.
  function layoutHero() {
    // the cue steps aside on short screens, where it would touch the links above it or the TL;DR peeking in below
    cue.classList.remove("off");
    const st = $(".statement-sticky");
    // the TL;DR waits below the fold: where the hero's copy runs to the screen's bottom (a small phone, large text), it
    // starts further down, so its first faint words never draw over the hero's links
    const stEl = st && st.parentElement;
    if (stEl) {
      stEl.style.paddingTop = "";
      const natural = docTop(stEl) + parseFloat(getComputedStyle(stEl).paddingTop) - st.offsetHeight / 2;
      const need = docTop(heroCopy) + heroCopy.offsetHeight + 32 - natural;
      if (need > 0) stEl.style.paddingTop = `calc(16vh + ${Math.ceil(need)}px)`;
    }
    const cueTop = cue.offsetTop, cueBottom = cueTop + cue.offsetHeight;   // in the hero's box, which starts at its top
    const copyBottom = heroCopy.offsetTop + heroCopy.offsetHeight;
    const nextTop = st ? docTop(st) - st.offsetHeight / 2 - docTop(heroEl) : Infinity;   // it is drawn raised by half
    cue.classList.toggle("off", cueTop < copyBottom + 24 || cueBottom > nextTop - 12);
    wordBlocks.forEach(goldPhrase);
  }
  function updateHero() {
    // with reduced motion the hero only fades: no zoom or drift, and the montage holds its poster
    // it fades over the first half screen of scrolling (after the part of it below the screen, if it is taller)
    const p = clamp((sy - Math.max(0, heightOf(heroEl) - vh)) / (.5 * vh));
    css(mark, "opacity", (1 - smooth(.4, .97, p)).toFixed(3));
    if (!REDUCED) {
      css(mark, "transform", `translate3d(0,${(-p * 8).toFixed(2)}vh,0) scale(${(1 - .07 * p).toFixed(4)})`);
      css(heroVideo, "transform", `scale(${(1 + .25 * p).toFixed(4)})`);
      css(heroCopy, "transform", `translate3d(0,${(-p * 70).toFixed(1)}px,0)`);
    }
    css(heroCopy, "opacity", (1 - smooth(.02, .42, p)).toFixed(3));
    css(cue, "opacity", (1 - smooth(0, .08, p)).toFixed(3));
    cue.classList.toggle("still", p >= .08);          // its looping line stops once it has faded (css "fix: perf")
    const end = topOf(heroEl) + heightOf(heroEl), on = sy < end && p < .97, far = sy > end + vh / 2;   // (on: not faded out)
    // (half a screen past it, its download gives way to the rest: park)
    if (far !== heroFar) { heroFar = far; if (far) park(heroVideo); else unpark(heroVideo); }
    if (on && heroVideo.paused && !REDUCED && !covered()) heroVideo.play().catch(e => refusal(e, heroVideo));
    else if (!on && !heroVideo.paused) heroVideo.pause();
  }

  // ------------------------------------------------------------------ statements, revealed word by word
  const wordBlocks = $$("[data-words]").map(el => {
    // one span per word; words of the key phrase (<span class="mk">) keep that class, and punctuation that follows
    // the phrase directly (no space) stays attached to it
    const words = [];
    let gap = false;                                     // whitespace since the last word
    el.childNodes.forEach(n => {
      const cls = n.nodeType === 1 && n.classList.contains("mk") ? "w mk" : "w";
      for (const t of n.textContent.split(/(\s+)/)) {
        if (!t) continue;
        if (/^\s+$/.test(t)) { gap = true; continue; }
        words.push((words.length && gap ? " " : "") + `<span class="${cls}">${t}</span>`);
        gap = false;
      }
    });
    // the last two words never part, so no line holds a single word ("planner.")
    const k = words.length - 1;
    if (k > 2 && words[k].startsWith(" ")) words[k] = " " + words[k].slice(1);
    el.innerHTML = words.join("");
    const sec = el.closest("section");
    return { el, sec, words: [...el.querySelectorAll(".w")], after: $(".closing-sub", sec),
             spacer: $(".statement-spacer, .closing-spacer", sec) };
  });
  // the gold phrase is split into words too, but its gradient runs once across the whole phrase, as on a headline's
  // single <span class="mk">: each word shows its own stretch of one gradient as wide as the phrase laid end to end
  function goldPhrase(b) {
    let x = 0, prev = null;
    const at = [];
    for (const w of b.words) {
      if (!w.classList.contains("mk")) continue;
      const r = w.getBoundingClientRect();
      if (prev && Math.abs(r.top - prev.top) < r.height / 2) x += r.left - prev.right;   // the space, on the same line
      at.push([w, x]);
      x += r.width;
      prev = r;
    }
    for (const [w, off] of at) {
      css(w, "backgroundSize", `${x.toFixed(1)}px 100%`);
      css(w, "backgroundPosition", `${(-off).toFixed(1)}px 0`);
    }
  }
  // the words fill in over REVEAL viewport heights of scrolling, starting when the text is REVEAL_IN below its pin;
  // the spacer (css) keeps the finished statement pinned for a while after
  const REVEAL = .56, REVEAL_IN = .28;
  function updateWords(b) {
    // the text pins (its layout top at the centre line) at pin, for as long as the spacer after it; the words fill in
    // from when it is a little below the centre until most of the way through
    const NAV = 52, pin = topOf(b.sec) - (vh + NAV) / 2;
    b.p0 = pin - REVEAL_IN * vh;                       // the scroll position where the reveal starts
    const p = (sy - b.p0) / (REVEAL * vh);
    const n = b.words.length, r = clamp(p) * (n + 2);
    b.words.forEach((w, i) => css(w, "opacity", REDUCED ? "1" : (.14 + .86 * clamp((r - i) / 2.2)).toFixed(3)));
    if (b.after) {
      const u = REDUCED ? 1 : smooth(.86, 1.02, p);
      css(b.after, "opacity", u.toFixed(3));
      css(b.after, "transform", `translate3d(0,${((1 - u) * 16).toFixed(1)}px,0)`);
    }
  }

  // ------------------------------------------------------------------ the reader's scrolling, and the page scrolling itself
  // The reader counts as scrolling from their first wheel step, scroll key, touch or scroll movement until MOVE_HOLD
  // after the scroll stops (momentum and the scrollbar show up as movement), and for as long as a finger is down.
  // Then a statement plays on, and a chapter caught between its headline and its stage settles on one of them.
  const MOVE_HOLD = .15;   // seconds
  const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
  let holdUntil = 0, readerDir = 1;          // readerDir: which way the reader last scrolled
  let touching = false;                      // a finger is on the screen
  let glide = null, ownAt = null;            // the page's own scrolling: a glide under way; the last position it set
  const scrolling = now => touching || now < holdUntil;
  function takeOver(s) { glide = null; snapArmed = true; holdUntil = Math.max(holdUntil, performance.now() + s * 1e3); }
  addEventListener("wheel", () => takeOver(MOVE_HOLD), { passive: true });
  addEventListener("keydown", e => { if (SCROLL_KEYS.has(e.key)) takeOver(MOVE_HOLD); });
  // a finger landing stops a glide where it is, even if it doesn't move
  let touchAt = 0;
  addEventListener("touchstart", e => { touching = e.touches.length > 0; if (touching) { glide = null; touchAt = performance.now(); } }, { passive: true });
  // (a glide the gesture began itself, a swipe bringing its stage forward, goes on when the finger lifts)
  for (const ev of ["touchend", "touchcancel"])
    addEventListener(ev, e => {
      touching = e.touches.length > 0;
      if (touching) return;
      const own = glide && glide.t0 >= touchAt ? glide : null;
      takeOver(MOVE_HOLD);
      glide = own;
    }, { passive: true });
  document.addEventListener("visibilitychange", () => takeOver(MOVE_HOLD));   // back on the tab: a moment first

  function scrollSelf(y) { ownAt = y; scrollTo({ top: y, behavior: "instant" }); }
  // a glide eases the page to a scroll position: a chapter's stage, or its headline
  function glideTo(y, ms) {
    if (REDUCED) { scrollSelf(y); return; }
    const from = scrollY;
    glide = { from, to: y, t0: performance.now(), dur: ms || clamp(300 + .25 * Math.abs(y - from), 300, 1200) };
  }
  function stepGlide(now) {
    const u = clamp((now - glide.t0) / glide.dur), e = u < .5 ? 4 * u * u * u : 1 - Math.pow(2 - 2 * u, 3) / 2;
    scrollSelf(lerp(glide.from, glide.to, e));
    if (u >= 1) glide = null;
  }

  // A reader who stops with a video or a block of text almost centred is nudged the last few pixels to centre it, once
  // per stop, a moment after their scrolling (and its momentum) has ended. The full-screen spots snap the same way: a
  // chapter just short of pinning (its headline still rising) is carried up to its pin, and a statement just short of
  // its pin is centred. Nothing too tall to fit on the screen snaps.
  const SNAP_SEL = ".prose-body, .bibtex, .cinema-head, .cinema-screen, .results-head, .gallery";
  const SNAP_NEAR = .06;   // viewport heights off centre, at most, to snap (capped at 64 px)
  // a box can ask for a wider reach (data-snap-near, viewport heights, capped at a quarter of the screen): the survival
  // video, a short strip on a desktop, is easy to stop well short of
  const SNAP_WAIT = .15;   // seconds after the reader's scrolling ends
  let snapArmed = false, noSnapUntil = 0;
  const snapEls = $$(SNAP_SEL).filter(el => !el.closest("[class*='-sticky']"));
  const snapPinned = $$(".statement-text, .closing-text");
  function snapNear(now) {
    if (!snapArmed || REDUCED || glide || comeBack || scrolling(now) || now < holdUntil + SNAP_WAIT * 1e3) return;
    snapArmed = false;
    if (now < noSnapUntil || wordBlocks.some(b => b.autoY != null)) return;
    // (a reader at the very bottom, with End or a long scroll, stays there: centring the BibTeX pulled the page up)
    if (scrollY >= root.scrollHeight - innerHeight - 2) return;
    const navH = $(".localnav").offsetHeight, mid = (navH + vh) / 2, room = vh - navH;
    const near0 = Math.min(64, SNAP_NEAR * vh);
    let best = null, near = near0;
    const offer = (d, n = near0) => { if (Math.abs(d) <= n && (best == null || Math.abs(d) < Math.abs(best))) { best = d; near = n; } };
    for (const el of snapEls) {
      const h = el.offsetHeight;   // layout boxes: a .reveal still sliding in is measured where it lands
      const n = el.dataset.snapNear ? Math.min(.25 * vh, parseFloat(el.dataset.snapNear) * vh) : near0;
      if (h && h <= .9 * room) offer(docTop(el) - scrollY + h / 2 - mid, n);
    }
    // pinned text: once pinned it sits centred by itself (d = 0), so this only carries it the last bit to its pin
    for (const el of snapPinned) { const r = el.getBoundingClientRect(); if (r.height) offer(r.top + r.height / 2 - mid); }
    // a chapter rising into view: its pin is where its headline (or, without one, its figure) fills the screen
    for (const c of chapters) { const d = topOf(c.el) - scrollY; if (d > 0) offer(d); }
    if (best && Math.abs(best) > 1 && Math.abs(best) <= near) glideTo(scrollY + best, 320);
  }

  // A statement the reader stops in partway plays on: the page scrolls on so the words fill in at reading pace, and
  // stops once the last one is in. Before the second word lights, nothing moves (the hero is still in view).
  function autoplayWords(b, now, dt) {
    const n = b.words.length, span = REVEAL * vh, p = (sy - b.p0) / span, pEnd = (n + 1.2) / (n + 2);
    if (REDUCED || glide || scrolling(now) || p < 2 / (n + 2) || p >= pEnd) { b.autoY = null; return; }
    if (b.autoY == null || Math.abs(b.autoY - sy) > 3) b.autoY = sy;
    b.autoY = Math.min(b.p0 + pEnd * span, b.autoY + WPS * span / (n + 2) * dt);
    scrollSelf(b.autoY);
  }

  // ------------------------------------------------------------------ chapters
  // Scrolling moves between chapters and only brings each stage into focus and out again; it no longer scrubs the
  // animation. A chapter in focus plays like a video: each click runs at normal speed, holds while its text is read,
  // and the next one follows, up to the last. The reader can take control of it (select, below).
  const HEAD = .8;     // viewport heights of pinned scroll for the headline and the stage coming forward
  const Z0 = .7;       // headline lengths in: the animation starts playing as the stage comes forward
  const REST = .9;     // headline lengths in: the stage is fully forward (a reader who stops short is carried here)
  const DWELL = .4;    // viewport heights the stage stays pinned at full size before it scrolls away
  const SETTLE = .3;   // headline lengths in: past this, a reader who stops is carried through to the stage
  // pacing: when a played-out click moves on by itself
  const HOLD = .25;    // seconds on its last frame
  const USED = 1.5;    // seconds after the reader used an animation (a swipe, a tap, a key) that a settle takes them to its stage
  const WPS = 6;       // the statements' pace (words per second) as they fill in (autoplayWords)
  // A click waits until its text has been read in full: the step's text, or the scene's title, at READ_WPS from when
  // it showed. There is no cap: a reader who has read it can swipe on (controls).
  const READ_WPS = 4;
  // data-read values were set at 3.8 words/s: READ_PACE rescales the part of each that goes past the click's own
  // length to READ_WPS
  const READ_PACE = 3.8 / READ_WPS;
  // ?timing: a panel for setting each click's dwell by hand and trying it out (js/timing.js sets window.MIRROR_TIMING)
  const TIMING = () => window.MIRROR_TIMING;
  const STILL = .25;   // seconds without scrolling before an opening's wait (data-wait) starts counting
  // A chapter's data-read="s0,s1,…" sets each click's dwell outright (seconds from the click's start before the next
  // click plays, at least the click's own length), and the word count still applies: a title that shows late in a long
  // click gets its full reading time.

  // (it follows the pointer: an iPad gaining a trackpad, or losing it, changes the transport's note, below)
  const hoverNone = matchMedia("(hover: none)");
  let TAP = hoverNone.matches ? "Tap" : "Click";
  const tipText = () => TAP === "Tap" ? "or swipe" : `or press ${KEY(-1)}${KEY(1)}`;
  hoverNone.addEventListener?.("change", () => {
    TAP = hoverNone.matches ? "Tap" : "Click";
    $$(".ctl-tip").forEach(t => { t.innerHTML = tipText(); });
  });

  // narrow screens: the box around a scene keeps CARD_SIDE from the screen's sides and at least CARD_EDGE from the nav.
  // Under it are its controls (the transport, below): CTL_ROOM for them and the gap above them, then CTL_FOOT.
  const CARD_SIDE = 12, CARD_EDGE = 14, CTL_ROOM = 48, CTL_FOOT = 8;
  const SHORT_EDGE = 8;   // a phone held sideways: the box's room above and below (fitShort)
  const CTL_SIDE = 48;    // ... and the room it keeps at either side for the transport, which stands beside it
  let meter = null;
  // a hidden caption block at width w, for measuring titles in the caption's own type
  // a title's "video–action" doesn't break after its dash (a word joiner), leaving "action data?" alone on a line
  const joinDash = h => h.replace(/(\w)\u2013(?=\w)/g, "$1\u2013\u2060");
  function captionMeter(w) {
    if (!meter) {
      meter = document.createElement("div");
      meter.className = "stage-caption";
      meter.setAttribute("aria-hidden", "true");
      meter.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;min-height:0";
      document.body.append(meter);
    }
    meter.style.width = w + "px";
    return meter;
  }

  // a scene frame's window, its SCENE and its address; null while the frame holds a page of another origin (the
  // browser's error page for a scene that failed to load, as on a phone's dropped connection), which can't be read
  const frameAt = f => { try { const w = f.contentWindow; return w && { w, S: w.SCENE, href: w.location.href }; } catch (e) { return null; } };

  class Chapter {
    constructor(el) {
      this.el = el;
      this.head = $(".chapter-head", el);
      this.stage = $(".stage", el);
      this.iframe = $("iframe", el);
      this.capEl = $(".stage-caption", el);
      this.steps = $(".steps", el);
      this.stepList = !!this.steps;   // a list of the steps, written in the page
      this.inline = el.hasAttribute("data-inline");              // drawn in the page, not in an iframe
      this.noHead = el.dataset.head === "none";                  // no headline phase: pinned as it arrives
      this.setSegs(el.dataset.segs.split(",").map(Number));
      if (this.dots.length) this.dots[0].classList.add("on");   // (the opening's step shows before its figure is drawn)
      this.read = (el.dataset.read || "").split(",").map(x => x.trim() === "" ? null : Number(x));
      // data-dwell="s0,s1,…": each click's dwell set by hand, in the reader's seconds from the click's start to the next
      // click, exactly (no reading time on top; js/timing.js, ?timing, records them); an empty entry keeps the reading rule
      this.dwell = (el.dataset.dwell || "").split(",").map(x => x.trim() === "" ? null : Number(x));
      // data-wait: seconds the opening holds, in focus, before the first click plays (js/timing.js records it too)
      this.wait = el.dataset.wait ? Number(el.dataset.wait) : null;
      this.opening = false;   // at the opening, before the first click has started playing (fromLead)
      this.waited = 0;        // ... and how long it has held there
      // seconds of still opening to skip (data-lead): the animation starts where something first moves
      this.lead = Number(el.dataset.lead) || 0;
      // how much faster than the talk the animation plays (data-speed), videos included: one number, then any changes
      // from a scene time on as "T:speed" (e.g. "1.25, 25.3:.5, 27.6:1.25"), or from a click's start as "#k:speed"
      this.speeds0 = (el.dataset.speed || "1").split(",").map(s => s.trim().split(":"))
        .map(p => p.length < 2 ? { at: 0, v: Number(p[0]) || 1 }
          : p[0][0] === "#" ? { click: Number(p[0].slice(1)), v: Number(p[1]) || 1 } : { at: Number(p[0]), v: Number(p[1]) || 1 });
      this.speeds = this.atClicks(this.speeds0);
      this.lead0 = this.lead;
      this.T = 0;
      this.k = 0;             // the click being played (or held on, once it has played out)
      this.clock = 0;         // seconds this chapter has been playing: pauses and time out of focus don't count
      this.held = REDUCED;    // doesn't play by itself (with reduced motion, where each tap shows the next step)
      this.ended = false;     // the last click has played out
      this.live = false;      // in focus and playing
      this.rate = 0;
      this.api = null;
      this.state = "idle";
      this.wasVisible = false;
      this.stageO = 0;
      this.shown = 1;         // the stage fades out while the scene reloads in the other layout, and back in (reveal)
      this.swap = null;       // that reload: when the new scene was ready, and how many frames it has drawn since
      this.capHTML = null;
      this.capText = "";      // the scene's title as plain text, since capAt (clock)
      this.capAt = 0;
      this.cur = -1;          // the click on screen, since curAt (clock)
      this.curAt = 0;
      this.doneAt = null;     // when the current click finished playing (clock)
      this.gen = 0;           // loads of the scene so far (a newer one makes an older one's events stale)
      this.mode = null;       // whether the scene was loaded in its portrait layout
      this.card = null;       // narrow screens: the box around the scene (fitCard)
      this.frameH = null;     // the frame's height while a click fills only part of the stage (fillFrame)
      // the box the reader taps to take control (select, below): the animation's frame, or the figure drawn in the page
      this.box = this.inline ? $("figure", el) : this.frameEl();
      this.selected = false;
      this.played = 0;        // how far the click on screen has got, its reading hold included (progress)
      this.wanted = false;    // within reach of the reader (schedule): a scene out of reach lets go of its downloads
      this.parked = false;    // ... and has (update)
      // The animation's opening frame (scenes/posters/, tools/build_posters.py) stands in for the scene until the scene
      // has loaded and drawn that frame, then fades out over it; the box takes the scene's shape and caption room
      // from posters.js before then (prep), so nothing moves when the scene arrives.
      this.pinfo = !this.inline && (window.SCENE_POSTERS || {})[el.dataset.scene] || null;
      if (this.pinfo) {
        const p = this.poster = document.createElement("img");
        p.className = "poster";
        p.alt = "";
        p.decoding = "async";
        p.setAttribute("aria-hidden", "true");
        // (inAt: when it came in; it covers the frame once its own fade in, css .3 s, is done)
        p.addEventListener("load", () => { p.classList.add("in"); this.posterInAt = performance.now(); wake(); });
        p.addEventListener("error", wake);
        this.iframe.before(p);
      }
      // a figure drawn in the page has its pictures for a poster (img data-src: the lava escape's screenshot, its first
      // step), loaded in the same order
      this.pics = this.inline ? $$("img[data-src]", el) : [];
      // a slow connection: a spinner over the box while it waits (css .wait)
      this.box.insertAdjacentHTML("beforeend", '<i class="spin" aria-hidden="true"></i>');
      // ... and where it failed (an error from the server, its script missing, or no connection), a note in its place
      // with a way to try again: over its poster it looked finished, with controls that did nothing (css .failed)
      const fail = document.createElement("button");
      fail.type = "button";
      fail.className = "fail-note";
      fail.textContent = "Couldn’t load · Try again";
      fail.addEventListener("click", e => { e.stopPropagation(); this.retryLoad(); });
      fail.addEventListener("pointerdown", e => e.stopPropagation());
      this.box.append(fail);
      controls(this);
    }
    // the poster for the layout of now; whether it is in (or failed, or is taking over POSTER_MAX: the chapters after
    // it don't wait any longer); and asking for it
    posterSrc() {
      const P = this.pinfo;
      return portrait ? P.portrait.src : narrow || short ? P.narrow : P.wide;
    }
    posterReady() {
      const late = performance.now() - this.posterAt > POSTER_MAX * 1e3;
      if (this.pics.length) return this.pics.every(im => im.getAttribute("src") && (im.complete || late));
      return !this.poster || this.poster.getAttribute("src") === this.posterSrc() && (this.poster.complete || late);
    }
    loadPoster() {
      if (this.pics.length) {
        const ask = this.pics.filter(im => !im.getAttribute("src"));
        ask.forEach(im => { im.src = im.dataset.src; });
        if (ask.length) this.posterAt = performance.now();
        return;
      }
      if (!this.poster) return;
      const src = this.posterSrc();
      if (this.poster.getAttribute("src") === src) return;
      this.poster.classList.remove("in");
      this.poster.src = src;
      this.posterAt = performance.now();
    }
    // the poster stands in for the scene: until the scene has loaded, drawn its opening and shown (a scene that reloads
    // partway through, in the other layout, fades in on the click it was on instead)
    // (and while its clips are refused, Low Power Mode: they would draw nothing)
    covers() { return !!this.poster && (!this.api || this.shown < 1 || this.refused) && this.T <= this.lead + 1e-3; }
    // the poster is in and fully drawn, over the scene's frame
    posterUp() { return this.poster.classList.contains("in") && performance.now() - this.posterInAt > 320; }
    // before its scene has loaded, the box takes the shape and the caption room the scene will want
    prep() {
      const P = this.pinfo;
      if (!P || this.api) return;
      const pt = portrait && P.portrait;
      this.el.classList.toggle("tall", !!pt);
      if (pt) { this.el.style.setProperty("--scene-ar", `${pt.w} / ${pt.h}`); this.el.style.setProperty("--scene-r", (pt.w / pt.h).toFixed(4)); }
      this.caps = portrait && P.pcaps || P.caps;
      this.capHTML = null;
    }
    // its scene has what the frame on the screen needs (its opening, the clips of the click it plays; SCENE.pending),
    // so the next chapter can load without sharing the connection with it (schedule). What it fetches ahead doesn't
    // count, and a scene that stalls holds the others back for LOAD_MAX at most.
    settled() {
      if (this.state === "failed") return true;
      if (this.state === "loading") return performance.now() - this.loadAt > LOAD_MAX * 1e3;   // (stalled: go on)
      if (this.state !== "ready") return false;
      if (this.inline) return true;
      if (this.swap && this.wasVisible) return false;   // (on the screen and not yet shown: its opening first)
      return !(this.api.pending && this.api.pending() > 0);
    }
    setSegs(durs) {
      let G = 0;
      this.segs = durs.map(d => { const s = { start: G, dur: d }; G += d; return s; });
      this.total = G;
      if (this.k !== undefined) this.k = clamp(this.k, 0, this.segs.length - 1);
      // a written step plays when picked; the progress bar has a segment per click (controls, below)
      this.dots = this.stepList ? [...this.steps.children] : [];
      this.dots.forEach((d, i) => { d.onclick = () => this.goto(i); });
      if (this.bar) { this.bar.innerHTML = this.segs.map(() => "<i></i>").join(""); this.segEls = [...this.bar.children]; }
    }
    layout() {
      this.headLen = HEAD * vh;
      this.rest = this.noHead ? 0 : REST * this.headLen;
      this.pinLen = this.rest + DWELL * vh;
      this.el.style.height = Math.round(this.pinLen + vh) + "px";
      this.prep();
      this.fitCard();
    }
    // Narrow screens: the scene's title sits in the grey box, above the animation, as it does on a wide screen. Every
    // chapter's box is the screen's width less CARD_SIDE a side, so the boxes line up from chapter to chapter. The
    // animation is as large as the box allows below the nav: one too tall for the screen at that width is drawn
    // narrower, centred in the box, with grey on either side. The caption block is as tall as the scene's longest
    // title, so the box keeps its size from click to click. Any room left over goes to the screen's top and bottom
    // edges, not between the text and the figure.
    fitCard() {
      if (this.inline || !this.capEl) return;
      const f = this.frameEl();
      if (short) { this.fitShort(); return; }
      if (!narrow) {
        for (const k of ["--card-w", "--cap-h", "--card-top"]) this.el.style.removeProperty(k);
        this.card = null; f.style.height = "";
        this.place("", "", "");
        return;
      }
      const tall = this.el.classList.contains("tall"), r = tall ? parseFloat(this.el.style.getPropertyValue("--scene-r"))
        : 1920 / 880;
      const navH = parseFloat(getComputedStyle(root).getPropertyValue("--nav-h")) || 52;
      // under the box: the transport
      const avail = vh - navH - CARD_EDGE - CTL_ROOM - CTL_FOOT;
      const w = Math.floor(vw - 2 * CARD_SIDE), capH = Math.ceil(this.captionHeight(w));
      const fw = Math.floor(Math.min(w, Math.max(200, (avail - capH) * r)));
      // the box is anchored where it sits centred at its full size; a click that fills less of the stage (FILL)
      // shortens it from the bottom, so the room it leaves goes to the screen's bottom edge
      const full = fw / r, top = Math.max(CARD_EDGE, (vh - navH - CTL_ROOM - capH - full) / 2);
      this.el.style.setProperty("--card-w", w + "px");
      this.el.style.setProperty("--cap-h", capH + "px");
      this.el.style.setProperty("--card-top", Math.round(top) + "px");
      this.card = { w, fw, full, tall };
      this.place(fw + "px", (w - fw) / 2 + "px", tall ? full + "px" : "");
      f.style.height = full.toFixed(1) + "px";
      this.frameH = null;
      this.fillFrame();
    }
    // the scene's frame in the box, and its poster where the frame's opening is drawn (its own height: the poster is
    // cut to what the box shows at the start)
    place(width, left, height) {
      Object.assign(this.iframe.style, { width, left, height });
      if (this.poster) Object.assign(this.poster.style, { width, left });
    }
    // A phone held sideways (short): the nav slides away while a chapter is on screen, so the box has the screen's
    // whole height. It is the narrow layout's box (title above, animation below, cropped to its 1920 x 880 body), as
    // large as the height allows and only as wide as the animation, so the room left over goes to the screen's sides
    // (and clears the notch). The transport stands beside the box, centred on the animation (--ctl-x, --ctl-y).
    fitShort() {
      const f = this.frameEl(), r = 1920 / 880, st = getComputedStyle(this.stage);
      const pl = parseFloat(st.paddingLeft) || 0, pr = parseFloat(st.paddingRight) || 0;
      const side = Math.max(CARD_SIDE, pl, pr) + CTL_SIDE;
      const avail = vh - 2 * SHORT_EDGE, wMax = Math.floor(vw - 2 * side);
      let fw = wMax, capH = 0;
      for (let i = 0; i < 4; i++) {   // a narrower box can wrap the title onto another line
        capH = Math.ceil(this.captionHeight(fw));
        const next = Math.floor(Math.min(wMax, Math.max(200, (avail - capH) * r)));
        if (next === fw) break;
        fw = next;
      }
      const full = fw / r, top = Math.round(Math.max(0, (vh - capH - full) / 2));
      this.el.style.setProperty("--card-w", fw + "px");
      this.el.style.setProperty("--cap-h", capH + "px");
      this.el.style.setProperty("--card-top", top + "px");
      this.el.style.setProperty("--ctl-x", Math.round(pl + (vw - pl - pr + fw) / 2 + 8) + "px");
      this.el.style.setProperty("--ctl-y", Math.round(top + capH + full / 2) + "px");
      this.card = { w: fw, fw, full, tall: false };
      this.place("", "", "");
      f.style.height = full.toFixed(1) + "px";
      this.frameH = null;
    }
    frameEl() { return this.iframe.parentNode; }
    // A portrait layout can say how much of its stage each click fills (PORTRAIT.FILL, one entry per click: the height
    // in stage px, or { h, at, dur } to time the change in seconds of the click, or a list of those for several changes
    // in one click; the first click's first entry is where it starts). The frame shows that much: it grows or shrinks
    // over each change (default .1 to 1.1 s into the click) and follows T.
    fillFrame() {
      if (this.inline) return;
      const c = this.card, F = this.fill, el = this.frameEl();
      if (!this.api && this.pinfo && c && c.tall) {   // (before its scene has loaded: what it shows at the start)
        const pt = this.pinfo.portrait, h = Math.min(c.full, pt.fh * c.fw / pt.w);
        if (this.frameH === null || Math.abs(h - this.frameH) > .4) { this.frameH = h; el.style.height = h.toFixed(1) + "px"; }
        return;
      }
      if (!c || !c.tall || !F || !this.stageW) {
        if (this.frameH !== null) { el.style.height = c ? c.full.toFixed(1) + "px" : ""; this.frameH = null; }
        return;
      }
      const steps = i => { const f = F[clamp(i, 0, F.length - 1)];
                           return (Array.isArray(f) ? f : [f]).map(x => typeof x === "number" ? { h: x } : x); };
      let i = 0;
      this.segs.forEach((g, k) => { if (this.T >= g.start) i = k; });
      const local = this.T - this.segs[i].start, here = steps(i);
      let fh = i ? steps(i - 1).at(-1).h : here[0].h;
      for (const x of here) {
        const u = clamp((local - (x.at ?? .1)) / (x.dur ?? 1));
        fh = lerp(fh, x.h, u < .5 ? 4 * u * u * u : 1 - Math.pow(2 - 2 * u, 3) / 2);
      }
      const h = Math.min(c.full, fh * c.fw / this.stageW);
      if (this.frameH === null || Math.abs(h - this.frameH) > .4) { this.frameH = h; el.style.height = h.toFixed(1) + "px"; }
    }
    // the height of the caption block at width w with the scene's longest title (and note); three lines before the
    // scene has said what its titles are
    captionHeight(w) {
      const m = captionMeter(w), caps = this.caps;
      const high = h => { m.innerHTML = `<div class="cap-in">${h}</div>`; return m.offsetHeight; };
      const tallest = (list, wrap) => Math.max(0, ...list.map(h => high(wrap(h))));
      if (!caps || !caps.titles.length) return high("x<br>x<br>x");
      const t = tallest(caps.titles, joinDash);
      if (!caps.subs.length) return t;
      return t + tallest(caps.subs, h => `x<span class="sub">${h}</span>`) - high("x");
    }
    restY() { return topOf(this.el) + this.rest; }   // the scroll position with the stage fully forward
    // a step picked from the list, or stepped to, plays from its start (with reduced motion it shows its last frame);
    // a stage still coming forward is brought forward
    goto(i) {
      this.opening = false;
      this.usedAt = performance.now();   // (settle: the stage is what they want now)
      this.k = i;
      this.T = this.segs[i].start + (REDUCED && this.held ? this.segs[i].dur : 0);
      if (i === 0 && !(REDUCED && this.held)) this.fromLead();
      this.cur = -1;          // restart its clock, even if it is the step already on screen
      this.doneAt = null;
      this.ended = false;
      if (!REDUCED) this.held = false;
      if (sy - topOf(this.el) < this.rest - 2) glideTo(this.restY(), 500);
    }
    // the animation's start, past its still opening (data-lead), which can reach into a later click
    fromLead() {
      this.opening = !REDUCED;
      this.waited = 0;
      this.T = Math.min(this.lead, this.total);
      this.k = 0;
      this.segs.forEach((g, i) => { if (this.T >= g.start - 1e-6 && g.dur > 0) this.k = i; });
    }
    // A swipe left (or the right arrow) goes on to the next click, which plays from its start; on the last click it
    // ends the chapter. A swipe right goes back to the previous click and plays it again. With reduced motion each shows
    // the click's last frame.
    step(dir) {
      this.usedAt = performance.now();
      if (!this.api) return;
      if (dir > 0 && this.timingNext()) return;
      this.select();
      const last = this.segs.length - 1;
      if (dir > 0 && (this.k >= last || this.ended)) {
        if (!REDUCED) { this.k = last; this.T = this.total; this.ended = true; this.held = false; }
        this.flash("next");
        this.deselect();
        return;
      }
      this.goto(clamp(this.k + (dir > 0 ? 1 : -1), 0, last));
      this.flash(dir > 0 ? "next" : "prev");
    }
    // A tap pauses or plays (one that has ended plays from the start); the first one on a box also shows what the
    // gestures do (?timing, recording: a tap on the box asks for the next click instead; pauseOnly, the transport's button)
    tap(pauseOnly) {
      this.usedAt = performance.now();
      // (the tap that lifted Low Power Mode's refusal, unlockVideos, plays: the animation hadn't started to be paused)
      if (performance.now() - (this.thawedAt ?? -1e9) < 400) { this.thawedAt = null; this.select(); this.held = false; this.flash("toggle"); return; }
      if (!pauseOnly && !REDUCED && this.timingNext()) return;
      const first = !this.selected;
      this.select();
      if (!REDUCED) {
        if (this.ended) { this.ended = false; this.fromLead(); this.cur = -1; this.doneAt = null; this.held = false; }
        else this.held = !this.held;
      }
      this.flash(first || REDUCED ? "select" : "toggle");
    }
    // ?timing, recording: a tap or → asks for the next click (js/timing.js), or starts it now over this one ("cut")
    timingNext() {
      const n = TIMING()?.next(this);
      if (!n) return false;
      if (n === "cut") this.cutHere();
      this.select();
      this.held = false;
      this.flash("next");
      return true;
    }
    select() {
      if (this.selected) return;
      if (picked) picked.deselect();
      picked = this;
      this.selected = tapped = true;
      root.classList.add("ctl-used");   // (the transport's note on the keys has done its job)
      this.sync();
    }
    // The box lets go when it leaves the screen, when its animation ends, or when another box is selected. A pause the
    // reader made goes with it, so the chapter plays on when it is next in focus.
    deselect() {
      if (!this.selected) return;
      this.selected = false;
      if (picked === this) picked = null;
      if (!REDUCED) this.held = false;
      this.sync();
    }
    // the box's classes, and what its controls say, for the state it is in now
    sync() {
      const play = this.held || this.ended || this.refused;
      this.box.classList.toggle("selected", this.selected);
      // (a refused animation shows the play glyph whether selected or not: a tap is what it waits for)
      this.box.classList.toggle("paused", (this.selected || this.refused) && play && !REDUCED);
      this.glyph.innerHTML = play ? ICON_PLAY : ICON_PAUSE;
      const steps = TAP === "Tap" ? "swipe \u2190 next \u00b7 swipe \u2192 back" : "arrow keys or swipe to step";
      const what = `${TAP} to ${this.ended ? "replay" : play ? "play" : "pause"}`;
      const line = REDUCED ? steps : this.ended ? what : `${what} \u00b7 ${steps}`;
      this.hintEl.innerHTML = (line.charAt(0).toUpperCase() + line.slice(1))
        .replace(/[←→]/g, '<span class="ctl-ar">$&</span>');   // (the text face's arrows are tiny)
      this.syncTransport();
      wake();
    }
    // the transport's middle button says what pressing it does: pause, play, or play again
    syncTransport() {
      const s = this.ended ? "replay" : this.held || this.refused ? "play" : "pause";
      if (s === this.tpState) return;
      this.tpState = s;
      this.tpPlay.innerHTML = s === "pause" ? ICON_PAUSE : s === "play" ? ICON_PLAY : ICON_REPLAY;
      this.tpPlay.setAttribute("aria-label", s === "pause" ? "Pause" : s === "play" ? "Play" : "Play again");
    }
    // The controls show for a moment (FLASH), then fade: on selecting, the glyph (what a tap does next), the chevrons
    // and a line saying what the gestures do; after a tap, the glyph; after a swipe, its chevron.
    flash(kind) {
      this.sync();
      const o = this.ctl, parts = kind === "select" ? ["prev", "next", "hint", ...(REDUCED ? [] : ["glyph"])]
        : kind === "toggle" ? ["glyph"] : [kind];
      o.className = "ctl";
      void o.offsetWidth;     // (so a repeated flash starts again)
      o.classList.add(...parts.map(p => "show-" + p));
      clearTimeout(this.flashT);
      this.flashT = setTimeout(() => { o.className = "ctl"; }, FLASH * 1e3);
    }
    // the bar: the clicks before the one on screen are full, and that one fills over its playing and its reading hold,
    // so it is full as the next click starts (with reduced motion, as each click shows its last frame)
    progress() {
      const c = this.cur, g = this.segs[c];
      let p = 1;
      if (!REDUCED && !this.ended && g) {
        const end = g.start + g.dur, left = this.T < end - 1e-4 ? this.playLen(this.T, end) : 0;
        const until = c === this.segs.length - 1 ? this.clock + left
          : Math.max((this.doneAt ?? this.clock + left) + HOLD, this.readUntil());
        p = until > this.curAt + 1e-3 ? clamp((this.clock - this.curAt) / (until - this.curAt)) : 1;
        p = Math.max(p, this.played);   // (it never runs back when a title showing late adds reading time)
      }
      this.played = p;
      this.segEls.forEach((s, i) => css(s, "--p", (i < c ? 1 : i > c ? 0 : p).toFixed(3)));
    }
    load() {
      if (this.state !== "idle") return;
      this.state = "loading";
      this.loadAt = performance.now();
      if (this.inline) {
        // a figure drawn in the page loads its pictures (img data-src), and the code and data it is drawn from when they
        // aren't in the page yet (data-scripts: the lava figure's 200 KB of paths), only now
        const name = this.el.dataset.scene, scripts = (this.el.dataset.scripts || "").split(/\s+/).filter(Boolean);
        const go = () => {
          const S = (window.INLINE_SCENES || {})[name];
          if (!S) { this.state = "failed"; return; }
          if (S.load) S.load();
          this.attach(S);
        };
        $$("img[data-src]", this.el).forEach(im => { if (!im.getAttribute("src")) im.src = im.dataset.src; });
        if (!scripts.length || (window.INLINE_SCENES || {})[name]) go();
        else loadScripts(scripts).then(() => { go(); dispatchEvent(new Event("mirror:figure")); wake(); },
                                       () => { this.state = "failed"; wake(); });
        return;
      }
      // the stage stays hidden, and the chapter doesn't play, until the scene has drawn where it starts, with its videos
      // and fonts in (swap, as for a reload in the other layout), so the reader's first sight of it is its opening
      if (!this.swap) { this.swap = { at: null, n: 0, first: true }; this.shown = 0; }
      // on a phone held upright the scene loads its portrait layout, and the frame starts out tall (3:4 until the
      // scene says its size). gen drops a load that was overtaken by a change of layout.
      const gen = ++this.gen, src = this.iframe.dataset.src + (portrait ? "&portrait" : "") + ((this.split = this.beats()) ? "&beats" : "");
      this.mode = portrait;
      if (portrait && !this.el.classList.contains("tall")) this.frameShape(3, 4);
      const want = new URL(src, location.href).href;
      const onload = () => {
        if (gen !== this.gen) return;
        const a = frameAt(this.iframe), S = a && a.S;
        if (!S && a && a.href === "about:blank") return;
        // the browser's Back or Forward took the frame to the page it had at that entry (the other layout): load ours
        if (a && a.href !== want) { a.w.location.replace(want); return; }
        this.iframe.removeEventListener("load", onload);
        if (!S) { this.state = "failed"; return; }
        this.attach(S, gen);
      };
      this.iframe.addEventListener("load", onload);
      // a reload in the other layout replaces the frame's page: a new src would add a history entry, and Back (or a
      // modal's close, js/modal.js) would then take the frame back to the old layout instead of leaving
      const fw = frameAt(this.iframe);   // (null after a failed load: its error page is another origin's, so set src)
      if (fw && fw.href !== "about:blank") fw.w.location.replace(want);
      else this.iframe.src = src;
    }
    // data-beats: each beat of the scene's chained clicks is a click of its own (scene-adapter.js ?beats), to give each its
    // own dwell (data-dwell); the ?timing panel can switch it per chapter
    beats() { const T = TIMING(); return T ? T.beats(this) : this.el.hasAttribute("data-beats"); }
    // the scene's clicks; split into beats (data-beats) or cut (retime), data-speed and data-lead move with the times they
    // were set at (info.remap)
    layoutFrom(info) {
      this.setSegs(info.segs.map(s => s.dur));
      const R = info.remap, at = T => { let p = R[0]; for (const r of R) if (r[0] <= T + 1e-6) p = r; return p[1] + T - p[0]; };
      this.speeds = this.atClicks(R && R.length ? this.speeds0.map(s => s.click != null ? s : { at: s.at ? at(s.at) : 0, v: s.v }) : this.speeds0);
      this.lead = R && R.length ? at(this.lead0) : this.lead0;
    }
    // A dwell shorter than its click (data-dwell, or the ?timing panel's) starts the next click that far in, over the end
    // of this one: its beats play on under the next click's (SCENE.retime). Each cut moves the clicks after it, so they
    // are found one at a time.
    retime() {
      const S = this.api;
      if (!S || !S.retime || !S.overlaps()) return;
      const cuts = [];
      this.layoutFrom(S.retime(cuts));
      for (let k = 0; k < this.segs.length - 1; k++) {
        const d = this.cutDwell(k), g = this.segs[k];
        const a = k === 0 ? Math.min(Math.max(g.start, this.lead), g.start + g.dur) : g.start;
        if (d == null || d >= this.playLen(a, g.start + g.dur) - .02) continue;
        cuts[k] = this.sceneAfter(a, d) - g.start;
        this.layoutFrom(S.retime(cuts));
      }
    }
    cutDwell(k) { const T = TIMING(); return T ? T.cut(this, k) : this.dwell[k] ?? null; }
    // the speed changes in scene time: "#k" changes at click k's start
    atClicks(list) {
      return list.map(s => s.click == null ? s : { at: this.segs[Math.min(s.click, this.segs.length - 1)].start, v: s.v })
        .sort((a, b) => a.at - b.at);
    }
    // the scene time d seconds of playing after scene time a (data-speed)
    sceneAfter(a, d) {
      let T = a;
      for (let i = 0; i < 100 && d > 1e-6; i++) {
        const v = this.speedAt(T), next = this.speeds.find(s => s.at > T + 1e-6), room = next ? (next.at - T) / v : Infinity;
        if (d <= room) return T + d * v;
        d -= room;
        T = next.at;
      }
      return T;
    }
    // ?timing, recording: a tap while the click plays starts the next one now, over the end of this one
    cutHere() {
      const k = this.k;
      TIMING()?.advanced(this, k, this.clock - this.curAt, this.siteUntil() - this.curAt);
      this.k = k + 1;
      this.doneAt = null;
      this.retime();
    }
    // the frame's shape: the deck's 16:9 (w = 0), or a scene's tall portrait stage
    frameShape(w, h) {
      this.el.classList.toggle("tall", !!w);
      if (w) { this.el.style.setProperty("--scene-ar", `${w} / ${h}`); this.el.style.setProperty("--scene-r", (w / h).toFixed(4)); }
      this.fitCard();
    }
    // the layout changed between landscape and portrait: the scene loads again in the other one when it next comes near
    reset() {
      this.gen++;
      this.api = null;
      this.parked = false;
      this.state = "idle";
      this.capHTML = null;
      this.frameShape(0);
      this.shown = 0;         // hidden until the scene has drawn again, so the box never shows blank or half drawn
      this.swap = { at: null, n: 0 };
    }
    attach(S, gen) {
        S.ready.then(info => {
          if (gen !== undefined && gen !== this.gen) return;
          if (!info) { this.state = "failed"; return; }
          this.api = S;
          this.state = "ready";
          this.refused = this.unlocked = false;   // (a new scene page: new clips, Low Power Mode, unlockVideos)
          S.setNarrow(narrow || short);
          if (!this.inline) this.frameShape(info.h > info.w ? info.w : 0, info.h);
          this.caps = S.captions ? S.captions() : null;
          this.fill = info.fill || null;
          this.stageW = info.w;
          this.fitCard();
          // the scene's own timing wins over the one written into the page (exactly, so its beats line up with the clicks;
          // the page lays itself out again only if it was off), with any cuts (retime)
          const was = this.segs.map(g => g.dur);
          this.layoutFrom(info);
          this.retime();
          const durs = this.segs.map(g => g.dur);
          if (durs.length !== was.length || durs.some((d, i) => Math.abs(d - was[i]) > .02)) relayout();
          // reduced motion: the first click's last frame
          if (REDUCED && this.T === 0) this.T = this.segs[0].dur;
          else if (this.T === 0) this.fromLead();
          if (this.swap) this.swap.at = performance.now();
          // the frame loop draws it, and a video in it that finishes seeking or loading gets drawn again (wake); a clip or
          // image coming in may let the next scene load (schedule)
          if (!this.inline) try {
            for (const ev of ["seeked", "loadeddata", "canplay", "canplaythrough", "suspend", "load", "error"])
              this.iframe.contentDocument.addEventListener(ev, wake, true);
          } catch (e) {}
          wake();
        });
    }
    style(y) {
      if (this.noHead) { this.stageO = 1; return; }   // part of the page: it just scrolls in and out
      const a = y / this.headLen;                     // < 0 while the chapter rises into view
      // the headline rises in with the chapter, holds, then lifts away as the stage comes forward
      const hin = smooth(-.62, -.1, a), hout = smooth(.26, .6, a), ho = hin * (1 - hout);
      css(this.head, "opacity", ho.toFixed(3));
      css(this.head, "visibility", ho < .003 ? "hidden" : "visible");
      css(this.head, "transform", `translate3d(0,${(-hout * 9).toFixed(2)}vh,0) scale(${(1 - .04 * hout).toFixed(4)})`);
      // the stage waits faintly behind it, then comes forward; it dissolves as it scrolls away
      const r = smooth(.42, .88, a), e = clamp((y - this.pinLen) / vh);
      const o = r * (1 - smooth(0, .55, e));
      const sc = lerp(.9, 1, r) * (1 - .05 * smooth(0, 1, e));
      this.stageO = o;
      // (with its poster standing in, the stage comes forward as usual and the poster fades out over the scene)
      const cover = this.covers(), so = o * (cover ? 1 : this.shown);
      if (this.poster) {
        // The poster lies over the scene's frame, and the frame stays fully drawn under it: iOS Safari doesn't start a
        // clip in a frame at opacity 0, so with the scene fading in over its poster the first animation's opening clip
        // never played, and every iPhone visit waited out the 8 s limit behind the poster (10-16). A poster still on its
        // way (or fading in, .3 s) leaves the frame hidden until the scene shows, as without one.
        const fade = cover && this.shown > 0 && !this.refused;
        css(this.poster, "transition", fade ? "none" : "");
        css(this.poster, "opacity", fade ? (1 - this.shown).toFixed(3) : cover ? "" : "0");
        css(this.iframe, "opacity", cover && !this.posterUp() ? this.shown.toFixed(3) : "");
      }
      css(this.stage, "opacity", so.toFixed(3));
      // (not while it holds the focus: Chrome drops the focus from a hidden box, and a Tab onto a box lands while the
      // stage is still faint, before the glide brings it forward)
      css(this.stage, "visibility", so < .003 && !this.stage.contains(document.activeElement) ? "hidden" : "visible");
      css(this.stage, "transform", `scale(${sc.toFixed(4)})`);
    }
    // in focus: the stage has come forward (or, without a headline, is mostly on screen) and hasn't dissolved yet
    inFocus(y) {
      if (this.noHead) return y > -.4 * vh && y < this.pinLen + .35 * vh;
      return y >= Z0 * this.headLen && this.stageO > .5;
    }
    update(now, dt) {
      const y = sy - topOf(this.el);
      // Back or Forward across an entry made before the scene last reloaded (the modal's close is a Back) takes its frame
      // back to the page it had then, which isn't the scene this chapter holds: start over with the layout of now
      if (this.api && !this.inline && frameAt(this.iframe)?.S !== this.api) this.reset();
      // (its scene loads when schedule says, below)
      const visible = y > -vh && y < this.pinLen + vh;
      // scrolled past, or far below the screen again: its clips still on their way give way to what the reader is on
      // and coming to (SCENE.park), and go on once that is in (background) or the reader is back
      if (this.api && !this.inline && this.api.park) {
        const gone = !visible && (y > 0 || !this.wanted);
        if (gone !== this.parked) { this.parked = gone; if (gone) this.api.park(); else this.api.resume(); }
      }
      // (perf2 10-16: and once on the first frame, so a chapter the reader hasn't reached yet starts out hidden, as one
      // scrolled past is: its scene's frame then doesn't render behind every frame while it waits far down the page)
      if (visible || this.wasVisible || !this.styled) { this.style(y); this.styled = true; }
      // (perf2 10-16) a figure drawn in the page (no headline, so style() never hides it) is hidden while it is more than
      // .6 of a screen off the screen: off the screen it still cost every scroll frame its paint and layer updates
      // (both figures: ~15% of the main thread's time). The margin keeps a fast flick from showing it a frame late.
      if (this.noHead) {
        const near = y > -1.6 * vh && y < this.pinLen + 1.6 * vh;
        if (near !== this.near && (near || !this.stage.contains(document.activeElement))) {
          this.near = near;
          css(this.stage, "visibility", near ? "" : "hidden");
        }
      }
      if (this.selected && this.stageO * this.shown < .05) this.deselect();   // (dissolved: as good as off the screen)
      // a chapter that played to its end plays from the start when the reader comes to it again from above
      if (visible && !this.wasVisible && y < 0 && this.ended) { this.ended = false; this.fromLead(); this.cur = -1; }
      // (a scene that failed to load shows its poster, or its empty box)
      if (this.state === "failed") { this.swap = null; if (this.poster) this.shown = 0; }
      // (it holds its opening while the stage fades in after a load)
      this.live = !!this.api && !this.swap && this.shown >= 1 && visible && this.wasVisible && this.inFocus(y) && !this.held && !this.ended && !this.refused && !covered();   // (covered: a modal opened by Forward or a typed #hash ran the chapter behind it)
      // coming into focus, the transport shows for a while, until the reader has used the controls (cue, below)
      const foc = !!this.api && this.shown >= 1 && visible && this.inFocus(y);
      if (foc && !this.foc && !tapped) this.cue(0, 3.2);
      this.foc = foc;
      if (visible) this.syncTransport();
      this.rate = 0;
      if (this.live) this.play(dt);
      if (visible && this.api) this.settle(y, now);
      if (this.api) {
        if (visible) {
          this.api.render(this.T, { rate: this.rate, visible: this.stageO > .04 });
          if (narrow || short) this.fillFrame();
          if ((narrow || short) && this.capEl) this.caption();
          this.updateBeats();
          // reloaded in the other layout: the stage fades back in once the scene has drawn the click it was on (a few
          // frames, with its videos done seeking, or 0.6 s at most)
          const w = this.swap;
          // (a first load waits up to FIRST_MAX seconds of its stage on the screen for slow videos, FIRST_MAX_BARE
          // without a poster); once it shows, the rest of its images load (SCENE.more)
          if (w && w.at !== null) {
            w.n++;
            if (this.stageO > .3) w.on = (w.on || 0) + dt;
            if (w.n > 2 && !this.seeking(w.first) || (w.first ? w.on > (this.poster ? FIRST_MAX : FIRST_MAX_BARE) : w.n > 36)) {
              this.swap = null;
              if (this.api.more) this.api.more();
            }
          }
        } else if (this.wasVisible) this.api.pause();
      } else if (visible && this.pinfo && (narrow || short) && this.capEl && this.capHTML === null && this.covers()) {
        this.caption(portrait && this.pinfo.pcap || this.pinfo.cap);   // the title the scene opens on, over its poster
      }
      if (!this.swap && this.shown < 1 && !(this.poster && this.state === "failed"))
        this.shown = REDUCED ? 1 : Math.min(1, this.shown + dt / .25);
      // the poster goes once the scene has faded in over it
      if (this.poster) css(this.poster, "display", this.api && this.shown >= 1 && !this.refused ? "none" : "");
      // the frame loop keeps running while this chapter plays (or holds between clicks), or fades back in (wake)
      this.busy = this.live || (!this.swap ? this.shown < 1 : visible && this.swap.at !== null);
      // a slow connection: a spinner shows once the stage, in place, has waited 0.6 s for its scene (over its poster), a
      // click for its videos, or a figure for its code (css .wait)
      const spin = visible && this.stageO > .5 && (this.shown < .05 && this.state !== "failed" || this.live && this.stall > .6
        || this.inline && this.state === "loading");
      this.waitAt = spin ? this.waitAt ?? now : null;
      this.el.classList.toggle("wait", spin && now - this.waitAt > 600);
      this.el.classList.toggle("failed", this.state === "failed");
      this.busy ||= spin;
      // a phone held sideways: the nav makes way while the stage holds the screen (relayout, the frame loop)
      this.staged = visible && (this.noHead ? y > -.2 * vh && y < this.pinLen + .2 * vh : this.stageO > .5);
      this.wasVisible = visible;
    }
    retryLoad() {
      if (this.state !== "failed") return;
      if (this.inline) this.state = "idle"; else this.reset();
      wake();
    }
    starved(dt) {
      let s = false;
      if (!this.inline) try { s = [...this.iframe.contentDocument.querySelectorAll("video")].some(v => v.style.visibility === "visible"
        && v.currentSrc && !v.error && v.readyState < 1 && v.networkState === 2)
        || !!(this.api && this.api.starved && this.api.starved()); } catch (e) {}   // (a scene drawing its clips: scene-adapter.js)
      else s = !!(this.api && this.api.starved && this.api.starved());   // (a figure drawn in the page: its clip, js/lava.js)
      // (only a video that hasn't even its size yet: iOS Safari decodes no frame of a paused video until it plays, so
      // waiting for one held the click for good on a phone, while the clip had long downloaded)
      // (a scene drawing its clips that still draws new frames is catching up: its 8 s count from the last one. Counted
      // from the first, a slow connection's earlier waits used them up, and the waterfall episode ran on without its clip)
      const n = this.api && this.api.drawn ? this.api.drawn() : 0;
      if (n !== this.drawnN) { this.drawnN = n; this.stall = 0; }
      this.stall = s ? (this.stall || 0) + dt : 0;
      return s && this.stall < 8;
    }
    seeking(first) {
      // a video on show that is seeking, or has no frame yet; an image on show still loading; or the scene's fonts
      // (only the videos on show: a clip fetched ahead for a later click doesn't hold the frame on the screen. For a
      // first showing, a clip with its frame in counts even while it seeks: the opening is its first frames anyway, and
      // on an iPhone a seek of a clip that hadn't played could hang until the page gave up, FIRST_MAX)
      try { const d = this.iframe.contentDocument;
            return d.fonts.status !== "loaded" || !!(this.api && this.api.waiting && this.api.waiting())
              || [...d.querySelectorAll("video")].some(v => v.currentSrc && !v.error && v.style.visibility !== "hidden"
                && +(v.style.opacity || 1) > 0 && (v.seeking && !(first && v.readyState >= 2) || v.readyState < 1)); }
      catch (e) { return false; }
    }
    // the speed at scene time T (data-speed)
    speedAt(T) {
      let v = 1;
      for (const s of this.speeds) if (s.at <= T + 1e-6) v = s.v;
      return v;
    }
    // seconds of the reader's time that scene times a to b take to play
    playLen(a, b) {
      let t = 0;
      this.speeds.forEach((s, i) => {
        const lo = Math.max(a, i ? s.at : -Infinity), hi = Math.min(b, i + 1 < this.speeds.length ? this.speeds[i + 1].at : Infinity);
        if (hi > lo) t += (hi - lo) / s.v;
      });
      return t;
    }
    // One frame of playing: the click runs to its end at the chapter's speed (the scene's videos play natively at that
    // rate), then holds its last frame until its text has had time to be read, and the next click follows. The last
    // click holds, and the chapter has ended.
    play(dt) {
      // the opening holds for its wait first (data-wait, or the ?timing panel's), its clock and bar with it
      if (this.opening) {
        const w = this.openWait();
        // (counted only once the stage has come fully forward and the page has stopped: not while it glides in)
        if (w != null && this.waited < w) { if (this.still()) this.waited += dt; this.rate = 0; return; }
        if (w != null) TIMING()?.started(this, this.waited);
        this.opening = false;
      }
      const g = this.segs[this.k], end = g.start + g.dur;
      if (this.T < g.start) this.T = g.start;
      // a slow connection: a video on show with no frame yet (or fetching the one it was sent to) holds the click, its
      // clock and bar with it, rather than it playing on over an empty or frozen frame (starved; 8 s at most)
      if (this.T < end - 1e-4 && this.starved(dt)) return;
      this.clock += dt;
      if (this.T < end - 1e-4) {
        // a change of speed within the frame takes effect where it falls
        let v = this.speedAt(this.T), T = this.T + dt * v;
        const next = this.speeds.find(s => s.at > this.T + 1e-6);
        if (next && T > next.at) T = next.at + (dt - (next.at - this.T) / v) * next.v;
        this.T = Math.min(end, T);
        this.rate = v;
        this.doneAt = null;
        return;
      }
      this.T = end;
      if (this.k === this.segs.length - 1) { this.ended = true; this.deselect(); return; }
      if (this.doneAt === null) this.doneAt = this.clock;
      if ((this.dwellAt(this.cur) != null || this.clock - this.doneAt >= HOLD) && this.clock >= this.readUntil()) {
        TIMING()?.advanced(this, this.cur, this.clock - this.curAt, this.siteUntil() - this.curAt);
        this.k++;
        this.doneAt = null;
      }
    }
    // a click's dwell set by hand (seconds from its start, exactly): the ?timing panel's, or data-dwell (own: data-dwell only)
    // the stage is fully forward (a figure: pinned) and the page isn't moving
    still() {
      const y = sy - topOf(this.el), now = performance.now();
      if (sy !== this.stillY) { this.stillY = sy; this.stillAt = now; }   // (and hasn't scrolled for STILL seconds)
      return !glide && !scrolling(now) && now - this.stillAt > STILL * 1e3
        && (this.noHead ? y > -2 && y < this.pinLen + 2 : this.stageO > .98);
    }
    openWait() { const T = TIMING(); return T ? T.wait(this) : this.wait; }
    dwellAt(c, own) { const T = TIMING(); return !own && T ? T.dwell(this, c) : this.dwell[c] ?? null; }
    // when the page's own timing (without the ?timing panel) moves on from the click on screen, once it has played
    siteUntil() { return Math.max(this.dwellAt(this.cur, true) != null ? 0 : (this.doneAt ?? this.clock) + HOLD, this.readUntil(true)); }
    // when the click on screen has been read (clock), the later of: its data-read value, counted from the click's start (for the first
    // click, from where it plays from, past its still opening); the word count, from when the text (the step in the
    // list, or the scene's title as it is now) first showed, which can be late in a long click
    readUntil(own) {
      const c = this.cur, d = this.segs[c] ? this.segs[c].dur : 0;
      const w = this.dwellAt(c, own);
      if (w != null) return this.curAt + w;
      let t = this.curAt + .4;
      if (this.read[c] != null) {
        const a = this.segs[c].start, from = c === 0 ? Math.min(Math.max(a, this.lead), a + d) : a;
        t = this.curAt + this.playLen(from, a + d) + Math.max(0, (this.read[c] - d) * READ_PACE);
      }
      const text = this.stepList ? (this.dots[c] || {}).textContent || "" : this.capText;
      const words = text.split(/\s+/).filter(Boolean).length;
      if (words) t = Math.max(t, (this.stepList ? this.curAt : this.capAt) + words / READ_WPS);
      return t;
    }
    // The caption fades with the scene's title and note (c.o, c.so). When it changes height, its grey top (a layer
    // behind it at --cap-top, css/site.css) and its text glide to the new height together, so the box never jumps.
    caption(c = this.api.caption()) {
      // a resize of the caption block (fitCard, fitShort, fonts) has it re-measure its grey top
      // (only re-measures: rewriting the text on each resize had the live region announce the same caption ~37 times in
      // a second on a phone, with every step of fitCard's settling)
      if (!this.capRO) (this.capRO = new ResizeObserver(() => { this.capMeasure = true; })).observe(this.capEl);
      const html = c ? `<div class="cap-in"><span class="cap-t">${joinDash(c.html)}</span>${c.sub ? `<span class="sub"${c.subColor ? ` style="color:${c.subColor}"` : ""}>${c.sub}</span>` : ""}</div>` : "";
      // a title that reveals word by word (its spans' inline opacity, copied every frame) changes only its styles: those
      // are set in place, as rewriting it all had the live region announce the same caption ~37 times in a second
      const key = html.replace(/ style="[^"]*"/g, "");
      if (html !== this.capHTML && this.capHTML !== null && key === this.capKey) {
        const t = document.createElement("template");
        t.innerHTML = html;
        // (matched by the scene's span ids: the page sets styles of its own on the wrapper, .cap-in and .cap-t)
        const want = t.content.querySelectorAll("[id]"), have = this.capEl.querySelectorAll("[id]");
        if (want.length && want.length === have.length && [...want].every((w, i) => w.id === have[i].id)) {
          want.forEach((w, i) => { const st = w.getAttribute("style") || ""; if ((have[i].getAttribute("style") || "") !== st) have[i].setAttribute("style", st); });
          this.capHTML = html;
        }
      }
      if (html !== this.capHTML) {
        this.capKey = key;
        const old = this.capEl.firstElementChild, tf = old ? getComputedStyle(old).transform : "none";
        const from = old ? old.offsetTop + (tf === "none" ? 0 : new DOMMatrix(tf).m42) : null;
        this.capHTML = html;
        this.capEl.innerHTML = html;
        const el = this.capEl.firstElementChild, top = el ? el.offsetTop : this.capEl.offsetHeight;
        // a caption arriving where there was none (the scene has just loaded) shows at once, grey and all
        if (!old) this.capEl.style.setProperty("--cap-dur", "0s");
        this.capEl.style.setProperty("--cap-top", top + "px");
        if (!old) { void getComputedStyle(this.capEl, "::before").transform; this.capEl.style.removeProperty("--cap-dur"); }
        if (el && from !== null && Math.abs(from - top) > .5) {   // the text starts where the old text was
          el.style.transition = "none";
          el.style.transform = `translateY(${(from - top).toFixed(1)}px)`;
          void el.offsetWidth;
          el.style.transition = el.style.transform = "";
        }
        this.capO = this.capSO = null;
      } else if (this.capMeasure) {
        const el = this.capEl.firstElementChild;
        this.capEl.style.setProperty("--cap-top", (el ? el.offsetTop : this.capEl.offsetHeight) + "px");
      }
      this.capMeasure = false;
      if (!c) return;
      const el = this.capEl.firstElementChild;
      const o = c.o.toFixed(2), so = c.so.toFixed(2);
      if (o !== this.capO) { this.capO = o; el.firstElementChild.style.opacity = o; }
      if (c.sub && so !== this.capSO) { this.capSO = so; el.lastElementChild.style.opacity = so; }
    }
    // A reader who stops while the headline lifts away and the stage comes forward is carried through the change, the
    // way they were scrolling: on to the stage, fully forward, or back to the headline.
    settle(y, now) {
      // (not while a jump to an #anchor lands: the browser's jump reads as a move up when the anchor is above, and the
      // chapter before it would pull the reader back into its stage. With reduced motion the carry is a jump, glideTo)
      if (glide || scrolling(now) || comeBack || now < noSnapUntil) return;
      // Just after the reader used the animation (USED: a swipe, a tap, a key), it is the stage they want, whichever way
      // the page last moved. A swipe's first pixels can scroll the page, as often up as down; short of its stage, a swipe
      // that had moved the page a pixel or two up was then carried back to the headline, as if taken for a scroll.
      const toStage = now - (this.usedAt ?? -1e9) < USED * 1e3;
      // ... and one who stops while the stage scrolls away is carried on to what follows, or back to the full stage
      // (the strip under the nav doesn't count: an #anchor lands with the stage that much short of gone, faded out)
      if (y > this.pinLen + 2 && y < this.pinLen + vh - $(".localnav").offsetHeight - 2) {
        glideTo(readerDir < 0 || toStage ? topOf(this.el) + this.pinLen : topOf(this.el) + this.pinLen + vh, 450);
        return;
      }
      if (this.noHead) return;
      const a = y / this.headLen;
      if (a <= SETTLE || a >= REST - .01) return;
      glideTo(readerDir < 0 && !toStage ? topOf(this.el) + .1 * this.headLen : this.restY(), 450);
    }
    updateBeats() {
      // the scene's title, and when it last changed
      if (!this.stepList) {
        const c = this.api.caption(), t = c ? (c.html + " " + (c.sub || "")).replace(/<[^>]*>/g, " ").trim() : "";
        if (t !== this.capText) { this.capText = t; this.capAt = this.clock; }
      }
      // the click being played counts from its very start (a step picked from the list lights at once, not the one
      // before it)
      let cur = clamp(this.k, 0, this.segs.length - 1);
      this.segs.forEach((s, i) => { if (this.T >= s.start + .05) cur = Math.max(cur, i); });
      // a click's clock starts as it starts playing (click 0 waits through the headline, with the stage still faint)
      if (cur !== this.cur || (cur === 0 && this.T < this.segs[0].start + .05)) {
        // (recording, ?timing: the cuts before the click on screen stand, and those from it on go until tapped again)
        if (cur !== this.cur && TIMING()?.recording()) this.retime();
        this.cur = cur;
        this.curAt = this.clock;
        this.played = 0;
        if (cur === 0) this.capAt = this.clock;
      }
      // a written step list lights the current step and shows how far it has played
      this.dots.forEach((d, i) => {
        d.classList.toggle("on", i === cur);
        d.classList.toggle("done", i < cur);
        const s = this.segs[i], p = i === cur ? clamp((this.T - s.start) / s.dur) : 0;
        css(d, "--p", p.toFixed(3));
      });
      this.progress();
    }
  }

  // ------------------------------------------------------------------ controls: progress, then select, pause and step
  // Each animation's box (the frame of a scene, or the figure drawn in the page) has a thin bar along its bottom, one
  // segment per click (progress). A tap or click pauses or plays, a swipe left goes on to the next click and a swipe
  // right back to the previous one (the content moves with the finger, as a carousel pages), each showing its control
  // for a moment (flash). On a desktop the arrow keys, a sideways trackpad swipe and a mouse drag step too, and Enter
  // or Space on a focused box pause. A finger's first move decides: mostly sideways, and the box keeps the gesture (the
  // page doesn't scroll under it); otherwise the page scrolls as usual.
  // Each box also has a transport: previous, pause or play, and next, as buttons that work at once (nothing to select
  // first), with a note on the keys (or the swipe) until the reader has used the controls. On a wide screen it floats
  // over the bottom of the box, shown while the pointer moves over the box, as the chapter comes into focus and after a
  // key (cue), and always on a touch screen. Where there is room it sits under the box instead and stays (html.ctl-below:
  // narrow screens, where fitCard keeps CTL_ROOM for it, and wide ones with room under the frame); on a phone held
  // sideways it stands beside the box (fitShort). css/site.css "controls: the transport".
  const FLASH = 1.1;      // seconds the controls show before they fade (css: .45 s)
  const SWIPE = 40;       // px the mouse moves sideways, and 1.5 times as far as up or down, to step
  const FLICK = 30;       // px a finger moves sideways, once the gesture is the box's, to step
  const LOCK = 8;         // px a finger moves before the gesture's direction is decided
  const LOCK_RATIO = 1.5; // how much more sideways than up or down a move must be to count as a swipe
  const SWIPE_LATE = 1.5, SWIPE_RATIO = 1.2;   // a swipe the page began scrolling: FLICKs sideways, and how much more than up or down
  const ICON_PAUSE = '<svg viewBox="0 0 36 36"><rect x="11.5" y="10" width="4.6" height="16" rx="1.4"/><rect x="19.9" y="10" width="4.6" height="16" rx="1.4"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 36 36"><path d="M13.2 10.4v15.2c0 .9 1 1.4 1.7.9l12-7.6c.7-.4.7-1.4 0-1.8l-12-7.6c-.7-.5-1.7 0-1.7.9z"/></svg>';
  const CHEVRON = '<svg viewBox="0 0 24 24"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>';
  const ICON_REPLAY = '<svg class="st" viewBox="0 0 24 24"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/></svg>';
  const KEY = d => `<kbd><svg viewBox="0 0 12 12"${d > 0 ? ' style="transform:scaleX(-1)"' : ""}><path d="M10 6H2.5M5.5 3L2.5 6l3 3"/></svg></kbd>`;
  let picked = null;      // the selected chapter
  let tapped = false;     // the reader has selected a box (the first chapter's hint has done its job)
  const boxIO = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) { const c = chapters.find(x => x.box === e.target); if (c) c.deselect(); }
  }));
  // Shift+Tab out of a chapter: the focus goes to whatever Tab reaches before it (the stand-ins below take a Shift+Tab
  // from inside their chapter back in again: at BASALT it cycled between its link and a stand-in for ever)
  const TABBABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
  function focusBefore(el) {
    const prev = $$(TABBABLE).filter(x => !el.contains(x) && (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      && !x.closest("[inert]") && x.getClientRects().length && getComputedStyle(x).visibility !== "hidden");
    const x = prev[prev.length - 1];
    if (x) x.focus(); else document.activeElement?.blur();
  }
  function controls(c) {
    const box = c.box;
    box.classList.add("ctl-box");
    box.tabIndex = 0;
    box.setAttribute("role", "group");
    box.setAttribute("aria-roledescription", "animation");
    const name = c.iframe ? c.iframe.title : `Figure: ${($(".eyebrow", c.el) || {}).textContent || ""}`;
    box.setAttribute("aria-label", `${name}. Enter pauses or plays it, and the arrow keys step through it.`);
    // Tab reaches the box through a stand-in: the stage is hidden while its chapter is off the screen, and Tab skips a
    // hidden box. The stand-in brings the stage forward and hands the focus on (not on a Shift+Tab back out of the box)
    const tabIn = document.createElement("button");
    tabIn.type = "button";
    tabIn.className = "visually-hidden";
    tabIn.textContent = name;
    c.el.prepend(tabIn);
    const toBox = () => {
      glide = null;
      scrollSelf(c.restY());
      css(c.stage, "visibility", "visible");
      box.focus({ preventScroll: true });
    };
    tabIn.addEventListener("focus", e => { if (!c.el.contains(e.relatedTarget)) toBox(); else focusBefore(c.el); });
    const headLink = c.head ? $("a[href]", c.head) : null;
    const toLink = () => {
      glide = null;
      scrollSelf(topOf(c.el) + .1 * c.headLen);
      css(c.head, "visibility", "visible");
      headLink.focus({ preventScroll: true });
    };
    // Shift+Tab from the box: to the headline's link where there is one, else out of the chapter
    box.addEventListener("keydown", e => {
      if (e.key !== "Tab" || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.target !== box) return;
      e.preventDefault();
      if (headLink) toLink(); else focusBefore(c.el);
    });
    // a link in the headline (BASALT's "Watch all 44 evaluation episodes") is hidden while the stage is forward, so Tab
    // skipped it: a stand-in before the box's brings the headline back and hands the focus on, and Tab from the link
    // goes on to the box
    for (const link of c.head ? $$("a[href]", c.head) : []) {
      const standIn = document.createElement("button");
      standIn.type = "button";
      standIn.className = "visually-hidden";
      standIn.textContent = link.textContent;
      c.el.prepend(standIn);
      standIn.addEventListener("focus", e => {
        if (c.el.contains(e.relatedTarget)) { focusBefore(c.el); return; }
        glide = null;
        scrollSelf(topOf(c.el) + .1 * c.headLen);
        css(c.head, "visibility", "visible");
        link.focus({ preventScroll: true });
      });
      link.addEventListener("keydown", e => {
        if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        if (e.shiftKey) focusBefore(c.el); else toBox();
      });
    }
    box.insertAdjacentHTML("beforeend", '<div class="ctl" aria-hidden="true"><span class="ctl-side ctl-prev">' + CHEVRON +
      '</span><span class="ctl-glyph"></span><span class="ctl-side ctl-next">' + CHEVRON + '</span><span class="ctl-hint">' +
      '</span></div><div class="pbar" aria-hidden="true"></div>');
    c.ctl = $(".ctl", box);
    c.glyph = $(".ctl-glyph", box);
    c.hintEl = $(".ctl-hint", box);
    c.bar = $(".pbar", box);
    c.setSegs(c.segs.map(s => s.dur));
    boxIO.observe(box);
    // the transport. A scene's frame clips what it holds, so a scene's transport sits in the stage beside the frame; a
    // figure drawn in the page holds its own.
    const tp = document.createElement("div"), chev = CHEVRON.replace("<svg", '<svg class="st"');
    tp.className = "ctl-bar";
    tp.setAttribute("role", "group");
    tp.setAttribute("aria-label", "Animation controls");
    tp.innerHTML = `<button type="button" class="ctl-btn ctl-b-prev" data-dir="-1" aria-label="Previous step">${chev}</button>` +
      '<button type="button" class="ctl-btn ctl-b-play"></button>' +
      `<button type="button" class="ctl-btn ctl-b-next" data-dir="1" aria-label="Next step">${chev}</button>` +
      `<span class="ctl-tip" aria-hidden="true">${tipText()}</span>`;
    (c.inline ? box : c.stage).append(tp);
    c.tp = tp;
    c.tpPlay = $(".ctl-b-play", tp);
    c.syncTransport();
    const [tpPrev, , tpNext] = tp.querySelectorAll("button");
    tp.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (b) { if (b.dataset.dir) c.step(+b.dataset.dir); else c.tap(true); }
    });
    // shown for s seconds (wide screens, css), with the button a key stands for lit for a moment
    let tpT = 0, hitT = 0;
    c.cue = (dir, s = 1.8) => {
      tp.classList.add("awake");
      clearTimeout(tpT);
      tpT = setTimeout(() => tp.classList.remove("awake"), s * 1e3);
      if (!dir) return;
      const b = dir > 0 ? tpNext : tpPrev;
      b.classList.add("hit");
      clearTimeout(hitT);
      hitT = setTimeout(() => b.classList.remove("hit"), 260);
    };
    for (const el of [box, tp]) el.addEventListener("pointermove", e => { if (e.pointerType !== "touch") c.cue(0, 2.4); });
    // a finger: a tap, or a sideways swipe. Touch events rather than pointer events, since only a cancelled touchmove
    // stops the page from scrolling (with touch-action: pan-y a slightly diagonal swipe still scrolls, and the browser
    // then cancels the pointer).
    let f = null;
    box.addEventListener("touchstart", e => {
      const t = e.touches[0];
      f = e.touches.length > 1 || e.target.closest(".ctl-bar") ? null : { x: t.clientX, y: t.clientY, t: e.timeStamp, dir: null, moved: false,
        stop: !!glide || performance.now() < holdUntil };   // (the page was still moving: a finger landing to stop it)
    }, { passive: true });
    box.addEventListener("touchmove", e => {
      if (!f) return;
      if (e.touches.length > 1) { f = null; return; }
      const t = e.touches[0], dx = t.clientX - f.x, dy = t.clientY - f.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) f.moved = true;
      // (only a clearly sideways start is a swipe: a thumb's scroll often arcs sideways for its first few px)
      if (!f.dir && Math.max(Math.abs(dx), Math.abs(dy)) > LOCK) f.dir = Math.abs(dx) > LOCK_RATIO * Math.abs(dy) ? "x" : "y";
      // (before the direction is decided, only a clearly sideways move: Safari lets a swipe scroll or not by its first
      // touchmove, and a finger's first pixel or two of jitter at the start of a scroll up or down is often sideways.
      // "Clearly" is LOCK_RATIO, as for the decision itself: at twice, a thumb's swipe that set off at -5, +3 (an iPhone,
      // 10-17) was left to scroll)
      const side = !f.dir && Math.abs(dx) >= 3 && Math.abs(dx) > LOCK_RATIO * Math.abs(dy);
      if ((f.dir === "x" || side) && e.cancelable) e.preventDefault();   // the box's: no scrolling
      f.dx = dx; f.dy = dy;
    }, { passive: false });
    let gestureAt = -1e9;   // the last tap or swipe the touch or pointer handlers took (click, below)
    box.addEventListener("touchend", e => {
      if (!f) return;
      const s = f;
      f = null;
      gestureAt = performance.now();
      // a swipe: the box's from its start, or one Safari began scrolling (it decides on the first pixels, which are often
      // diagonal) that still went clearly more sideways than up or down
      const sideways = Math.abs(s.dx) > SWIPE_LATE * FLICK && Math.abs(s.dx) > SWIPE_RATIO * Math.abs(s.dy || 0);
      if ((s.dir === "x" && Math.abs(s.dx) > FLICK) || sideways) c.step(s.dx < 0 ? 1 : -1);
      // (a finger that lands to stop the page gliding or coasting on isn't a tap)
      else if (!s.moved && !s.stop && e.timeStamp - s.t < 800) { e.preventDefault(); c.tap(); }   // (and no click after it)
    }, { passive: false });
    box.addEventListener("touchcancel", () => { f = null; });
    // the mouse or a pen: a click, or a sideways drag
    let g = null;
    box.addEventListener("pointerdown", e => {
      g = e.pointerType === "touch" || e.button > 0 || !e.isPrimary || e.target.closest(".ctl-bar") ? null
        : { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, side: false, moved: false };
      if (g && e.pointerType === "mouse") box.setPointerCapture(e.pointerId);
    });
    box.addEventListener("pointermove", e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dx) > SWIPE && Math.abs(dx) > 1.5 * Math.abs(dy)) g.side = true;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) g.moved = true;
    });
    box.addEventListener("pointerup", e => {
      if (!g || e.pointerId !== g.id) return;
      const s = g, dx = e.clientX - g.x;
      g = null;
      gestureAt = performance.now();
      if (s.side && Math.abs(dx) > SWIPE) c.step(dx < 0 ? 1 : -1);
      else if (!s.moved && e.timeStamp - s.t < 800) c.tap();
    });
    box.addEventListener("pointercancel", () => { g = null; });   // the browser took it: the page scrolls
    // a click that came without them: WebKit sends only a click for a touch over a scene's frame (the iframe under the
    // box), and so does a screen reader activating the box
    box.addEventListener("click", e => {
      if (performance.now() - gestureAt < 300 || e.target.closest(".ctl-bar, a, button")) return;   // (it was one of them)
      c.tap();
    });
    box.addEventListener("dragstart", e => e.preventDefault());
    // Tab onto a scene's box: the browser scrolls the least it can to show it, which is the chapter's top, where the
    // stage is still faint behind the headline. Bring the stage forward instead.
    box.addEventListener("focus", () => requestAnimationFrame(() => {
      const y = scrollY - topOf(c.el);
      if (!c.noHead && (y < Z0 * c.headLen || y > c.pinLen)) glideTo(c.restY(), 450);
    }));
    // a sideways trackpad swipe: one step per gesture (it ends once its events stop for 0.3 s, momentum included). With
    // natural scrolling, fingers moving left send positive deltaX: next, as a finger on a phone.
    const w = { at: -1e9, sum: 0, done: false };
    const wheel = e => {
      if (Math.abs(e.deltaX) <= 1.5 * Math.abs(e.deltaY)) return;   // up or down: the page scrolls
      e.preventDefault();     // (and the browser doesn't take it as going back a page)
      // (momentum never turns back: a clear move the other way is a new gesture, however soon it follows)
      if (e.timeStamp - w.at > 300 || w.sum * e.deltaX < 0 && Math.abs(e.deltaX) >= 8) { w.sum = 0; w.done = false; }
      w.at = e.timeStamp;
      w.sum += e.deltaX * (e.deltaMode === 1 ? 16 : 1);
      if (!w.done && Math.abs(w.sum) > 50) { w.done = true; c.step(w.sum > 0 ? 1 : -1); }
    };
    box.addEventListener("wheel", wheel, { passive: false });
    if (!c.inline) tp.addEventListener("wheel", wheel, { passive: false });   // (a scene's transport is outside its box)
  }
  // keys: Enter or Space on a focused box; the arrows on the box in view (the focused or selected one if it still is,
  // else the one filling most of the screen), from anywhere but a field, or a control that takes the arrows itself (the
  // gallery, the survival tabs) while that is on the screen: a button keeps the focus after a click, long after the
  // reader has scrolled on. (A box keeps the focus after a click too, and the figure chapters count as fully shown even
  // off the screen, so neither alone will do.)
  const inView = x => {
    if (!x.api || x.stageO * x.shown < .5) return 0;
    const r = x.box.getBoundingClientRect(), h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return h > 0 ? h / Math.min(r.height, innerHeight) : 0;
  };
  const onScreen = () => chapters.map(x => [inView(x), x]).filter(a => a[0] > .5).sort((a, b) => b[0] - a[0])[0]?.[1];
  const takesArrows = t => {
    if (t.closest("input, textarea, select, [contenteditable]")) return true;
    const r = t.closest(".gallery-track, [role=tablist]")?.getBoundingClientRect();
    return !!r && r.bottom > 0 && r.top < innerHeight;
  };
  addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || !(e.target instanceof Element)) return;
    const t = e.target, box = t.closest(".ctl-box"), tp = t.closest(".ctl-bar");
    const mine = (box || tp) && chapters.find(x => x.box === box || x.tp === tp);
    const own = mine && inView(mine) > .5 ? mine : null;
    // a transport button keeps the focus after a click, long after the reader has scrolled its box away: Space or Enter
    // then would press it and select (and pause) a box off the screen. Let it go instead, so Space pages down.
    if (tp && mine && !inView(mine) && (e.key === " " || e.key === "Enter")) { t.blur(); return; }
    const c = own || (picked && inView(picked) > .5 ? picked : onScreen());
    if (!c) return;
    if (own && t === own.box && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); c.tap(); }
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && (own || !takesArrows(t))) {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      c.step(dir);
      c.cue(dir);
    }
  });

  const chapters = $$(".chapter").map(el => new Chapter(el));

  // ------------------------------------------------------------------ survival mode: the lights go down
  const backdrop = $("#backdrop"), cinema = $("#survival"), cScreen = $(".cinema-screen");
  const cVideo = $(".cinema-video"), cCap = $(".cinema-caption"), segBtns = $$(".segmented button");
  let cinemaLoaded = false, cinemaOn = false;
  let heroFar = false, cinemaFar = false;   // well off the screen: their downloads give way (park)
  // each tab names its clip and the clip's shape (data-ar); a two-up clip also has a stacked version, plan above
  // execution, that a phone held upright plays (data-portrait-video, built by tools/build_gallery_portrait.py)
  // On a connection too slow for the clip (slow 4G, ~1.4 Mbps: the clips need 1.7-2.5) it stalled every second or two,
  // so a light copy of each (*_light.mp4: 20 fps, a third the pixels, ~0.3 Mbps) takes over, from the same moment, once
  // the clip stalls (stallWatch below), or from the start where the browser says the connection is slow (the hero's
  // test, index.html). The clips' shapes are the same
  const conn = navigator.connection || {};
  let light = !!conn.saveData || /2g|3g/.test(conn.effectiveType || "");
  const lite = src => light ? src.replace(/\.mp4(?=$|\?)/, "_light.mp4") : src;
  const clip = btn => portrait && btn.dataset.portraitVideo ? [lite(btn.dataset.portraitVideo), btn.dataset.portraitAr]
    : [lite(btn.dataset.video), btn.dataset.ar];
  // the screen takes the clip's shape before the clip loads, so nothing below it jumps; between tabs, and when the
  // plan is hidden or shown, its size glides. --film is the clip's shape, --ar the screen's: the clip's, or with the
  // plan hidden the execution's alone (16:9), which crops the clip to its execution half (css .sv-film)
  let planOff = false;
  const cFig = $(".cinema-figure"), planBtn = $(".sv-toggle");
  function shape(ar, glideIt) {
    const w0 = cScreen.offsetWidth, h0 = cScreen.offsetHeight;
    cScreen.style.width = cScreen.style.height = "";
    cScreen.style.setProperty("--film", ar);
    cScreen.style.setProperty("--ar", planOff ? "16 / 9" : ar);
    cFig.style.setProperty("--ar", planOff ? "16 / 9" : ar);   // (a short window sizes the figure by it: css html.short)
    const w1 = cScreen.offsetWidth, h1 = cScreen.offsetHeight;
    if (!glideIt || REDUCED || Math.abs(h1 - h0) < 1 && Math.abs(w1 - w0) < 1) return;
    cScreen.style.width = w0 + "px";
    cScreen.style.height = h0 + "px";
    void cScreen.offsetHeight;   // start from the old size
    cScreen.style.width = w1 + "px";
    cScreen.style.height = h1 + "px";
  }
  cScreen.addEventListener("transitionend", e => {
    if (e.target === cScreen && (e.propertyName === "height" || e.propertyName === "width")) cScreen.style.width = cScreen.style.height = "";
  });
  // the plan shows beside the execution by default, but not on a phone held upright, where plan above execution is too
  // tall; the button under the screen hides or shows it, and once pressed its choice holds across the tabs and turns
  let planChosen = false;
  function setPlan(off) {
    planOff = off;
    cFig.classList.toggle("plan-off", planOff);
    if (planBtn) planBtn.lastElementChild.textContent = planOff ? "Show plan" : "Hide plan";
  }
  let keepGen = 0;   // (one keep loop at a time: three quick taps ran three, and their corrections added up past lim)
  planBtn?.addEventListener("click", () => {
    planChosen = true;
    const gen = ++keepGen;
    const b0 = planBtn.getBoundingClientRect().top, s0 = cScreen.getBoundingClientRect().top;
    setPlan(!planOff);
    const btn = segBtns.find(b => b.getAttribute("aria-selected") === "true") || segBtns[0];
    shape(clip(btn)[1], true);
    // the button stays where it was pressed while the screen above it grows or shrinks, as far as the screen's top stays
    // clear of the nav (it was the snap that followed: the page bobbed, and Show plan pushed the button off the screen)
    noSnapUntil = performance.now() + 1200;
    const lim = s0 - $(".localnav").offsetHeight - 8, t0 = performance.now();
    let moved = 0;
    const keep = now => {
      if (gen !== keepGen) return;
      const d = Math.min(planBtn.getBoundingClientRect().top - b0 + moved, Math.max(0, lim)) - moved;
      if (Math.abs(d) >= .5) { moved += d; scrollSelf(scrollY + d); }
      if (now - t0 < 700 && !touching && gen === keepGen) requestAnimationFrame(keep);
    };
    requestAnimationFrame(keep);
  });
  shape(clip(segBtns.find(b => b.getAttribute("aria-selected") === "true") || segBtns[0])[1], false);
  // turning the phone swaps the stacked clip in or out on the spot, keeping its time and whether it plays
  // the clip's first frame (media/posters/, like the gallery's) shows until the clip has a frame, so the screen is never
  // black while a phone fetches it. It is the video's background, not its poster: WebKit didn't fetch the first clip's
  // poster, and drew a later one at another place than the clip's first frame
  function setClip(src) {
    const p = "media/posters/" + src.split("?")[0].split("/").pop().replace(/(_light)?\.\w+$/, ".jpg");
    cVideo.removeAttribute("poster");
    cVideo.style.background = `#000 url("${p}") center / contain no-repeat`;
    delete cVideo.dataset.park;
    delete cVideo.dataset.parkT;
    cVideo.src = src;
  }
  function swapCinema() {
    const btn = segBtns.find(b => b.getAttribute("aria-selected") === "true");
    if (!btn) return;
    const [src, ar] = clip(btn);
    shape(ar, false);
    if (!cVideo.getAttribute("src") || cVideo.getAttribute("src") === src) return;
    const t = cVideo.currentTime, playing = !cVideo.paused;
    setClip(src);
    if (t) cVideo.addEventListener("loadedmetadata", () => { cVideo.currentTime = Math.min(t, cVideo.duration || t); }, { once: true });
    if (playing) cVideo.play().catch(() => {});
  }
  function pick(btn, play = true) {
    segBtns.forEach(b => { b.setAttribute("aria-selected", String(b === btn)); b.tabIndex = b === btn ? 0 : -1; });   // (one tab stop: ← → move)
    cVideo.style.opacity = 0;
    cCap.style.opacity = 0;
    shape(clip(btn)[1], cinemaLoaded);
    cVideo.dataset.swapping = "1";   // (a milestone jump made meanwhile waits for the new clip: js/survival.js)
    setTimeout(() => {
      setClip(clip(btn)[0]);
      const j = cVideo.dataset.jumpTo;
      delete cVideo.dataset.swapping;
      delete cVideo.dataset.jumpTo;
      if (j) cVideo.addEventListener("loadedmetadata", () => { cVideo.currentTime = +j; }, { once: true });
      cCap.innerHTML = btn.dataset.caption;
      cVideo.style.opacity = 1;
      cCap.style.opacity = 1;
      // (not under a modal: opened by a deep link, or a tab clicked just before it opened, it played behind the sheet)
      if (play && cinemaOn && !cVideo.dataset.held && !covered()) cVideo.play().catch(() => {});
    }, cinemaLoaded ? 260 : 0);
    cinemaLoaded = true;
  }
  segBtns.forEach(b => b.addEventListener("click", () => { delete cVideo.dataset.held; pick(b); }));
  // stallWatch: a wait for data that lasts 2.5 s (4 s just after a seek or a new clip), or a third within 20 s, switches to the light copies for the rest of
  // the visit (waits right after a seek or a new clip don't count: a milestone jump or a tab fetches anew on any line)
  {
    let since = 0, stalls = [], timer = 0;
    const toLight = () => {
      if (light) return;
      light = true;
      clearTimeout(timer);
      swapCinema();   // (the same moment, playing on if it was)
    };
    cVideo.addEventListener("seeking", () => { since = performance.now(); });
    cVideo.addEventListener("emptied", () => { since = performance.now(); });
    cVideo.addEventListener("waiting", () => {
      if (light || cVideo.paused) return;
      const now = performance.now(), fresh = now - since < 1500;
      clearTimeout(timer);
      timer = setTimeout(toLight, fresh ? 4000 : 2500);   // (a fresh fetch gets longer: a first frame takes a moment anywhere)
      if (fresh) return;
      stalls = stalls.filter(t => now - t < 20000).concat(now);
      if (stalls.length >= 3) toLight();
    });
    ["playing", "pause", "emptied"].forEach(e => cVideo.addEventListener(e, () => clearTimeout(timer)));
  }
  // ← → move between the tabs, as a tablist's do (they did nothing)
  segBtns.forEach((b, i) => b.addEventListener("keydown", e => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const to = segBtns[(i + d + segBtns.length) % segBtns.length];
    to.focus();
    to.click();
  }));
  function updateCinema() {
    // (the frame loop runs this before the frame's other style writes, so reading the screen's box costs no style pass)
    const r = cScreen.getBoundingClientRect(), u = smooth(1.05, .5, r.top / vh);
    const top = topOf(cinema) - sy, bottom = top + heightOf(cinema);
    const o = smooth(.62, .12, top / vh) * (1 - smooth(.86, .42, bottom / vh));
    css(backdrop, "opacity", o.toFixed(3));
    css(backdrop, "visibility", o > 0 ? "visible" : "hidden");
    css(cinema, "--dark", smooth(.3, .7, o).toFixed(3));   // the copy flips while the light is mid-grey
    root.classList.toggle("is-dark", o > .5);
    // (landing already in view, after a reload, the clip plays as soon as its source is set)
    if (!cinemaLoaded && top < 2 * vh && bottom > -vh) pick(segBtns[0]);
    // well off the screen its download gives way to the rest (park), and it picks up where it was when the reader is back
    const far = top > 2 * vh || bottom < -vh;
    if (far !== cinemaFar) {
      cinemaFar = far;
      if (far) park(cVideo); else unpark(cVideo, clip(segBtns.find(b => b.getAttribute("aria-selected") === "true") || segBtns[0])[0]);
    }
    // (no transform once it is full size, so the labels over the clip are drawn at the screen's own resolution)
    css(cScreen, "transform", u > .999 ? "none" : `scale(${lerp(.88, 1, u).toFixed(4)})`);
    const on = r.top < vh * .85 && r.bottom > vh * .15;
    if (on !== cinemaOn) {
      cinemaOn = on;
      if (on) { if (!cVideo.dataset.held && !covered()) cVideo.play().catch(e => refusal(e, cVideo)); } else cVideo.pause();
    }
  }

  // ------------------------------------------------------------------ nav
  const navLinks = $$(".localnav-links a"), navTargets = navLinks.map(a => $(a.getAttribute("href")));
  const progress = $(".localnav-progress span");
  function updateNav() {
    let cur = -1;
    navTargets.forEach((t, i) => { if (t && topOf(t) <= sy + vh * .5) cur = i; });
    navLinks.forEach((a, i) => a.classList.toggle("active", i === cur));
    const max = measure(root, "sh", e => e.scrollHeight) - vh;
    css(progress, "transform", `scaleX(${clamp(sy / Math.max(1, max)).toFixed(4)})`);
  }

  // ------------------------------------------------------------------ lazy media, fade-ups, gallery, bibtex
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -10% 0px" });
  $$(".reveal").forEach(el => io.observe(el));
  // (a Tab can bring one into the bottom strip the observer leaves out: it shows as it takes the focus)
  document.addEventListener("focusin", e => {
    const r = e.target.closest?.(".reveal:not(.in)");
    if (r) { r.classList.add("in"); io.unobserve(r); }
  });
  // A gallery video loads and plays once at least half of it is on the screen, so the card peeking in at the side of a
  // phone's gallery doesn't download too (it was 4-8 MB). When the reader starts moving the track, the next card's video
  // in that direction fetches its first frames (preload="metadata"), so it starts at once when it arrives.
  const vio = new IntersectionObserver(es => es.forEach(e => {
    const v = e.target;
    if (e.isIntersecting && e.intersectionRatio >= .5) {
      if (v.dataset.park !== undefined) unpark(v);
      else if (!v.getAttribute("src") && v.dataset.src) v.src = v.dataset.src;
      if (!v.dataset.held && !covered()) v.play().catch(refusal);   // held: the reader paused it (js/controls.js)
    } else if (!e.isIntersecting && !v.paused) v.pause();
  }), { rootMargin: "150px 0px", threshold: [0, .5] });
  $$("video.lazy").forEach(v => vio.observe(v));
  // (off the screen but inside that margin it played on: 70 px above a phone's screen at the BibTeX)
  // ... and plays again on coming back, if this paused it (the other observer, its margin never left, doesn't fire again)
  // (and off the screen its download stops too, park: paused, a gallery card's download only held on to its part of the
  // connection; back on the screen it goes on from where it was)
  const offIo = new IntersectionObserver(es => es.forEach(e => {
    const v = e.target;
    if (!e.isIntersecting) { if (!v.paused) { v.pause(); v.dataset.offPaused = "1"; } park(v); return; }
    if (v.dataset.park !== undefined) unpark(v);
    if (v.dataset.offPaused) { delete v.dataset.offPaused; if (!v.dataset.held && !covered()) v.play().catch(() => {}); }
  }));
  $$("video.lazy").forEach(v => offIo.observe(v));
  // turned upright again: the page looks afresh at what is on the screen and plays it (observing again reports each
  // video's place anew; lastSy -1 runs the hero and the survival video's checks)
  const lookAgain = () => {
    cinemaOn = null;
    lastSy = -1;
    $$("video.lazy").forEach(v => { vio.unobserve(v); vio.observe(v); });
    wake();
  };
  // Low Power Mode, and iOS's mitigation for a hot phone, refuse every video a page plays by itself (NotAllowedError) until
  // the reader taps, and the scenes' clips then drew nothing: every animation was a set of empty boxes. A scene whose clip
  // is refused says so (MIRROR_REFUSED, scenes/scene-adapter.js) and its chapter holds on its poster with the play glyph
  // (Chapter.refused). From the first refusal on, each tap or key, in the capture phase so before the box acts on it, lets
  // the page's own videos and the clips of every scene loaded so far play: a play() within the tap lifts the refusal,
  // video by video. The animations then go on (the tapped one plays, rather than pausing: tap).
  let lowPower = false, pageUnlocked = false;
  const refusal = (e, v) => { if (!e || e.name !== "NotAllowedError") return; lowPower = true; if (v) drawVideo(v); };
  // ... and where WebCodecs decodes video (iOS Safari 16.4 on), the hero's montage and the survival clip are drawn by the
  // page instead (scenes/scene-draw.js, SceneDraw.takeOver): a canvas over each shows the frame of a clock that the
  // element's own play(), pause() and currentTime run, with the media events they fire, so the rest of the page (the
  // survival labels, milestones, bar, tabs, tap to pause) goes on as it was. The survival clip plays its light copy then
  // (a fifth of the decoding). The scenes draw their clips the same way (scenes/scene-adapter.js).
  const CAN_DRAW = typeof VideoDecoder === "function" && typeof EncodedVideoChunk === "function";
  let drawLib = null;
  function drawVideo(v) {
    if (!CAN_DRAW || v.drawnBy) return;
    v.drawnBy = "loading";
    drawLib = drawLib || new Promise((ok, no) => {
      const sc = document.createElement("script");
      sc.src = "scenes/scene-draw.js" + (ASSET_V ? "?v=" + ASSET_V : "");
      sc.onload = () => (window.SceneDraw ? ok() : no());
      sc.onerror = no;
      document.head.append(sc);
    });
    drawLib.then(() => {
      v.drawnBy = SceneDraw.takeOver(v);
      if (v === cVideo && !light) { light = true; swapCinema(); }   // (the light copy, from the same moment)
      lastSy = -1;   // (the frame loop plays what is on the screen: updateHero, updateCinema)
      wake();
    }, () => { v.drawnBy = null; });
  }
  window.MIRROR_REFUSED = w => {
    lowPower = true;
    const c = chapters.find(c => c.iframe && frameAt(c.iframe)?.w === w);
    if (!c || c.refused) return;
    c.refused = true;
    c.unlocked = false;
    // (refused in its first click: back to its opening, where its poster stands in, rather than a frame of empty boxes)
    if (c.k === 0 && c.T > c.lead) { c.fromLead(); c.cur = -1; c.doneAt = null; }
    c.sync();
    wake();
  };
  function unlockVideos() {
    if (!lowPower) return;
    const now = performance.now();
    if (!pageUnlocked) {
      let ok = false;
      for (const v of $$("video")) {
        if (v.drawnBy) continue;   // (drawn by the page: nothing to lift)
        if (!v.paused) { ok = true; continue; }
        const p = v.play();
        if (p) p.catch(() => {});
        if (!v.paused) ok = true;
        v.pause();
      }
      if (ok) { pageUnlocked = true; lookAgain(); }   // (what is on the screen plays)
    }
    for (const c of chapters) {
      if (c.unlocked || !c.api || !c.api.unlock) continue;
      let ok = false;
      try { ok = c.api.unlock(); } catch (e) {}
      if (!ok) continue;
      c.unlocked = true;
      if (c.refused) { c.refused = false; c.thawedAt = now; c.sync(); }
    }
    wake();
  }
  for (const ev of ["touchend", "click", "keydown"]) addEventListener(ev, unlockVideos, { capture: true });
  document.addEventListener("mirror-turn", e => { if (!e.detail.on) lookAgain(); else wake(); });
  // and as an episode modal closes (js/modal.js pauses the page's videos as it opens, and plays those on as it closes;
  // one that came into view under it, as on a link straight to the modal, starts now)
  let modalWas = false;
  // (and as one opens, the page's downloads under way stop, park: paused under it, they held on to their parts of the
  // connection, and the modal's own page and videos waited behind them; as it closes, those on the screen go on)
  const videoOnScreen = v => { const r = v.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  new MutationObserver(() => {
    const open = root.classList.contains("modal-open");
    if (open === modalWas) return;
    modalWas = open;
    if (open) {
      for (const v of $$("video")) if (v.dataset.park === undefined) { park(v); if (v.dataset.park !== undefined) v.dataset.modalPark = "1"; }
      return;
    }
    for (const v of $$("video[data-modal-park]")) {
      delete v.dataset.modalPark;
      if (v === heroVideo ? heroFar : v === cVideo ? cinemaFar : !videoOnScreen(v)) continue;   // (the far ones wait for the reader)
      unpark(v, v === cVideo ? clip(segBtns.find(b => b.getAttribute("aria-selected") === "true") || segBtns[0])[0] : undefined);
    }
    if (!turned()) lookAgain();
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
  // with reduced motion, no video plays by itself (as the hero's): the survival video and the gallery's start held, and
  // a tap or a tab plays them
  if (REDUCED) [cVideo, ...$$("video.lazy")].forEach(v => { v.dataset.held = "1"; });
  $$(".gallery-track").forEach(track => {
    let lastX = track.scrollLeft;
    track.addEventListener("scroll", () => {
      const x = track.scrollLeft, dir = Math.sign(x - lastX), tr = track.getBoundingClientRect(), mid = tr.left + track.clientWidth / 2;
      lastX = x;
      // (only with the gallery near the screen: on an iPhone the track moves by itself as the page lays out, and that
      // fetched a 1 MB clip, Walker's, with the page's first animations)
      if (!dir || tr.bottom < -innerHeight || tr.top > 2 * innerHeight) return;
      const ahead = $$("video.lazy", track).filter(v => !v.getAttribute("src") && v.dataset.src)
        .map(v => ({ v, d: (v.getBoundingClientRect().left + v.getBoundingClientRect().width / 2 - mid) * dir }))
        .filter(o => o.d > 0).sort((a, b) => a.d - b.d)[0];
      if (ahead) { ahead.v.preload = "metadata"; ahead.v.src = ahead.v.dataset.src; }
    }, { passive: true });
  });

  // on a phone held upright the gallery's two-up videos (plan beside execution) play their stacked versions, plan
  // above execution (data-portrait-src, built by tools/build_gallery.py). data-src always names the one for the
  // current layout, so the lazy loading above and a tap to play (js/controls.js) pick it up. A video that has
  // loaded swaps on the spot: it keeps its time, plays on if it was playing and stays paused if not
  const twoUp = $$("video[data-portrait-src]");
  twoUp.forEach(v => { v.dataset.landscapeSrc = v.dataset.src; });
  function swapTwoUp() {
    twoUp.forEach(v => {
      const src = portrait ? v.dataset.portraitSrc : v.dataset.landscapeSrc;
      if (v.dataset.src === src) return;
      v.dataset.src = src;
      if (v.dataset.park !== undefined) { v.dataset.park = src; return; }   // (parked: the new one, when it is back)
      if (!v.getAttribute("src")) return;
      const t = v.currentTime, playing = !v.paused;
      if (v.preload === "none") v.preload = "metadata";   // so a paused video shows its frame
      v.src = src;
      if (t) v.addEventListener("loadedmetadata", () => { v.currentTime = Math.min(t, v.duration || t); }, { once: true });
      if (playing) v.play().catch(() => {});
    });
    setPosters();
  }
  // until its video has a frame, each gallery card shows the video's first frame (media/posters/<name>.jpg, cut with
  // ffmpeg), so a card never slides in black. The posters load once the gallery is a screen away
  const galleryVideos = $$(".gallery-track video");
  let postersOn = false;
  function setPosters() {
    if (postersOn) galleryVideos.forEach(v => {
      const p = "media/posters/" + v.dataset.src.split("/").pop().replace(/\.\w+$/, ".jpg");
      if (v.getAttribute("poster") !== p) v.setAttribute("poster", p);
    });
  }
  const pio = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) { postersOn = true; setPosters(); pio.disconnect(); }
  }, { rootMargin: "100% 0px" });
  $$("[data-gallery]").forEach(g => pio.observe(g));

  $$("[data-gallery]").forEach(g => {
    const track = $(".gallery-track", g), [prev, next] = $$(".paddle", g);
    // a paddle goes to the next card's place (the cards differ in width, so a fixed step skipped some), as the dots do
    // (js/controls.js): stacked rows' cards less than 60 px apart count as one place
    // (from where the last tap is taking it while it glides: read mid-glide, fast taps lost steps)
    let aim = null, aimTimer = 0;
    const go = dir => {
      const max = track.scrollWidth - track.clientWidth, x = aim ?? track.scrollLeft;
      const pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
      const xs = $$(".card", track).map(c => clamp(c.offsetLeft - pad, 0, max)).sort((a, b) => a - b);
      const to = dir > 0 ? xs.find(v => v > x + 60) : xs.reverse().find(v => v < x - 60);
      aim = to ?? (dir > 0 ? max : 0);
      clearTimeout(aimTimer);
      aimTimer = setTimeout(() => { aim = null; }, 700);
      track.scrollTo({ left: aim, behavior: REDUCED ? "auto" : "smooth" });
    };
    prev.addEventListener("click", () => go(-1));
    // a card reached by Tab comes into view (the track didn't follow the focus: Pong took it 19% on the screen)
    track.addEventListener("focusin", e => {
      const c = e.target.closest(".card");
      if (!c || !e.target.matches(":focus-visible")) return;   // (Tab only: a tap's focus scrolled the track to a peeking card)
      // (to the card's own place, a snap point: scrollIntoView's "nearest" was snapped back to a place showing 21% of it)
      const t = track.getBoundingClientRect(), r = c.getBoundingClientRect();
      if (r.left >= t.left - 1 && r.right <= t.right + 1) return;
      const pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
      track.scrollTo({ left: clamp(c.offsetLeft - pad, 0, track.scrollWidth - track.clientWidth), behavior: REDUCED ? "auto" : "smooth" });
    });
    next.addEventListener("click", () => go(1));
    // the track ends where the last card snaps into place, or at the end of the scroll if that comes first
    const last = [...track.querySelectorAll(".card")].pop();
    const sync = () => {
      const pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
      const end = Math.min(track.scrollWidth - track.clientWidth, last ? last.offsetLeft - pad : Infinity);
      prev.disabled = track.scrollLeft < 4;
      next.disabled = track.scrollLeft > end - 4;
    };
    track.addEventListener("scroll", sync, { passive: true });
    addEventListener("resize", sync);
    sync();
  });

  const copyBtn = $(".bibtex-copy");
  if (copyBtn) copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText($(".bibtex code").textContent).then(() => {
      copyBtn.textContent = "Copied";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1600);
    }).catch(() => {});
  });

  // ------------------------------------------------------------------ keeping the reader's place
  // A relayout (a phone turned, a window resized) changes how tall everything is, so the same scroll position would be
  // somewhere else. As the reader scrolls, the page notes the section across the middle of the screen and how far
  // through it they are (in a chapter, how far into it in screen heights, since a chapter's lengths all scale with the
  // screen's height), and after a relayout it scrolls back to that place. A chapter keeps its click and T anyway.
  const placeEls = $$("main > section, body > footer");
  let place = null, placeHeld = false;   // placeHeld: a relayout is due, so the layout is stale and place stays as it was
  function notePlace() {
    if (placeHeld) return;
    const mid = sy + vh / 2;
    for (const el of placeEls) {
      const top = topOf(el), h = heightOf(el);
      if (mid >= top + h && el !== placeEls.at(-1)) continue;
      place = chapters.some(c => c.el === el) ? { el, y: (sy - top) / vh } : { el, f: (mid - top) / Math.max(1, h) };
      Object.assign(place, { dy: sy - top, w: vw, h: vh });   // at the same screen size: exactly where it was
      return;
    }
  }
  function restorePlace(p = place) {
    if (!p) return;
    const top = docTop(p.el);
    const y = p.w === vw && p.h === vh || p.y == null && p.f == null ? top + p.dy
      : p.y != null ? top + p.y * vh : top + p.f * p.el.offsetHeight - vh / 2;
    scrollSelf(Math.max(0, Math.round(y)));
  }
  // A reload, or coming back from another page, returns to the same place. The browser's own restoration would land
  // while the chapters still have their css height, before site.js lays them out, and miss, so the page does it itself:
  // it saves the place as it is left (sessionStorage) and scrolls back to it after the first layout, and again whenever
  // a section changes size (fonts, videos) until the reader scrolls or the page has settled. A fresh visit starts at the
  // top, or at its #anchor, which is held in place the same way (scroll anchoring can't, as most of the page is sticky).
  // (A page kept whole in the back/forward cache needs none of this.)
  const PLACE_KEY = "mirror-place:" + location.pathname;
  let comeBack = null;   // the place being returned to, while the page settles
  try {
    history.scrollRestoration = "manual";
    const nav = (performance.getEntriesByType("navigation")[0] || {}).type;
    const s = (nav === "reload" || nav === "back_forward") && JSON.parse(sessionStorage.getItem(PLACE_KEY));
    if (s && placeEls[s.i]) place = comeBack = { ...s, el: placeEls[s.i] };
    else comeBack = anchorPlace();
  } catch (e) {}
  // the #anchor's place: its top under the nav (its scroll-margin)
  function anchorPlace() {
    let t = null;
    try {
      // a modal's #hash (js/modal.js): the section the modal belongs to
      const id = window.MIRROR_MODAL?.section(location.href) || safeDecode(location.hash.slice(1));
      t = location.hash.length > 1 && document.getElementById(id);
    } catch (e) {}
    return t ? { el: t, dy: -(parseFloat(getComputedStyle(t).scrollMarginTop) || 0) } : null;
  }
  // a jump to an #anchor within the page (the nav's links) is held there too for a moment, while the sections it
  // passed load and take their size (the survival clip's screen takes its shape)
  addEventListener("hashchange", e => {
    if (window.MIRROR_MODAL?.owns(e.oldURL) || window.MIRROR_MODAL?.owns(e.newURL)) return;   // a modal opening or closing
    const a = comeBack = anchorPlace();
    noSnapUntil = performance.now() + 2500;   // the nav's jump lands where it was sent
    setTimeout(() => { if (comeBack === a) comeBack = null; }, 1500);
  });
  addEventListener("pagehide", () => {
    sy = scrollY;
    notePlace();
    try {
      if (place) sessionStorage.setItem(PLACE_KEY, JSON.stringify({ ...place, el: undefined, i: placeEls.indexOf(place.el) }));
      else sessionStorage.removeItem(PLACE_KEY);
    } catch (e) {}
  });
  const settleBack = () => { if (comeBack) restorePlace(comeBack); };
  const letGo = () => { comeBack = null; };
  for (const ev of ["wheel", "touchstart", "keydown", "pointerdown"]) addEventListener(ev, letGo, { capture: true, passive: true });
  document.fonts.ready.then(settleBack);
  addEventListener("load", () => { settleBack(); setTimeout(() => { settleBack(); letGo(); }, 1500); });

  // ------------------------------------------------------------------ layout + frame loop
  // the screen's height with a phone browser's toolbars showing (100svh), which the css lays the sticky stages out to.
  // innerHeight grows as the toolbars slide away, and a relayout then (a phone turned with them hidden) laid the boxes
  // out for a screen taller than their stage, low and against its bottom edge, until the next turn.
  const svh = document.createElement("div");
  svh.style.cssText = "position:fixed;top:0;left:0;width:0;height:100vh;height:100svh;visibility:hidden;pointer-events:none";
  document.body.append(svh);
  let laidOut = false;
  function relayout() {
    // under the note to turn the phone upright (js/turn.js) the page keeps the layout it had, so turning back finds
    // every chapter as it was, with no scene reloading in the sideways layout and back
    if (laidOut && turned()) return;
    laidOut = true;
    vh = Math.min(innerHeight, svh.offsetHeight || innerHeight);
    vw = innerWidth;
    // a short window (too short for the desktop layout, and not narrow even when under 760 wide): the animations
    // get the narrow layout's box with the title drawn by the page, and the figure chapters a compact layout
    // (fitShort, css "fix: short landscape")
    // (not a tiny screen about as tall as wide, a Z Flip's cover at 350x330: there the figures had no width left beside
    // their steps, and the narrow layout stacks them)
    // (and a very wide window not much taller, 1600x500 or 1920x600: the wide layout drew a small frame with wide
    // margins, and the gallery and survival didn't fit)
    const s = (vh < 500 || vh < 620 && vw / vh > 2.4) && vw > vh && vw >= 440;
    // (and a window under 1000 wide that is about square or taller: a foldable's inner screen, a tablet's split view,
    // where the wide layout's 16:9 frame left most of the height empty and drew its text at half size)
    // (and any window about square or taller, 1200x1200 or a 1280x1400 half-screen snap: the 16:9 frame left a third of
    // the height empty above and below, and drew its text at half size)
    const n = !s && (vw < 760 || vw / vh < 1.05);
    if (n !== narrow) {
      narrow = n;
      root.classList.toggle("narrow", narrow);
      chapters.forEach(c => { if (c.api) c.api.setNarrow(narrow || short); c.capHTML = null; });
    }
    if (s !== short) {
      short = s;
      root.classList.toggle("short", short);
      if (!short) root.classList.remove("stage-on");
      chapters.forEach(c => { if (c.api) c.api.setNarrow(narrow || short); c.capHTML = null; if (c.capEl) c.capEl.innerHTML = ""; });
    }
    // a narrow screen that is taller than wide (a phone held upright) gets the animations' portrait layouts
    const p = narrow && vw < vh;
    if (p !== portrait) {
      portrait = p;
      root.classList.toggle("portrait", portrait);
      chapters.forEach(c => { if (!c.inline && c.state !== "idle" && c.mode !== portrait) c.reset(); });
      swapTwoUp();
      if (!planChosen) setPlan(portrait);
      swapCinema();
    }
    chapters.forEach(c => c.layout());
    // the transport goes under the boxes on a narrow screen, and on a wide one with room for it under the frame
    const fr = !narrow && !short && $(".chapter:not(.chapter-split) .stage-frame");
    const navH = parseFloat(getComputedStyle(root).getPropertyValue("--nav-h")) || 52;
    root.classList.toggle("ctl-below", !short && (narrow || !!fr && (vh - navH - fr.offsetHeight) / 2 >= CTL_ROOM + CTL_FOOT));
    layoutHero();
    restorePlace();
    placeHeld = false;
    lastSy = -1;
    glide = null;   // its target moved
    geo.clear();
    wake();
    // a phone folding shut (or turning) can report its old, wider viewport at its one resize, before the browser has
    // laid the page out again, and then fire none: look again once it has settled
    clearTimeout(rcT);
    rcT = setTimeout(() => {
      if (innerWidth === vw && (toolbars && Math.abs(innerHeight - lastH) < 140 || innerHeight === lastH)) return;
      lastW = innerWidth; lastH = innerHeight; placeHeld = true;
      relayout();
    }, 400);
  }
  let rT = null, rcT = null, lastW = vw, lastH = vh;
  // (a touch screen's browser resizes the viewport as its toolbars slide. A desktop window dragged taller does too, in
  // small steps, and each counts: ignored, the page kept the old height's layout and lost the reader's place)
  const toolbars = matchMedia("(pointer: coarse)").matches;
  addEventListener("resize", () => {
    // mobile browsers resize the viewport as their toolbars slide: ignore small height-only changes
    if (innerWidth === lastW && (toolbars ? Math.abs(innerHeight - lastH) < 140 : innerHeight === lastH)) return;
    lastW = innerWidth;
    lastH = innerHeight;
    placeHeld = true;
    clearTimeout(rT);
    rT = setTimeout(relayout, 120);
  });
  // a phone's connection back: a scene that failed to load while it was gone loads again when it next comes near
  addEventListener("online", () => {
    chapters.forEach(c => c.retryLoad());
    // ... and the videos and stills that failed while it was gone ask again (a video with an error was never given its
    // file again, so the gallery's and the survival clip stayed black), playing on if they are on the screen
    for (const v of $$("video")) {
      const src = v.getAttribute("src");
      if (v.poster) v.poster = v.getAttribute("poster");
      if (v.style.backgroundImage) v.style.backgroundImage = v.style.backgroundImage;
      if (!src || !(v.error || v.networkState === HTMLMediaElement.NETWORK_NO_SOURCE)) continue;
      const t = v.currentTime;
      v.removeAttribute("src");
      v.src = src;
      if (t) v.addEventListener("loadedmetadata", () => { v.currentTime = Math.min(t, v.duration || t); }, { once: true });
      const r = v.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && !v.dataset.held && !covered()) v.play().catch(() => {});
    }
    for (const img of $$("img")) if (img.complete && !img.naturalWidth && img.getAttribute("src")) img.src = img.getAttribute("src");
  });
  document.fonts.ready.then(layoutHero);

  // ------------------------------------------------------------------ loading, in reading order
  // A slow connection shares its speed between everything downloading at once, so the page asks for one thing at a
  // time, in the order the reader comes to it: what is on the screen, then the chapters below it, then those above.
  // Each chapter first gets its poster (the animation's opening frame, a few KB), then its scene, and the chapter after
  // it waits until that scene has what its frame needs (Chapter.settled). A scene loads within LOAD_AHEAD screens, or as
  // the first chapter below the screen wherever it is; the posters further on follow in order. The hero's montage and
  // the survival clip, while playing, first get BUFFER_AHEAD seconds ahead (for FILL_MAX seconds at most).
  const LOAD_AHEAD = 2.5;   // screens
  const BUFFER_AHEAD = 6, FILL_MAX = 8;   // seconds
  const LOAD_MAX = 8, POSTER_MAX = 3;     // seconds a stalled scene or poster holds the others back, at most
  // seconds of its stage on the screen a scene's first showing waits for its opening's clips, over its poster or without
  // one (Chapter.update): past that it shows and plays, holding a click whose clip has no frame yet (starved)
  const FIRST_MAX = 3, FIRST_MAX_BARE = 4;
  const loadScripts = srcs => Promise.all(srcs.map(src => new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;        // (they run in order)
    s.onload = ok;
    s.onerror = no;
    document.body.append(s);
  })));
  // seconds a video has buffered past where it is (Infinity: all of it)
  function bufferedAhead(v) {
    const b = v.buffered, t = v.currentTime;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t + .1 && b.end(i) > t) return b.end(i) >= (v.duration || Infinity) - .25 ? Infinity : b.end(i) - t;
    }
    return 0;
  }
  const fillFrom = new WeakMap();
  function filling(v, now) {
    if (!v.getAttribute("src") || v.paused || v.error || bufferedAhead(v) >= BUFFER_AHEAD) { fillFrom.delete(v); return false; }
    if (!fillFrom.has(v)) fillFrom.set(v, now);
    return now - fillFrom.get(v) < FILL_MAX * 1e3;
  }
  // how far a section is from the screen, in screens (one above counts twice as far: the reader is going down)
  function dist(el) {
    const t = topOf(el), b = t + heightOf(el), top = sy, bottom = sy + vh;
    return t >= bottom ? (t - bottom) / vh : b <= top ? 2 * (top - b) / vh : 0;
  }
  let loadsWaiting = true;
  function schedule(now) {
    loadsWaiting = true;
    if (turned()) return;   // (under the note to turn the phone upright: nothing loads in the layout it would leave)
    const order = chapters.map(c => ({ c, t: topOf(c.el), below: topOf(c.el) >= sy + vh, d: dist(c.el) })).sort((a, b) => a.d - b.d);
    const next = order.find(o => o.below);   // (the first chapter below the screen)
    for (const o of order) o.c.wanted = o.d < LOAD_AHEAD || o === next;
    if (filling(heroVideo, now) || cinemaOn && filling(cVideo, now) || foreground(order, now)) { giveWay(); return; }
    if (background(order)) loadsWaiting = false;
  }
  // the next thing the reader is on or coming to, if anything is still to load (true)
  function foreground(order, now) {
    for (const { c, t } of order) {
      if (!c.posterReady()) { c.loadPoster(); return true; }
      if (!c.wanted) continue;
      if (c.state === "idle") {
        // A scene's page takes one long task to parse (Minecraft's: 70-150 ms on a phone), so it loads at a moment when
        // nothing moves: no animation plays (between clicks or chapters, or once a chapter has ended), the page doesn't
        // glide, and the reader has stopped scrolling (a parse landing mid-swipe was a 60-170 ms hitch on a mid-range
        // phone; readers stop at every chapter). Within LOAD_NOW screens it loads whatever moves, and so does a figure
        // drawn in the page with nothing to fetch.
        const y = sy - t, wait = moving || scrolling(now);
        if (!wait || y > -LOAD_NOW * vh || c.inline && !c.el.dataset.scripts) c.load();
        return true;
      }
      if (!c.settled()) return true;
    }
    return false;
  }
  // Downloads the reader has scrolled past (park) wait until the rest is in: what the reader is on and coming to, and
  // what the chapter on the screen fetches ahead. Then they go on in the background, one at a time and nearest first,
  // and give way again whenever something else needs the line (giveWay). True once nothing is left.
  let behind = null;      // the one going on now: { c }, a chapter's clips, or { v }, the hero's montage or survival clip
  const passed = v => v === heroVideo ? heroFar : cinemaFar;
  function giveWay() {
    const b = behind;
    behind = null;
    if (!b) return;
    if (b.c) { if (b.c.parked && b.c.api) b.c.api.park(); }
    else if (passed(b.v)) park(b.v);
  }
  function background(order) {
    // (what the reader is looking at: the chapter on the screen, or the hero's montage or the survival clip playing)
    const streaming = v => !v.paused && bufferedAhead(v) !== Infinity;
    if (order.some(o => o.d === 0 && o.c.api && o.c.api.busy && o.c.api.busy()) || streaming(heroVideo) || streaming(cVideo)) {
      giveWay();
      return false;
    }
    if (behind) {
      const done = behind.c ? !behind.c.api || !behind.c.api.busy() : behind.v.networkState !== 2 || bufferedAhead(behind.v) === Infinity;
      if (!done) return false;
      // (one the browser only deferred stops again, rather than hold on to its part of the connection, and waits for the
      // reader to come back: unpark)
      if (behind.v && passed(behind.v) && bufferedAhead(behind.v) !== Infinity) { park(behind.v); behind.v.dataset.deferred = "1"; }
      behind = null;
    }
    const left = [
      ...order.filter(o => o.c.parked && o.c.api && o.c.api.parked && o.c.api.parked() > 0),
      ...[[heroVideo, heroEl], [cVideo, cinema]].filter(([v]) => v.dataset.park !== undefined && !v.dataset.deferred).map(([v, el]) => ({ v, d: dist(el) })),
    ].sort((a, b) => a.d - b.d)[0];
    if (!left) return true;
    behind = left.c ? { c: left.c } : { v: left.v };
    if (left.c) left.c.api.resume();
    else unpark(left.v, left.v === cVideo ? clip(segBtns.find(b => b.getAttribute("aria-selected") === "true") || segBtns[0])[0] : undefined, true);
    return false;
  }
  // (the frame loop sleeps when nothing moves, and a clip coming in doesn't always say so: look again now and then)
  setInterval(() => { if (loadsWaiting && !document.hidden) schedule(performance.now()); }, 500);
  // A paused video keeps downloading (browsers buffer on), which on a slow connection starves what the reader looks at
  // next. Once well off the screen, the hero's montage and the survival clip stop downloading, unless they have it all
  // (park); they go on in the background once the rest is in (background), or as soon as the reader is back (unpark;
  // src: the clip to play then). They keep their place in the clip, and the browser keeps what they had.
  function park(v) {
    // (only a download under way: a clip the reader never started has nothing to go on with. Under way is not just
    // networkState loading: Chrome reports idle for a download it has deferred, and a deferred download still holds its
    // part of the connection's flow-control window. Five of them, the hero's, the survival clip's and three of the
    // gallery's, left none for the episodes modal on GitHub Pages: its page got its headers and no body, for 10 s on)
    const started = v.networkState === 2 || v.readyState > 0 || v.buffered.length > 0;
    if (v.dataset.park !== undefined || !v.getAttribute("src") || !started || bufferedAhead(v) === Infinity) return;
    v.dataset.park = v.getAttribute("src");
    v.dataset.parkT = v.currentTime;
    v.removeAttribute("autoplay");   // (the page plays it while it is on the screen: updateHero, updateCinema)
    v.pause();
    v.removeAttribute("src");
    v.load();
  }
  function unpark(v, src = v.dataset.park, behindScreen = false) {
    if (v.dataset.park === undefined) return;
    delete v.dataset.deferred;
    const t = +v.dataset.parkT || 0;
    delete v.dataset.park;
    delete v.dataset.parkT;
    if (behindScreen) v.preload = "auto";   // (off the screen it only downloads)
    v.src = src;
    if (t) v.addEventListener("loadedmetadata", () => { v.currentTime = Math.min(t, v.duration || t); }, { once: true });
  }

  // The frame loop sleeps once nothing has changed for IDLE seconds: no scrolling or finger down, no glide, no chapter
  // playing (or holding between clicks) or fading in, no statement playing on. Input, scrolling, a resize, the tab
  // coming back, a section changing size, a scene loading and its videos seeking or loading wake it (wake).
  const IDLE = 1;        // seconds
  const LOAD_NOW = 1.2;  // screens: a scene this close loads even while something moves (schedule)
  let lastNow = performance.now(), rafId = 0, quietAt = 0;
  let moving = false;    // in the last frame an animation played or the page scrolled itself: a scene load waits (schedule)
  function wake() {
    if (rafId) return;
    lastNow = quietAt = performance.now();   // the time asleep is not a frame's dt
    rafId = requestAnimationFrame(frame);
  }
  for (const ev of ["scroll", "wheel", "keydown", "pointerdown", "click", "touchstart", "touchmove", "touchend", "resize", "pageshow"])
    addEventListener(ev, wake, { capture: true, passive: true });
  document.addEventListener("visibilitychange", wake);
  // a section that changes size moves everything below it: measure again (geo), and redraw what depends on it
  const ro = new ResizeObserver(() => { geo.clear(); lastSy = -1; settleBack(); wake(); });
  [$("main"), ...placeEls].forEach(el => el && ro.observe(el));

  function frame(now) {
    rafId = 0;
    const dt = Math.min(.1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    sy = scrollY;
    const moved = sy !== lastSy;
    if (moved) {
      // a move the page didn't make itself is the reader's
      if (lastSy >= 0 && (ownAt === null || Math.abs(sy - ownAt) > 3)) { takeOver(MOVE_HOLD); readerDir = Math.sign(sy - lastSy); }
      lastSy = sy;
      notePlace();
      updateCinema();   // first: it reads the screen's box, before this frame's style writes
      updateHero();
      wordBlocks.forEach(updateWords);
      updateNav();
    }
    schedule(now);
    for (const c of chapters) c.update(now, dt);
    if (short) root.classList.toggle("stage-on", chapters.some(c => c.staged));
    // under an episode modal (js/modal.js), or the note to turn the phone upright (js/turn.js), the page holds still: a glide or snap under way stops where it is
    if (root.classList.contains("modal-open") || turned()) { glide = null; snapArmed = false; wordBlocks.forEach(b => { b.autoY = null; }); }
    else {
      wordBlocks.forEach(b => autoplayWords(b, now, dt));
      snapNear(now);
    }
    if (glide) stepGlide(now);
    const words = wordBlocks.some(b => b.autoY != null);
    moving = !!glide || words || chapters.some(c => c.rate > 0);
    if (moved || moving || scrolling(now) || chapters.some(c => c.busy)) quietAt = now;
    if (!rafId && now - quietAt < IDLE * 1e3) rafId = requestAnimationFrame(frame);
  }
  relayout();
  wake();
  window.MIRROR = { chapters };   // for poking at from the console (and js/timing.js)
  if (/[?&]timing(&|=|$)/.test(location.search)) {
    const s = document.createElement("script");
    s.src = "js/timing.js?t=" + Date.now();
    document.head.append(s);
  }
})();
