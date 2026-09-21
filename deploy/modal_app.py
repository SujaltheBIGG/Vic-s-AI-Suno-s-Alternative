"""
ACE-Step 1.5 on Modal — the GPU engine for Vic's AI.

This runs the exact same `acestep --enable-api` Gradio server we ran locally,
so the backend needs no code change: point ACESTEP_API_URL at the URL this
prints after deploy.

    pip install modal
    modal setup                       # one-time, opens a browser
    modal deploy deploy/modal_app.py

First deploy downloads ~6GB of weights into a Modal Volume. That happens once;
later cold starts read from the volume.
"""

import modal

APP_NAME = "vics-ai-engine"
import os
# GPU requires a payment method on the Modal account. Until one is added the
# engine runs on CPU: same code path, same API, just slow. Set MODAL_GPU=T4
# (or L4 / A10G) once funded and redeploy — nothing else changes.
GPU = os.environ.get("MODAL_GPU") or None
DEVICE = "cuda" if GPU else "cpu"
PORT = 8001

# Weights live on a Volume so they survive restarts and aren't re-downloaded.
weights = modal.Volume.from_name("acestep-weights", create_if_missing=True)
CKPT = "/weights/checkpoints"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libsndfile1")
    .run_commands(
        "git clone --depth 1 https://github.com/ace-step/ACE-Step-1.5 /opt/acestep",
        # ACE-Step vendors nano-vllm and pins CUDA torch via [tool.uv.sources],
        # which pip cannot resolve — uv is required, same as the local setup.
        "pip install --no-cache-dir uv",
        "cd /opt/acestep && uv sync --python 3.11",
    )
    # The repo's model check demands the 3.5GB reasoning LM even when it is
    # never loaded (we run --init_llm false). Dropping it from the required
    # list avoids a pointless download on every cold start.
    .run_commands(
        "python - <<'PY'\n"
        "import re, pathlib\n"
        "p = pathlib.Path('/opt/acestep/acestep/model_downloader.py')\n"
        "s = p.read_text()\n"
        "s = s.replace('\"acestep-5Hz-lm-1.7B\",', '# \"acestep-5Hz-lm-1.7B\",')\n"
        "p.write_text(s)\n"
        "print('patched MAIN_MODEL_COMPONENTS')\n"
        "PY"
    )
    .env({
        "TOKENIZERS_PARALLELISM": "false",
        "HF_HOME": "/weights/hf",
        # acestep has no --checkpoint_path flag; this env var is how the
        # checkpoint directory is set (see get_checkpoints_dir()).
        "ACESTEP_CHECKPOINTS_DIR": CKPT,
    })
)

app = modal.App(APP_NAME, image=image)


@app.function(
    gpu=GPU,
    cpu=8.0,
    memory=16384,
    volumes={"/weights": weights},
    timeout=60 * 60,
    # Keep the container alive between requests so a demo doesn't pay the
    # cold start on every track. Raise for a smoother demo, lower to save credit.
    scaledown_window=300,
    max_containers=1,
)
@modal.web_server(port=PORT, startup_timeout=60 * 15)
def engine():
    """Launch the ACE-Step Gradio server with its API endpoints enabled."""
    import subprocess

    subprocess.Popen(
        [
            "/opt/acestep/.venv/bin/acestep",
            "--port", str(PORT),
            "--server-name", "0.0.0.0",
            "--enable-api",
            "--device", DEVICE,
            "--backend", "pt",
            "--init_llm", "false",          # thinking mode off; we don't use it
        ],
        cwd="/opt/acestep",
    )


@app.function(
    volumes={"/weights": weights},
    timeout=60 * 60,
)
def warm_weights():
    """Pre-download the weights once so the first real request is fast.

        modal run deploy/modal_app.py::warm_weights
    """
    import subprocess

    subprocess.run(
        ["/opt/acestep/.venv/bin/acestep-download", "--dir", CKPT],
        cwd="/opt/acestep",
        check=False,
    )
    weights.commit()
    print("weights cached on volume")
