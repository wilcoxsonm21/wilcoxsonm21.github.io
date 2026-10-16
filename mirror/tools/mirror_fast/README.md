---
pretty_name: Self-Improving Vision-to-Action Models, website videos
tags:
- video
- minecraft
---

# Sped-up episode videos for the project website

These are 4x and 16x copies of the evaluation episode videos in
[hwryu/mirror_diamond_eval](https://huggingface.co/datasets/hwryu/mirror_diamond_eval). The website's episode viewers
play them when a reader speeds an episode up, so the browser does not have to stream and decode the full-rate video at
16 times its normal pace.

Each file mirrors a source path with the speed added to the folder name. For example,
`active_idm/raw/07.mp4` becomes `active_idm/raw_4x/07.mp4` and `active_idm/raw_16x/07.mp4`, and the same holds for
the `plan_idm` views.

A k-times copy keeps every k-th frame of the source at the source's 20 fps (frame n of the copy is frame k·n of the
source), so time t in the copy is time k·t in the episode. Copies are H.264 (libx264, CRF 23, preset slow) with a
keyframe every 2 seconds, `+faststart`, and no audio. They were built from source revision
`efacff62f69be8367c448b1c13ee21869f56ece2`.
