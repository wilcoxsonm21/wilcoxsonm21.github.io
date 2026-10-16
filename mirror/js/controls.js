// controls.js: Apple-style controls for the page's videos and its gallery.
//
// Every gallery video gets a round play/pause button in place of the browser's controls, with a ring that shows how far
// the video has played; the survival video has no controls and plays while it is in view, with a thin bar along its
// bottom that shows how far it has played. A video the reader pauses
// stays paused (data-held): site.js plays videos as they scroll into view and skips held ones. The gallery gets a dot
// indicator, one dot per card, that follows the scrolling and scrolls to a card when clicked.
(() => {
  "use strict";
  const R = 15.5, C = 2 * Math.PI * R;
  const PAUSE = '<rect x="13.2" y="11.5" width="3.2" height="13" rx="1"/><rect x="19.6" y="11.5" width="3.2" height="13" rx="1"/>';
  const PLAY = '<path d="M14.6 11.7v12.6c0 .7.8 1.1 1.4.7l10-6.3c.5-.4.5-1.1 0-1.4l-10-6.3c-.6-.4-1.4 0-1.4.7z"/>';

  function attach(video, host) {
    video.removeAttribute("controls");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vbtn";
    b.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="vbtn-track" cx="18" cy="18" r="${R}"/>` +
      `<circle class="vbtn-ring" cx="18" cy="18" r="${R}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/>` +
      `<g class="vbtn-icon" fill="currentColor"></g></svg>`;
    const ring = b.querySelector(".vbtn-ring"), icon = b.querySelector(".vbtn-icon");
    // the ring follows the video every frame while it plays (timeupdate alone comes only ~4 times a second)
    let raf = 0;
    const progress = () => {
      raf = 0;
      const d = video.duration;
      const off = (C * (1 - (d ? Math.min(1, video.currentTime / d) : 0))).toFixed(2);
      if (off !== ring.getAttribute("stroke-dashoffset")) ring.setAttribute("stroke-dashoffset", off);
      if (!video.paused && !video.ended) raf = requestAnimationFrame(progress);
    };
    const state = () => {
      const playing = !video.paused && !video.ended;
      icon.innerHTML = playing ? PAUSE : PLAY;
      b.setAttribute("aria-label", playing ? "Pause video" : "Play video");
      cancelAnimationFrame(raf);
      progress();
    };
    video.addEventListener("timeupdate", () => { if (!raf) raf = requestAnimationFrame(progress); });
    ["play", "pause", "ended", "emptied", "loadedmetadata"].forEach(e => video.addEventListener(e, state));
    b.addEventListener("click", () => {
      if (video.paused || video.ended) {
        delete video.dataset.held;
        if (!video.getAttribute("src") && video.dataset.src) video.src = video.dataset.src;
        video.play().catch(() => {});
      } else {
        video.dataset.held = "1";
        video.pause();
      }
    });
    host.append(b);
    state();
  }

  // the survival video has no controls: a thin bar along its bottom shows how far it has played
  const cinema = document.querySelector(".cinema-video");
  if (cinema) {
    cinema.removeAttribute("controls");
    const bar = document.createElement("div");
    bar.className = "cbar";
    bar.setAttribute("aria-hidden", "true");
    bar.innerHTML = "<i></i>";
    cinema.closest(".cinema-screen").after(bar);   // (under the screen, in the figure's grid: css .cbar)
    const fill = bar.firstChild;
    let raf = 0, last = "";
    const follow = () => {
      raf = 0;
      const d = cinema.duration, p = (d ? Math.min(1, cinema.currentTime / d) : 0).toFixed(4);
      if (p !== last) { last = p; fill.style.setProperty("--p", p); }
      if (!cinema.paused && !cinema.ended) raf = requestAnimationFrame(follow);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(follow); };
    ["timeupdate", "play", "pause", "seeked", "emptied", "loadedmetadata", "ended"].forEach(e => cinema.addEventListener(e, kick));
  }
  // a gallery card's button sits beside its title, under the clip, which has keys, a hotbar and labels in its corners
  document.querySelectorAll(".card-media").forEach(m => { const v = m.querySelector("video"); if (v) attach(v, m.closest(".card") || m); });

  // the gallery's dot indicator
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-gallery]").forEach(g => {
    const track = g.querySelector(".gallery-track"), row = g.querySelector(".gallery-paddles");
    const cards = track ? [...track.querySelectorAll(".card")] : [];
    if (!cards.length || !row) return;
    const dots = document.createElement("div");
    dots.className = "gallery-dots";
    row.prepend(dots);
    const pad = () => parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
    // one dot per place the track can come to rest: a card each on a single row, but where the rows stack (a desktop)
    // the cards of a column share one, and the cards past the end of the scroll share the last
    let stops = [], btns = [];
    function build() {
      const max = track.scrollWidth - track.clientWidth, p = pad(), out = [];
      cards.map((c, i) => ({ x: Math.max(0, Math.min(max, c.offsetLeft - p)), i })).sort((a, b) => a.x - b.x || a.i - b.i)
        .forEach(s => { const l = out.at(-1); if (l && s.x - l.x < 60) l.cards.push(s.i); else out.push({ x: s.x, cards: [s.i] }); });
      const label = s => s.cards.sort((a, b) => a - b).map(i => (cards[i].querySelector("h3") || {}).textContent || `Video ${i + 1}`).join(", ");
      if (out.length !== stops.length) {
        btns = out.map(() => { const b = document.createElement("button"); b.type = "button"; return b; });
        dots.replaceChildren(...btns);
      }
      stops = out;
      btns.forEach((b, i) => b.setAttribute("aria-label", label(stops[i])));
      sync();
    }
    function current() {
      if (track.scrollLeft > track.scrollWidth - track.clientWidth - 4) return stops.length - 1;   // scrolled to the end
      let k = 0;
      stops.forEach((s, i) => { if (Math.abs(s.x - track.scrollLeft) < Math.abs(stops[k].x - track.scrollLeft)) k = i; });
      return k;
    }
    let queued = false;
    function sync() {
      queued = false;
      const k = current();
      btns.forEach((b, i) => b.setAttribute("aria-current", i === k ? "true" : "false"));
    }
    track.addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(sync); } }, { passive: true });
    // (after site.js has laid the page out again: the rows stack or join with html.narrow)
    let rT = 0;
    addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(build, 250); });
    dots.addEventListener("click", e => {
      const i = btns.indexOf(e.target.closest("button"));
      if (i >= 0) track.scrollTo({ left: stops[i].x, behavior: reduce ? "auto" : "smooth" });
    });
    build();
    addEventListener("load", build);   // (the cards take their widths as their posters and fonts come in)
  });
})();
