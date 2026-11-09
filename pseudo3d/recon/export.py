"""Web assets for the viewer: one texture per view, the mesh as a binary blob, and scene.json.

Every view gets a 3x4 matrix that maps a (centred) world point to (u, v, depth) where (u, v) are
texture coordinates of that view's image (v grows downward, matching the uploaded image rows) and
depth is in [0, 1] with 0 nearest to that camera. The viewer uses the same matrices both to project
the photos onto the surface and to render per-view depth maps for visibility tests.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from .camera import View
from .mesh import Mesh


def bleed_colours(rgba: np.ndarray) -> np.ndarray:
    """Copy each transparent pixel's colour from the nearest opaque pixel.

    Bilinear filtering near the silhouette then mixes object colours only, never the green screen.
    """
    solid = rgba[..., 3] > 0.5
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    out = rgba.copy()
    out[..., :3] = rgba[iy, ix, :3]
    return out


def texture_layer(view: View, size: int, pad: int = 8) -> tuple[Image.Image, float, float, float]:
    """Fit the view's image into a size x size RGBA square; returns (image, scale, offset_x, offset_y)."""
    w, h = view.size
    k = (size - 2 * pad) / max(w, h)
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    rgba = bleed_colours(view.rgba)
    img = Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    k_x, k_y = nw / w, nh / h
    ox, oy = (size - nw) // 2, (size - nh) // 2
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, (ox, oy))
    # fill the border too so filtering outside the photo stays on object colours
    arr = bleed_colours(np.asarray(canvas).astype(np.float32) / 255)
    canvas = Image.fromarray((arr * 255 + 0.5).astype(np.uint8), "RGBA")
    return canvas, (k_x + k_y) / 2, float(ox), float(oy)


def view_matrix(view: View, k: float, ox: float, oy: float, size: int, centre: np.ndarray,
                radius: float) -> np.ndarray:
    """3x4 rows mapping a centred world point to (u, v, depth) for this view's texture layer."""
    R = view.rotation()
    row_u = k * view.sx / size * R[0]
    row_v = -k * view.sy / size * R[1]
    off_u = (k * (view.cx + 0.5) + ox) / size
    off_v = (k * (view.cy + 0.5) + oy) / size
    row_d = -0.5 / radius * R[2]
    off_d = 0.5
    M = np.zeros((3, 4))
    M[0, :3], M[1, :3], M[2, :3] = row_u, row_v, row_d
    # the mesh is exported centred, so fold the original centre into the offsets
    M[0, 3] = off_u + row_u @ centre
    M[1, 3] = off_v + row_v @ centre
    M[2, 3] = off_d
    return M


def write_mesh(mesh: Mesh, centre: np.ndarray, path: Path) -> dict:
    """positions float32 xyz | normals int16 xyz (normalised) | indices uint16 or uint32."""
    pos = (mesh.vertices - centre).astype(np.float32)
    nrm = np.clip(np.rint(mesh.normals * 32767), -32767, 32767).astype(np.int16)
    idx = mesh.faces.astype(np.uint16 if len(pos) < 65536 else np.uint32)
    blobs, layout, offset = [], {}, 0
    for name, arr in (("positions", pos), ("normals", nrm), ("indices", idx)):
        data = arr.tobytes()
        layout[name] = {"offset": offset, "bytes": len(data), "type": str(arr.dtype)}
        blobs.append(data)
        offset += len(data)
        if offset % 4:  # keep every array 4-byte aligned for typed-array views
            blobs.append(b"\0" * (4 - offset % 4))
            offset += 4 - offset % 4
    path.write_bytes(b"".join(blobs))
    return {"file": path.name, "vertexCount": int(len(pos)), "indexCount": int(idx.size), **layout}


def export(views: list[View], mesh: Mesh, out_dir: Path, meta: dict, tex_size: int = 1024,
           quality: int = 90) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    lo, hi = mesh.bounds
    centre = (lo + hi) / 2
    radius = float(np.linalg.norm(mesh.vertices - centre, axis=1).max()) * 1.02
    entries = []
    for view in views:
        layer, k, ox, oy = texture_layer(view, tex_size)
        fname = f"view_{view.name}.webp"
        layer.save(out_dir / fname, "WEBP", quality=quality, method=6)
        M = view_matrix(view, k, ox, oy, tex_size, centre, radius)
        entries.append({**view.summary(), "file": fname,
                        "matrix": np.round(M, 7).ravel().tolist(),
                        "dir": np.round(view.rotation()[2], 6).tolist(),
                        "up": np.round(view.rotation()[1], 6).tolist(),
                        "label": view.meta.get("label", view.name),
                        "source": view.meta.get("source", "")})
    mesh_info = write_mesh(mesh, centre, out_dir / "mesh.bin")
    scene = {**meta, "texSize": tex_size, "radius": radius,
             "bounds": [np.round(lo - centre, 5).tolist(), np.round(hi - centre, 5).tolist()],
             "mesh": mesh_info, "views": entries}
    (out_dir / "scene.json").write_text(json.dumps(scene, ensure_ascii=False, indent=1), encoding="utf-8")
    return scene
