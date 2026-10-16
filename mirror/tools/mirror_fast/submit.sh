#!/bin/bash
# Launch the Mirror 4x/16x workers on every GPU partition we can reach (CPU-only jobs; the queue balances them).
set -e
S=/data/locomotion/scratch/mhw/mirror_fast/sbatch_mirror_fast.sh
SHARED=vision-shared-l40s,vision-shared-h200,csail-shared-h200,vision-shared-a100,vision-shared-h100,vision-shared-a6000,vision-shared-v100,vision-shared-rtx3090,vision-shared-titanrtx,vision-shared-rtx2080ti,vision-shared-rtx6000ada,vision-shared-rtx4090,vision-shared-rtx3080,csail-shared-l40s
SITZ=vision-sitzmann-l40s,vision-sitzmann-h200,vision-sitzmann-a100,vision-sitzmann-rtx4090
cd /tmp
sbatch --parsable -A vision-sitzmann -q shared-if-available -p $SHARED --array=0-119 $S
sbatch --parsable -A vision-sitzmann -q vision-sitzmann-low -p $SITZ --array=0-39 $S
