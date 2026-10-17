#!/bin/bash
# One worker of the Mirror plan-and-execution video build (worker_both.py): pulls videos off the shared queue until none are left.
# Submitted as arrays on several partition/qos pairs (see submit.sh); the account, partition and qos come from there.
#SBATCH --cpus-per-task=8
#SBATCH --mem=24G
#SBATCH --time=4:00:00
#SBATCH --job-name=mirror_both
#SBATCH --output=/data/locomotion/scratch/mhw/mirror_fast/logs/%x_%A_%a.out
#SBATCH --error=/data/locomotion/scratch/mhw/mirror_fast/logs/%x_%A_%a.err

set -e
R=/data/locomotion/scratch/mhw/mirror_fast
echo "host $(hostname) job ${SLURM_JOB_ID} partition ${SLURM_JOB_PARTITION}"
export PATH=$R/bin:$PATH
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || { echo "ERROR: no ffmpeg/ffprobe on $(hostname)" >&2; exit 1; }
export HF_TOKEN=$(cat $R/.hf_token)
export HF_HUB_DISABLE_PROGRESS_BARS=1
export WORK_TMP=/dev/shm
cd /tmp
exec /data/scratch/mhw/miniconda3/envs/supe/bin/python -I $R/worker_both.py $R --threads 8
