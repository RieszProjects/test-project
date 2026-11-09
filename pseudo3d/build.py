"""Build a pseudo-3D model from a set of chroma-keyed views.

Usage (from the repository root):
    pseudo3d/.venv/bin/python pseudo3d/build.py pseudo3d/objects/pistol/views.json \
        --raw tmp/p3d/pistol/raw --work tmp/p3d/pistol/work --out pseudo3d/viewer/assets/pistol

Steps: green-screen keying -> silhouette-based camera estimation -> robust visual hull -> mesh
-> web assets. Camera estimates are written next to views.json as cameras.json; pass --reuse-cameras
to skip the estimation and rebuild the mesh and assets from that file.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

from recon.align import Aligner, Level, anchor_reference
from recon.camera import View
from recon.export import export
from recon.keying import key_image
from recon.mesh import extract


def log(msg: str) -> None:
    print(msg, flush=True)


def keyed_views(spec: dict, raw: Path, work: Path) -> list[View]:
    """Key every raw image once (cached in work/keyed) and wrap it as a View at its nominal pose."""
    (work / "keyed").mkdir(parents=True, exist_ok=True)
    views = []
    for entry in spec["views"]:
        name = entry["name"]
        src, cached = raw / f"{name}.png", work / "keyed" / f"{name}.png"
        if not cached.exists() or cached.stat().st_mtime < src.stat().st_mtime:
            img = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
            res = key_image(img)
            Image.fromarray((res.rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(cached)
            log(f"  keyed {name}: crop {res.rgba.shape[1]}x{res.rgba.shape[0]}")
        rgba = np.asarray(Image.open(cached)).astype(np.float32) / 255
        views.append(View(name=name, rgba=rgba, az=entry["az"], el=entry["el"],
                          nominal=(entry["az"], entry["el"]),
                          meta={"label": entry.get("label", name),
                                "source": "NovelAI" if entry.get("source") == "novelai" else "GPT"}))
    return views


def estimate_cameras(views: list[View], rounds: int) -> tuple[dict, np.ndarray, np.ndarray]:
    anchor_reference(views[0])
    aligner = Aligner(views, log=log)
    coarse = Level(px_per_unit=60)
    log("initial framing")
    aligner.initialise(coarse, [v.name for v in views[1:]])
    log("pose refinement (pairwise epipolar consistency)")
    t0 = time.time()
    consistency = aligner.refine(rounds=rounds)
    log(f"  done in {time.time() - t0:.0f} s")
    aligner.update_bounds(coarse)
    report = {"consistency": consistency,
              "hull_k1": aligner.hull_scores(Level(px_per_unit=120), k=1),
              "hull_k2": aligner.hull_scores(Level(px_per_unit=120), k=2)}
    return report, aligner.lo, aligner.hi


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("--raw", required=True, help="directory with <view>.png photos on a green screen")
    ap.add_argument("--work", required=True, help="cache directory for keyed images")
    ap.add_argument("--out", required=True, help="output directory for the viewer assets")
    ap.add_argument("--reuse-cameras", action="store_true")
    ap.add_argument("--rounds", type=int, default=8, help="pose refinement rounds")
    ap.add_argument("--k", type=int, default=2, help="robust hull: generated views allowed to disagree + 1")
    ap.add_argument("--tol", type=float, default=0.006, help="silhouette tolerance of generated views (world units)")
    ap.add_argument("--field-sigma", type=float, default=1.5, help="field smoothing before meshing (voxels)")
    ap.add_argument("--voxel", type=float, default=0.007, help="voxel size (reference half length = 1)")
    ap.add_argument("--faces", type=int, default=110_000, help="target triangle count")
    ap.add_argument("--tex", type=int, default=1024, help="texture size per view")
    args = ap.parse_args()

    spec_path = Path(args.spec)
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    cams_path = spec_path.with_name("cameras.json")

    log("keying")
    views = keyed_views(spec, Path(args.raw), Path(args.work))

    if args.reuse_cameras:
        cams = json.loads(cams_path.read_text(encoding="utf-8"))
        by_name = {c["name"]: c for c in cams["views"]}
        for v in views:
            c = by_name[v.name]
            v.az, v.el, v.roll, v.s, v.cx, v.cy, v.aspect = (c[k] for k in
                                                             ("az", "el", "roll", "s", "cx", "cy", "aspect"))
        views[0].fixed = True
        lo, hi = np.array(cams["bounds"][0]), np.array(cams["bounds"][1])
        report = cams.get("report", {})
    else:
        report, lo, hi = estimate_cameras(views, args.rounds)
        cams = {"views": [{**v.summary(), "s": v.s, "cx": v.cx, "cy": v.cy, "aspect": v.aspect}
                          for v in views],
                "bounds": [lo.tolist(), hi.tolist()], "report": report}
        cams_path.write_text(json.dumps(cams, indent=1, ensure_ascii=False), encoding="utf-8")
        log(f"cameras -> {cams_path}")

    log("surface")
    mesh = extract(views, lo, hi, voxel=args.voxel, k=args.k, tolerance=args.tol,
                   field_sigma=args.field_sigma, target_faces=args.faces, log=log)
    log("export")
    meta = {"object": spec["object"], "title": spec.get("title", spec["object"]),
            "hull": {"k": args.k, "tolerance": args.tol, "fieldSigma": args.field_sigma}, "report": report}
    scene = export(views, mesh, Path(args.out), meta, tex_size=args.tex)
    log(f"  {scene['mesh']['vertexCount']} vertices, {scene['mesh']['indexCount'] // 3} triangles "
        f"-> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
