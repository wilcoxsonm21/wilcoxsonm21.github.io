---
pretty_name: Self-Improving Vision-to-Action Models, website videos
tags:
- video
- minecraft
---

# Episode videos for the project website

These are videos made for the website's episode viewers from the evaluation episode videos in
[hwryu/mirror_diamond_eval](https://huggingface.co/datasets/hwryu/mirror_diamond_eval). The website's episode viewers
play them so the browser never has to stream and decode a full-rate video at 16 times its normal pace, and so the
video plan and the execution can never drift apart.

The `raw_4x` and `raw_16x` folders hold sped-up copies of each execution. The `side` and `stack` folders hold the
plan and the execution in one video, at 1x and as `_4x` and `_16x` copies. In `side` the plan sits to the left of the
execution (1280x360), and in `stack` it sits above it (640x720). The plan is the right half of the `plan_idm` video
below its 20 px label row, stretched back to 640x360. In the Diamond episodes it is one frame behind the execution,
because the recording starts one frame before the first executed step, and in BASALT the two are aligned.

Each file mirrors a source path. For example, `active_idm/raw/07.mp4` has copies at `active_idm/raw_4x/07.mp4` and
`active_idm/raw_16x/07.mp4`, and its combined videos are `active_idm/side/07.mp4`, `active_idm/side_4x/07.mp4` and
so on. The older `plan_idm_4x` and `plan_idm_16x` copies are no longer used by the site.

A k-times copy keeps every k-th frame of the source at the source's 20 fps (frame n of the copy is frame k·n of the
source), so time t in the copy is time k·t in the episode. Videos are H.264 (libx264, CRF 23; preset slow for the
execution copies and medium for the combined videos) with a
keyframe every 2 seconds, `+faststart`, and no audio. They were built from source revision
`efacff62f69be8367c448b1c13ee21869f56ece2`.

The `raw_auto`, `side_auto` and `stack_auto` folders hold each Diamond episode fast-forwarded for the viewer's Auto
speed, paced as the website's survival clips are: 1x from 3 s before to 1 s after the first time the agent gets, crafts
or places each thing, around each death (2.5 s before, 1.5 s after) up to the last of those, from 6 s before to 4 s
after the last, and over the first 1.5 s; 32x otherwise, the speed eased in and out in log space over 60 source frames
outside the 1x stretches. They run at 40 fps (1x shows each frame twice) to the end of the episode. `auto/07.json` is
the time map of `raw_auto/07.mp4` and its `side_auto` and `stack_auto` siblings: `map` holds [clip frame, episode
frame] knots (linear between them, within half a frame of the true map), `speed` the speed label from each clip time
on. Oracle episodes have no plan, so only `raw_auto`. They are built by `worker_auto.py`.

The `frag` folder holds the same videos (every `raw`, `raw_4x`, `raw_16x`, `side*` and `stack*` file the site plays, the `_auto` clips too,
including the 1x executions from the source dataset) as fragmented MP4s, so the site can stream them piece by piece.
`frag/active_idm/raw_4x/07.mp4` is `active_idm/raw_4x/07.mp4` remuxed without re-encoding into one fragment per
keyframe, with an empty `moov` and a global `sidx` index right after it (ffmpeg
`-movflags +frag_keyframe+empty_moov+default_base_moof+global_sidx`), so the whole header is a few kilobytes.
