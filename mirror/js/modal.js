"use strict";
// The episode viewers as Apple-style modals: a link with data-modal="<key>" (and data-modal-hash, a tab or episode in
// the viewer's own #hash form) opens that viewer (eval/, basalt/) in a sheet over the dimmed page, instead of following
// its href to the viewer's own page. The sheet rises in; its round close button, Esc, a click on the dimmed page or
// the browser's Back closes it, and the page stays where it was. While open the URL is #<key>[/<viewer hash>], so a
// link can open it (with the page under it at the modal's section). Each viewer loads once, in a
// frame with ?embed (js/embed.js), and stays loaded; the two talk by postMessage.
(() => {
  const MODALS = {
    "diamond-episodes": { src: "eval/", section: "survival", title: "MineRL Diamond Challenge: all 384 evaluation episodes" },
    "basalt-episodes": { src: "basalt/", section: "basalt", title: "MineRL BASALT: all 44 evaluation episodes" },
  };
  const parse = (url) => {
    const [key, ...rest] = decodeURIComponent(new URL(url, location.href).hash.slice(1)).split("/");
    return key in MODALS ? { key, inner: rest.join("/") } : null;
  };
  // site.js asks this: opening or leaving a modal's #hash isn't a jump to an anchor, and a link to one lands the page on
  // the section the modal belongs to
  window.MIRROR_MODAL = { owns: (url) => !!parse(url), section: (url) => MODALS[parse(url)?.key]?.section };

  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const modal = document.createElement("div");
  modal.className = "xmodal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.tabIndex = -1;
  modal.innerHTML = `<div class="xmodal-sheet"><button class="xmodal-close" aria-label="Close">
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg></button></div>`;
  const sheet = modal.firstElementChild, closeBtn = sheet.firstElementChild;
  // the viewers are dark, as the survival section: the sheet's ground (behind the frame) and its close button follow these
  for (const [name, value] of [["--bg-2", "#0f0e0d"], ["--ink", "#f5f5f7"], ["--ink-2", "#d2d2d7"]]) sheet.style.setProperty(name, value);
  const frames = {};
  let current = null, pushed = false, hideTimer = 0, paused = [], lastFocus = null;
  const behind = () => [...document.body.children].filter((el) => el !== modal && el.tagName !== "SCRIPT");
  const send = (key, message) => frames[key]?.contentWindow?.postMessage(message, location.origin);

  function open(key, inner, { push = true } = {}) {
    const url = "#" + key + (inner ? "/" + inner : "");
    if (current === key) {   // already open (Forward, or a second link): just go there
      send(key, { type: "mirror-route", hash: inner });
      return;
    }
    if (current) finish();
    current = key;
    let frame = frames[key];
    if (!frame) {
      frame = frames[key] = document.createElement("iframe");
      frame.className = "xmodal-frame";
      frame.title = MODALS[key].title;
      frame.src = MODALS[key].src + "?embed" + (inner ? "#" + inner : "");
      sheet.append(frame);
    } else send(key, { type: "mirror-route", hash: inner });
    for (const k in frames) frames[k].hidden = k !== key;
    modal.setAttribute("aria-label", MODALS[key].title);
    clearTimeout(hideTimer);
    modal.hidden = false;
    modal.getBoundingClientRect();   // start the rise from below
    modal.classList.add("is-open");
    root.classList.add("modal-open");
    for (const el of behind()) el.inert = true;
    // the page's videos pause behind the sheet, and play on when it closes
    paused = [...document.querySelectorAll("video")].filter((v) => !v.paused);
    paused.forEach((v) => v.pause());
    lastFocus = document.activeElement;
    modal.focus({ preventScroll: true });   // the dialog, not its close button: no focus ring on opening
    if (push) { history.pushState({ mirrorModal: key }, "", url); pushed = true; }
    else history.replaceState(history.state, "", url);
  }

  // the sheet goes; the page comes back as it was
  function finish() {
    send(current, { type: "mirror-closed" });
    current = null;
    modal.classList.remove("is-open");
    root.classList.remove("modal-open");
    for (const el of behind()) el.inert = false;
    paused.forEach((v) => v.play().catch(() => {}));
    paused = [];
    hideTimer = setTimeout(() => { modal.hidden = true; }, REDUCED ? 0 : 320);   // (css: the closing transitions, .3 s)
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  function close() {
    if (!current) return;
    if (pushed) { pushed = false; history.back(); return; }   // popstate finishes it
    history.replaceState(null, "", location.pathname + location.search);
    finish();
  }

  addEventListener("popstate", () => {
    const m = parse(location.href);
    if (m) { pushed = history.state?.mirrorModal === m.key; open(m.key, m.inner, { push: false }); }
    else if (current) { pushed = false; finish(); }
  });

  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  // a finger on the dimmed page doesn't scroll the page behind
  modal.addEventListener("touchmove", (e) => { if (!e.target.closest(".xmodal-frame") && e.cancelable) e.preventDefault(); }, { passive: false });
  // while open, keys are the modal's: Esc closes it, and the page's own keys (a chapter's arrows, Space) don't act
  addEventListener("keydown", (e) => {
    if (!current) return;
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); close(); }
  }, true);
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || !current || e.source !== frames[current]?.contentWindow) return;
    if (e.data?.type === "mirror-escape") close();
    // the viewer's tab or episode, in the page's URL, so a copied link opens it
    else if (e.data?.type === "mirror-hash") {
      const inner = String(e.data.hash || "").replace(/^#/, "");
      history.replaceState(history.state, "", "#" + current + (inner ? "/" + inner : ""));
    }
  });

  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-modal]");
    if (!link || !(link.dataset.modal in MODALS) || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open(link.dataset.modal, link.dataset.modalHash || "");
  });

  document.body.append(modal);
  // a link to #diamond-episodes: the page goes under it as a history entry of its own (without the #hash), so Back or
  // the close button leaves the modal, not the site
  const first = parse(location.href);
  if (first) {
    // (manual first, as site.js sets it later: an entry keeps the mode it was made with, and with "auto" Back from the
    // modal would put the page back at the top, where it was when this entry was made)
    try { history.scrollRestoration = "manual"; } catch (e) {}
    history.replaceState(null, "", location.pathname + location.search);
    open(first.key, first.inner);
  }
})();
