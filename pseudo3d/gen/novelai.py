"""Generate one image with NovelAI (V5 Full by default) inside the Opus free allowance.

Usage:
    python pseudo3d/gen/novelai.py --prompt "..." --out path.png [--size landscape] [--seed N] [--model v5|v4.5]

The API key is read from the file given by --key-file (default: tmp/p3d/keys/novelai.key).
Only free-tier parameters are allowed: at most 1024x1024 pixels, sides multiple of 64, steps <= 28, one sample.
"""
from __future__ import annotations

import argparse
import io
import json
import random
import sys
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
URL = "https://image.novelai.net/ai/generate-image"
SIZES = {"portrait": (832, 1216), "landscape": (1216, 832), "square": (1024, 1024)}
MODELS = {
    "v5": {"id": "nai-diffusion-5-full", "steps": 23, "scale": 7.0},
    "v4.5": {"id": "nai-diffusion-4-5-full", "steps": 28, "scale": 5.0},
}
QUALITY = ", very aesthetic, masterpiece, no text"
NEGATIVE = ("lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, "
            "very displeasing, chromatic aberration, multiple views, logo, watermark, text, signature")


def build_payload(prompt: str, negative: str, model: str, width: int, height: int, seed: int) -> dict:
    spec = MODELS[model]
    params = {
        "params_version": 4, "width": width, "height": height, "scale": spec["scale"],
        "sampler": "k_euler_ancestral", "steps": spec["steps"], "n_samples": 1,
        "ucPresetId": "none", "qualityPresetId": "standard", "autoSmea": False,
        "dynamic_thresholding": False, "controlnet_strength": 1.0, "legacy": False,
        "add_original_image": True, "cfg_rescale": 0.0, "noise_schedule": "karras",
        "legacy_v3_extend": False, "use_coords": False, "legacy_uc": False,
        "normalize_reference_strength_multiple": True, "inpaintImg2ImgStrength": 1.0,
        "seed": seed, "characterPrompts": [],
        "v4_prompt": {"caption": {"base_caption": prompt, "char_captions": []},
                      "use_coords": False, "use_order": True},
        "v4_negative_prompt": {"caption": {"base_caption": negative, "char_captions": []},
                               "legacy_uc": False},
        "negative_prompt": negative, "deliberate_euler_ancestral_bug": False,
        "prefer_brownian": True, "image_format": "png", "skip_cfg_above_sigma": None,
    }
    if model == "v5":
        params["straight_alpha"] = True
    return {"input": prompt, "model": spec["id"], "action": "generate", "parameters": params,
            "use_new_shared_trial": False}


def extract_png(content: bytes) -> bytes:
    """The response is either a zip holding image_0.png or the image bytes themselves."""
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return content
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        return zf.read(zf.namelist()[0])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--negative", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", choices=sorted(SIZES), default="landscape")
    ap.add_argument("--model", choices=sorted(MODELS), default="v5")
    ap.add_argument("--seed", type=int)
    ap.add_argument("--key-file", default=str(ROOT / "tmp/p3d/keys/novelai.key"))
    args = ap.parse_args()

    width, height = SIZES[args.size]
    seed = args.seed or random.randint(1, 2**32 - 8)
    prompt = args.prompt.strip() + QUALITY
    negative = ", ".join(p for p in (NEGATIVE, args.negative.strip()) if p)
    payload = build_payload(prompt, negative, args.model, width, height, seed)

    key = Path(args.key_file).read_text(encoding="utf-8").strip()
    headers = {"Authorization": f"Bearer {key}", "Origin": "https://novelai.net",
               "Referer": "https://novelai.net/", "User-Agent": "pseudo3d-experiment/1.0", "Accept": "*/*"}
    files = {"request": ("blob", json.dumps(payload).encode("utf-8"), "application/json")}
    resp = requests.post(URL, headers=headers, files=files, timeout=(20, 240))
    if resp.status_code != 200:
        print(f"HTTP {resp.status_code}: {resp.text[:400]}", file=sys.stderr)
        return 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(extract_png(resp.content))
    meta = {"prompt": prompt, "negative": negative, "model": MODELS[args.model]["id"],
            "seed": seed, "width": width, "height": height}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{out} seed={seed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
