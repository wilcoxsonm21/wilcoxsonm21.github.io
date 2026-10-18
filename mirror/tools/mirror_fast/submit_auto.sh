#!/bin/bash
# Launch the Auto-clip workers on every route we can reach (CPU-only jobs); each worker drains the shared queue.
set -e
S=/data/locomotion/scratch/mhw/mirror_fast/sbatch_mirror_auto.sh
SHARED=vision-shared-l40s,vision-shared-h200,vision-shared-a100,vision-shared-h100,vision-shared-a6000,vision-shared-v100,vision-shared-rtx3090,vision-shared-titanrtx,vision-shared-rtx2080ti,vision-shared-rtx6000ada,vision-shared-rtx4090,vision-shared-rtx3080
SITZ=vision-sitzmann-l40s,vision-sitzmann-h200,vision-sitzmann-a100,vision-sitzmann-rtx4090
cd /tmp
sbatch --parsable -A vision-sitzmann -q vision-sitzmann-cpu -p $SITZ --array=0-63 $S
sbatch --parsable -A vision-sitzmann -q shared-if-available -p $SHARED --array=0-159 $S
sbatch --parsable -A csail -q shared-if-available -p csail-shared-h200,csail-shared-l40s --array=0-63 $S
sbatch --parsable -A vision-sitzmann -q tig-main -p tig-cpu --array=0-15 $S
