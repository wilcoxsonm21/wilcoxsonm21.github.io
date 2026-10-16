// Portrait layout of the exploration scene, for phones held upright (?portrait; see tools/build_scenes.py). The two
// maps stack: the random-exploration map moves up and shrinks while the video-guided copy comes into focus below it,
// and for the comparison they sit one above the other. Each layout starts at the top of the stage, right under the
// page's caption, and any room a click leaves goes to the bottom. Same cards, beats and timing as the deck.
window.PORTRAIT = !window.SCENE_PORTRAIT ? null : (() => {
  const M = 30, GAP = 18, S = .84;   // top margin, gap between the maps, the maps' scale
  const CH = 740, LB = 76;            // a card's height, and its label's below it (both scale with the card)
  const top = (y, s) => y + CH * s / 2, block = s => (CH + LB) * s;   // a card's centre, given its top; card + label
  const SP = 1.15;   // the scene's SPEED
  const FOOT = 40;   // room under the last label, clear of the page's progress bar (it was 12: the label sat on it)
  return {
    W: 1080, H: Math.round(M + 2 * block(S) + GAP + FOOT),
    // how much of the stage each click fills, following the cards: the random map alone; then the small random map
    // over the guided one (with the "plan" move), and both at full size only once "compare" grows the first back
    // One entry per click as the page plays them: the adapter splits the deck's second click into its beats
    // (scene-adapter.js, "stops"), and "compare" opens the last one (its cards move from about .2 s to 1.05 s in)
    FILL: (() => {
      const one = Math.round(M + block(S) + FOOT), plan = Math.round(M + block(.5) + GAP + block(S) + FOOT);
      const both = Math.round(M + 2 * block(S) + GAP + FOOT);
      return [one, [{ h: plan, at: .1 / SP, dur: 1.15 / SP }], plan, plan, plan, plan,
              [{ h: both, at: .2, dur: 1.2 / SP }]];
    })(),
    // each card's centre, zoom and opacity per camera layout (the scene's LAYOUT; null keeps the opacity)
    LAYOUT: {
      focus:   { rcard: [540, top(M, S), S, 1], gcard: [540, top(M, S), S, null] },
      plan:    { rcard: [540, top(M, .5), .5, null], gcard: [540, top(M + block(.5) + GAP, S), S, null] },
      compare: { rcard: [540, top(M, S), S, 1], gcard: [540, top(M + block(S) + GAP, S), S, 1] },
    },
  };
})();
