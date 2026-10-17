// controls.js: Apple-style controls for the page's videos and its gallery.
//
// Every gallery video is a mini player like the survival video: no controls, the page's labels over the clip, a tap to
// pause or play, and a thin bar under it that shows how far it has played (the survival video's too). A video the
// reader pauses stays paused (data-held): site.js plays videos as they scroll into view and skips held ones. The
// gallery gets a dot indicator, one dot per card, that follows the scrolling and scrolls to a card when clicked.
(() => {
  "use strict";
  // a gallery card's mini player: the survival video's look at card size. Its labels are the page's text over the clip
  // (data-panes: "two" for plan | execution, "stages:<a>|<b>|<c>" for FindCave's stages, plan above execution); a tap or
  // a click (or Enter/Space) pauses or plays, with a glyph that pops and stays while paused; the bar under it shows how
  // far it has played. It plays at 1x, with nothing to skip or seek
  const GLYPH_PAUSE = '<svg viewBox="0 0 36 36"><rect x="11.5" y="10" width="4.6" height="16" rx="1.4"/><rect x="19.9" y="10" width="4.6" height="16" rx="1.4"/></svg>';
  const GLYPH_PLAY = '<svg viewBox="0 0 36 36"><path d="M13.2 10.4v15.2c0 .9 1 1.4 1.7.9l12-7.6c.7-.4.7-1.4 0-1.8l-12-7.6c-.7-.5-1.7 0-1.7.9z"/></svg>';
  function pane(k, s, tags) {
    const d = document.createElement("div");
    d.className = "g-pane";
    d.setAttribute("aria-hidden", "true");
    d.style.setProperty("--k", k);
    if (s != null) d.style.setProperty("--s", s);
    d.innerHTML = tags.map(([cls, text]) => `<span class="sv-tag ${cls}">${text}</span>`).join("");
    return d;
  }
  function mini(video, media) {
    video.removeAttribute("controls");
    const spec = media.dataset.panes || "";
    if (spec === "two") media.append(pane(0, null, [["", "Video plan"]]), pane(1, null, [["", "Execution"]]));
    else if (spec.startsWith("stages:")) spec.slice(7).split("|").forEach((stage, s) =>
      media.append(pane(0, s, [["", "Video plan"], ["g-stage", stage]]), pane(1, s, [["", "Execution"]])));
    const glyph = document.createElement("div");
    glyph.className = "g-glyph";
    glyph.setAttribute("aria-hidden", "true");
    media.append(glyph);
    const bar = document.createElement("div");
    bar.className = "cbar";
    bar.setAttribute("aria-hidden", "true");
    bar.innerHTML = "<i></i>";
    media.after(bar);
    const fill = bar.firstChild;
    const title = media.closest(".card")?.querySelector("h3")?.textContent.trim() || "Video";
    media.tabIndex = 0;
    media.setAttribute("role", "button");
    // the bar follows the video every frame while it plays (timeupdate alone comes only ~4 times a second)
    let raf = 0, last = "";
    const follow = () => {
      raf = 0;
      const d = video.duration, p = (d ? Math.min(1, video.currentTime / d) : 0).toFixed(4);
      if (p !== last) { last = p; fill.style.setProperty("--p", p); }
      if (!video.paused && !video.ended) raf = requestAnimationFrame(follow);
    };
    const state = () => {
      const held = !!video.dataset.held;
      media.classList.toggle("paused", held);
      glyph.innerHTML = held ? GLYPH_PLAY : GLYPH_PAUSE;
      media.setAttribute("aria-label", `${title}: ${held ? "play" : "pause"} the video`);
      if (!raf) raf = requestAnimationFrame(follow);
    };
    ["timeupdate", "play", "pause", "seeked", "emptied", "loadedmetadata", "ended"].forEach(e => video.addEventListener(e, state));
    let popTimer = 0;
    const toggle = () => {
      if (video.dataset.held) {
        delete video.dataset.held;
        if (!video.getAttribute("src") && video.dataset.src) video.src = video.dataset.src;
        video.play().catch(() => {});
      } else {
        video.dataset.held = "1";   // site.js leaves a held video paused as it scrolls in and out
        video.pause();
      }
      state();
      media.classList.remove("show-glyph");
      void media.offsetWidth;   // (restart the pop)
      media.classList.add("show-glyph");
      clearTimeout(popTimer);
      popTimer = setTimeout(() => media.classList.remove("show-glyph"), 500);
    };
    media.addEventListener("click", toggle);
    media.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
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
    // a tap or a click on the screen (or Enter/Space) pauses or plays it, as a gallery card's does (the user, 10-16): the
    // play glyph stays while it is paused, and site.js leaves it paused as it scrolls in and out (data-held). A tab or a
    // milestone picked plays it again (js/site.js pick, js/survival.js jump)
    const screen = cinema.closest(".cinema-screen");
    const glyph = document.createElement("div");
    glyph.className = "g-glyph";
    glyph.setAttribute("aria-hidden", "true");
    screen.append(glyph);
    screen.tabIndex = 0;
    screen.setAttribute("role", "button");
    const state = () => {
      const held = !!cinema.dataset.held;
      screen.classList.toggle("paused", held);
      glyph.innerHTML = held ? GLYPH_PLAY : GLYPH_PAUSE;
      screen.setAttribute("aria-label", `Survival video: ${held ? "play" : "pause"}`);
    };
    ["play", "pause", "emptied", "ended"].forEach(e => cinema.addEventListener(e, state));
    let popTimer = 0;
    const toggle = () => {
      if (cinema.dataset.held) { delete cinema.dataset.held; cinema.play().catch(() => {}); }
      else { cinema.dataset.held = "1"; cinema.pause(); }
      state();
      screen.classList.remove("show-glyph");
      void screen.offsetWidth;   // (restart the pop)
      screen.classList.add("show-glyph");
      clearTimeout(popTimer);
      popTimer = setTimeout(() => screen.classList.remove("show-glyph"), 500);
    };
    screen.addEventListener("click", toggle);
    screen.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    state();
  }
  document.querySelectorAll(".card-media").forEach(m => { const v = m.querySelector("video"); if (v) mini(v, m); });

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
    let queued = false, onCard = 0, resizing = false;   // onCard: the card the reader is on (kept through a resize)
    function sync() {
      queued = false;
      const k = current();
      // (not under the note to turn a phone upright, js/turn.js: the track is laid out for the sideways screen there and
      // clamps to its first cards, which isn't where the reader is)
      if (!resizing && stops[k] && !document.documentElement.classList.contains("turn")) onCard = stops[k].cards[0];
      btns.forEach((b, i) => b.setAttribute("aria-current", i === k ? "true" : "false"));
    }
    track.addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(sync); } }, { passive: true });
    // (after site.js has laid the page out again: the rows stack or join with html.narrow)
    // A phone folding shut or turning lays the track out again, and its scroll snaps to whichever card is then nearest
    // (two or three on): the track goes back to the card the reader was on, once site.js has laid the page out (it looks
    // again at 400 ms, a fold's viewport settling late)
    let rT = 0, rT2 = 0;
    const keep = () => {
      build();
      const i = stops.findIndex(s => s.cards.includes(onCard));
      if (i >= 0 && i !== current()) track.scrollTo({ left: stops[i].x, behavior: "auto" });
    };
    addEventListener("resize", () => {
      resizing = true;
      clearTimeout(rT); clearTimeout(rT2);
      rT = setTimeout(keep, 250);
      rT2 = setTimeout(() => { keep(); resizing = false; sync(); }, 800);
    });
    dots.addEventListener("click", e => {
      const i = btns.indexOf(e.target.closest("button"));
      if (i >= 0) track.scrollTo({ left: stops[i].x, behavior: reduce ? "auto" : "smooth" });
    });
    build();
    addEventListener("load", build);   // (the cards take their widths as their posters and fonts come in)
  });
})();
