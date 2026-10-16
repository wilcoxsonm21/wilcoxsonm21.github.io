"use strict";
// The redesigned viewers (eval/v2.html, basalt/v2.html) come in three looks, picked with ?design= (the project page
// passes its own ?design= on to the modal's frame):
//   grid    light; the episodes as a grid of stills; an episode is its video, a scrubber with its moments and the
//           current subgoal (the default)
//   cinema  dark; larger stills with the outcome on them; the video as large as it fits, with the least text
//   list    light; a list with a small still, how far each got and its time; an episode adds the planner's prompt
//           and its subgoals and deaths under a disclosure
const DESIGN = (() => {
  const all = ["grid", "cinema", "list"];
  const asked = new URLSearchParams(location.search).get("design");
  const design = all.includes(asked) ? asked : "grid";
  document.documentElement.dataset.design = design;
  return design;
})();
