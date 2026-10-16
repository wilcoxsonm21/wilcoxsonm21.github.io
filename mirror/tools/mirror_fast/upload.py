"""Upload the finished 4x/16x copies (ROOT/out) to the website's video dataset. Resumable: run it again to send what is new."""
import os, sys
from huggingface_hub import HfApi
root = sys.argv[1]
HfApi().upload_large_folder(repo_id="mwilcoxson/selfimprovingvisiontoactionmodelswebsitevideos", repo_type="dataset",
                            folder_path=os.path.join(root, "out"), allow_patterns=["*.mp4"], num_workers=24)
