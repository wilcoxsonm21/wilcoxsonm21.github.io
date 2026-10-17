// turn.js: a phone held sideways is asked to turn upright.
//
// The page isn't laid out for a phone held sideways: a screen 260-430 px tall can't hold a chapter's headline, its
// animation and the transport. Instead of a cramped layout, the page covers itself with a note asking the reader to
// turn the phone, and holds still underneath: the animations stop on the click they were on (site.js reads html.turn),
// and the videos playing pause until the phone is upright again. Tablets, foldables opened up, laptops and desktop
// windows of any shape keep their landscape layouts.
//
// A phone is a touch screen whose shorter side is under PHONE_MAX css px (phones are 320-480; the smallest tablets 600
// and up). Held sideways means the screen reports a landscape orientation and the window is clearly wider than tall:
// a foldable's near-square cover screen or a phone's split-screen half isn't helped by turning, so it isn't asked.
// Loaded in <head> of the page and of the episode viewers, so the note is up before the first paint.
(() => {
  "use strict";
  if (window.top !== window) return;   // a modal's viewer frame: the page around it shows the note
  const PHONE_MAX = 600, WIDE = 1.3;
  const root = document.documentElement;
  const coarse = matchMedia("(pointer: coarse)"), noHover = matchMedia("(hover: none)");
  const portraitMQ = matchMedia("(orientation: portrait)");
  function sideways() {
    if (!coarse.matches && !noHover.matches) return false;
    if (Math.min(screen.width, screen.height) >= PHONE_MAX) return false;
    const o = screen.orientation && screen.orientation.type;
    const landscape = o ? o.startsWith("landscape") : !portraitMQ.matches;
    return landscape && innerWidth > innerHeight * WIDE;
  }

  let note = null;
  function build() {
    if (note || !document.body) return;
    note = document.createElement("div");
    note.className = "turn-note";
    note.setAttribute("role", "dialog");
    note.setAttribute("aria-modal", "true");
    note.setAttribute("aria-labelledby", "turn-title");
    note.innerHTML =
      '<svg class="turn-icon" viewBox="0 0 72 72" aria-hidden="true"><g class="turn-phone">' +
      '<rect x="24" y="12" width="24" height="48" rx="5"/><line x1="33" y1="54" x2="39" y2="54"/></g>' +
      '<path class="turn-arrow" d="M43.8 7A30 30 0 0 1 64.2 25.7M66 19L64.2 25.7L58.5 21.7"/></svg>' +
      '<p class="turn-title" id="turn-title">Please turn your phone upright.</p>' +
      '<p class="turn-sub">This page is laid out for a phone held upright.</p>';
    // nothing under the note moves while it is up: no scrolling, no taps or swipes reaching the page
    for (const ev of ["touchmove", "wheel"]) note.addEventListener(ev, e => e.preventDefault(), { passive: false });
    document.body.append(note);
  }

  // the videos playing when the note comes up pause, and play on when it goes (unless the reader paused them since:
  // data-held); the chapters' animations hold through site.js. A modal's viewer is a frame of the same origin.
  let paused = [];
  function videos() {
    const docs = [document];
    document.querySelectorAll("iframe.xmodal-frame").forEach(f => { try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) {} });
    return docs.flatMap(d => [...d.querySelectorAll("video")]);
  }
  let on = false;
  function update() {
    const s = sideways();
    if (s === on) return;
    on = s;
    root.classList.toggle("turn", on);
    if (on) {
      build();
      paused = videos().filter(v => !v.paused);
      paused.forEach(v => v.pause());
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    } else {
      paused.forEach(v => { if (!v.dataset.held && v.isConnected) v.play().catch(() => {}); });
      paused = [];
    }
    document.dispatchEvent(new CustomEvent("mirror-turn", { detail: { on } }));
  }
  update();
  if (on) document.addEventListener("DOMContentLoaded", build);
  addEventListener("resize", update);
  addEventListener("orientationchange", () => { update(); setTimeout(update, 300); });   // (iOS resizes late)
  if (screen.orientation) screen.orientation.addEventListener?.("change", update);
  // a phone turned with the page in the background, or restored from the back/forward cache
  addEventListener("pageshow", update);
  document.addEventListener("visibilitychange", update);
  window.MIRROR_TURN = { get on() { return on; } };
})();
