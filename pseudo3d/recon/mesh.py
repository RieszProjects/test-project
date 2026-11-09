"""Surface extraction: robust hull field -> cleaned, smoothed, decimated triangle mesh."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage, sparse
from skimage import measure

from .camera import View
from .hull import Grid, Silhouette, hull_field


@dataclass
class Mesh:
    vertices: np.ndarray  # (N, 3) float32
    faces: np.ndarray     # (M, 3) uint32
    normals: np.ndarray   # (N, 3) float32, unit length

    @property
    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        return self.vertices.min(0), self.vertices.max(0)


def sample_field(views: list[View], grid: Grid, k: int, tolerance: float = 0.0) -> np.ndarray:
    """Hull field on the grid using full-resolution silhouettes (sub-voxel accurate surface)."""
    sils = [Silhouette(v, 1.0) for v in views]
    return hull_field(views, sils, grid.centers(), k=k, tolerance=tolerance).reshape(grid.dims)


def keep_main_body(field: np.ndarray, min_fraction: float = 0.02) -> np.ndarray:
    """Push isolated blobs (much smaller than the main body) outside the surface."""
    inside = field < 0
    labels, n = ndimage.label(inside)
    if n <= 1:
        return field
    sizes = ndimage.sum_labels(inside, labels, index=np.arange(1, n + 1))
    drop = np.zeros(n + 1, bool)
    drop[1:] = sizes < min_fraction * sizes.max()
    out = field.copy()
    out[drop[labels]] = np.abs(out[drop[labels]]) + 1e-3
    return out


def vertex_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    tri = vertices[faces]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])  # area weighted
    vn = np.zeros_like(vertices)
    for i in range(3):
        np.add.at(vn, faces[:, i], fn)
    return vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)


def taubin_smooth(vertices: np.ndarray, faces: np.ndarray, iterations: int = 12,
                  lam: float = 0.5, mu: float = -0.53) -> np.ndarray:
    """Low-pass filter that removes marching-cubes staircase without shrinking the shape."""
    n = len(vertices)
    i = np.concatenate([faces[:, 0], faces[:, 1], faces[:, 2], faces[:, 1], faces[:, 2], faces[:, 0]])
    j = np.concatenate([faces[:, 1], faces[:, 2], faces[:, 0], faces[:, 0], faces[:, 1], faces[:, 2]])
    adj = sparse.coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr()
    adj.data[:] = 1.0
    deg = np.asarray(adj.sum(axis=1)).ravel()
    walk = sparse.diags(1.0 / np.maximum(deg, 1)) @ adj
    v = vertices.astype(np.float64)
    for _ in range(iterations):
        v = v + lam * (walk @ v - v)
        v = v + mu * (walk @ v - v)
    return v.astype(np.float32)


def extract(views: list[View], lo: np.ndarray, hi: np.ndarray, voxel: float, k: int = 2,
            tolerance: float = 0.0, field_sigma: float = 0.0, smooth_iters: int = 12,
            target_faces: int = 120_000, log=print) -> Mesh:
    """Mesh the robust hull.

    field_sigma (in voxels) low-pass filters the field before meshing; it rounds the small ridges
    and notches left where generated views disagree by a few pixels.
    """
    grid = Grid.around(lo, hi, int(np.ceil(np.max(hi - lo) / voxel)))
    log(f"  grid {grid.dims} ({np.prod(grid.dims) / 1e6:.1f} M voxels, voxel {grid.voxel:.4f})")
    field = sample_field(views, grid, k, tolerance)
    if field_sigma > 0:
        field = ndimage.gaussian_filter(field, field_sigma)
    field = keep_main_body(field)
    # pad with "outside" so the surface is closed even where the object touches the box
    padded = np.pad(field, 1, constant_values=float(np.abs(field).max()))
    verts, faces, _, _ = measure.marching_cubes(padded, level=0.0, spacing=(grid.voxel,) * 3,
                                                gradient_direction="ascent")  # outward winding
    verts = verts + grid.lo - grid.voxel * 0.5  # voxel centres sit at lo + (i + 0.5) * voxel; pad = 1
    log(f"  marching cubes: {len(verts)} vertices, {len(faces)} faces")
    verts = taubin_smooth(verts, faces, smooth_iters)
    if target_faces and len(faces) > target_faces:
        import fast_simplification
        verts, faces = fast_simplification.simplify(verts.astype(np.float32), faces.astype(np.int64),
                                                    target_reduction=1 - target_faces / len(faces))
        log(f"  decimated to {len(verts)} vertices, {len(faces)} faces")
    verts = verts.astype(np.float32)
    faces = faces.astype(np.uint32)
    return Mesh(vertices=verts, faces=faces, normals=vertex_normals(verts, faces).astype(np.float32))
