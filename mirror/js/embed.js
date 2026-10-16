"use strict";
// The episode viewers (eval/, basalt/) as the project page's modal. The page (js/modal.js) loads a viewer in a frame
// with ?embed; then html gets .ev-embed (css/watch.css), and the two talk by postMessage, same origin only:
//   page -> viewer: {type: "mirror-route", hash}   show this tab or episode (the viewer's own #hash)
//                   {type: "mirror-closed"}        the modal closed: stop the episode's videos
//   viewer -> page: {type: "mirror-hash", hash}    the viewer's #hash changed (the page mirrors it in its URL)
//                   {type: "mirror-escape"}        Esc with no episode open: close the modal
// On its own page none of this happens, and EMBED.setHash just sets the #hash.
const EMBED = (() => {
  const on = window.parent !== window && new URLSearchParams(location.search).has("embed");
  if (on) document.documentElement.classList.add("ev-embed");
  const post = (message) => { if (on) window.parent.postMessage(message, location.origin); };
  return {
    on,
    setHash(hash) { history.replaceState(null, "", hash); post({ type: "mirror-hash", hash }); },
    escape() { post({ type: "mirror-escape" }); },
    listen(handlers) {
      if (!on) return;
      window.addEventListener("message", (event) => {
        if (event.origin !== location.origin || event.source !== window.parent) return;
        handlers[event.data?.type]?.(event.data);
      });
    },
  };
})();
