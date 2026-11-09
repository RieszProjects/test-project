"""Generate novel views of an object with the OpenAI image edit endpoint.

Usage:
    python pseudo3d/gen/gpt_views.py pseudo3d/objects/pistol/views.json --raw tmp/p3d/pistol/raw \
        [--stage 1] [--only front,right] [--force]

Each view in views.json lists the reference images it is conditioned on ("refs", by view name) and a
plain-language description of the camera. Results are written to <raw>/<name>.png together with a
<name>.json holding the exact prompt, model and token usage. Existing outputs are skipped unless --force.
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
URL = "https://api.openai.com/v1/images/edits"
MODEL = "gpt-image-2.5-flare"

PROMPT = """{intro}

Create a new studio product photo of this exact same {subject}: identical shape, proportions, colors, \
materials, wood grain, screws and markings. Only the camera angle changes:

{camera}

Requirements:
- The same single object only. No hands, no stand, no text, no labels, no extra parts.
- The whole object is visible, centered, with a clear margin to every edge of the frame.
- Shot from far away with a long telephoto lens, so the view is close to orthographic (no perspective distortion).
- Background: perfectly flat, uniform chroma-key green (#00FF00). No gradient, no floor, no shadow, no reflection.
- Even, neutral studio lighting similar to the reference."""


def describe_refs(spec: dict, view: dict, by_name: dict) -> str:
    parts = []
    for i, ref in enumerate(view["refs"], 1):
        if ref == "ref":
            what = f"the reference photo, showing {spec['reference_side']}"
        else:
            what = f"an earlier view of the same object: {by_name[ref]['camera'].split(':')[0].lower()}"
        parts.append(f"Image {i} is {what}.")
    return f"The attached images show one specific {spec['subject']}. " + " ".join(parts)


def generate(view: dict, prompt: str, ref_paths: list[Path], key: str, quality: str) -> dict:
    files = [("image[]", (p.name, p.read_bytes(), "image/png")) for p in ref_paths]
    data = {"model": MODEL, "prompt": prompt, "size": view.get("size", "1536x1024"),
            "quality": quality, "n": "1", "output_format": "png"}
    for attempt in range(4):
        try:
            resp = requests.post(URL, headers={"Authorization": f"Bearer {key}"}, data=data,
                                 files=files, timeout=(20, 600))
        except requests.RequestException as exc:  # transient network failure
            err = str(exc)
        else:
            if resp.status_code == 200:
                return resp.json()
            err = f"HTTP {resp.status_code}: {resp.text[:500]}"
            if resp.status_code not in (429, 500, 502, 503, 504):
                break
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"{view['name']}: {err}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("--raw", required=True, help="directory holding the reference and generated views")
    ap.add_argument("--stage", type=int, help="only generate views of this stage")
    ap.add_argument("--only", help="comma separated view names")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--key-file", default=str(ROOT / "tmp/p3d/keys/openai.key"))
    args = ap.parse_args()

    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    by_name = {v["name"]: v for v in spec["views"]}
    raw = Path(args.raw)
    key = Path(args.key_file).read_text(encoding="utf-8").strip()
    only = set(args.only.split(",")) if args.only else None

    todo = []
    for view in spec["views"]:
        if view.get("source") == "novelai":
            continue
        if args.stage and view.get("stage") != args.stage:
            continue
        if only and view["name"] not in only:
            continue
        out = raw / f"{view['name']}.png"
        if out.exists() and not args.force:
            print(f"skip {out} (exists)")
            continue
        refs = [raw / f"{r}.png" for r in view["refs"]]
        missing = [str(p) for p in refs if not p.exists()]
        if missing:
            print(f"skip {view['name']}: missing refs {missing}", file=sys.stderr)
            continue
        prompt = PROMPT.format(intro=describe_refs(spec, view, by_name), subject=spec["subject"],
                               camera=view["camera"])
        todo.append((view, prompt, refs, out))

    def run(item):
        view, prompt, refs, out = item
        t0 = time.time()
        result = generate(view, prompt, refs, key, args.quality)
        out.write_bytes(base64.b64decode(result["data"][0]["b64_json"]))
        meta = {"model": MODEL, "quality": args.quality, "size": view.get("size"), "refs": view["refs"],
                "prompt": prompt, "usage": result.get("usage"), "seconds": round(time.time() - t0, 1)}
        out.with_suffix(".json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        return f"{out} ({meta['seconds']} s, usage={result.get('usage')})"

    failed = 0
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for fut in cf.as_completed([pool.submit(run, item) for item in todo]):
            try:
                print(fut.result(), flush=True)
            except Exception as exc:  # report and continue with the other views
                failed += 1
                print(f"FAILED {exc}", file=sys.stderr, flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
