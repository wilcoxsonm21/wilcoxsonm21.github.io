#!/bin/bash
# Upload one folder of Auto clips (upload_auto.py) as one commit; submit as an array over `upload_auto.py ROOT list`.
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=4:00:00
#SBATCH --job-name=mirror_auto_up
#SBATCH --output=/data/locomotion/scratch/mhw/mirror_fast/logs/%x_%A_%a.out
#SBATCH --error=/data/locomotion/scratch/mhw/mirror_fast/logs/%x_%A_%a.err

set -e
R=/data/locomotion/scratch/mhw/mirror_fast
echo "host $(hostname) job ${SLURM_JOB_ID} task ${SLURM_ARRAY_TASK_ID}"
export HF_TOKEN=$(cat $R/.hf_token)
export HF_HUB_DISABLE_PROGRESS_BARS=1
export HF_HOME=/tmp/mhw_hf_${SLURM_JOB_ID}_${SLURM_ARRAY_TASK_ID}
cd /tmp
/data/scratch/mhw/miniconda3/envs/supe/bin/python -I $R/upload_auto.py $R $SLURM_ARRAY_TASK_ID
rm -rf $HF_HOME
