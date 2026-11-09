"""Silhouette distance fields and the (robust) visual hull built from them.

Every view contributes a signed distance field of its silhouette (negative inside, positive outside,
in world units once divided by the view's scale). A 3D point belongs to the visual hull when it
projects inside every silhouette, i.e. when the largest of its per-view distances is negative.
The robust variant takes the k-th largest instead, so up to k-1 views may disagree about a point;
this tolerates a generated view that is missing a small part of the object.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image
from scipy import ndimage

from .camera import View


class Silhouette:
    """Mask and signed distance field of one view, at `factor` times the view's pixel resolution."""

    def __init__(self, view: View, factor: float = 1.0):
        self.factor = factor
        w, h = view.size
        if factor == 1.0:
            alpha = view.rgba[..., 3]
        else:
            size = (max(1, round(w * factor)), max(1, round(h * factor)))
            img = Image.fromarray(view.rgba[..., 3].astype(np.float32), mode="F")
            alpha = np.asarray(img.resize(size, Image.Resampling.BOX))
        self.mask = alpha > 0.5
        inside = ndimage.distance_transform_edt(self.mask)
        outside = ndimage.distance_transform_edt(~self.mask)
        self.sdf = (outside - inside).astype(np.float32)  # pixels at this level, + outside

    @property
    def shape(self) -> tuple[int, int]:
        return self.mask.shape

    def to_level(self, px: np.ndarray) -> np.ndarray:
        """Full-resolution pixel coordinates -> coordinates at this level (pixel centres aligned)."""
        return (px + 0.5) * self.factor - 0.5

    def sample(self, view: View, pts: np.ndarray) -> np.ndarray:
        """Signed distance (world units, + outside) of the projections of `pts`."""
        p = self.to_level(view.project(pts))
        h, w = self.shape
        d = ndimage.map_coordinates(self.sdf, [p[:, 1], p[:, 0]], order=1, mode="nearest")
        # beyond the image border the distance keeps growing
        dx = np.maximum(0.0, np.maximum(-p[:, 0], p[:, 0] - (w - 1)))
        dy = np.maximum(0.0, np.maximum(-p[:, 1], p[:, 1] - (h - 1)))
        d = d + np.hypot(dx, dy)
        return d / (view.s * self.factor)

    def render(self, view: View, pts: np.ndarray, radius: int = 1) -> np.ndarray:
        """Rasterise projected points (e.g. hull surface voxels) into a mask at this level."""
        p = np.rint(self.to_level(view.project(pts))).astype(np.int64)
        h, w = self.shape
        ok = (p[:, 0] >= 0) & (p[:, 0] < w) & (p[:, 1] >= 0) & (p[:, 1] < h)
        out = np.zeros((h, w), bool)
        out[p[ok, 1], p[ok, 0]] = True
        if radius > 0:
            # square footprint: voxel lattices seen along a grid axis would leave holes with a cross
            out = ndimage.binary_dilation(out, structure=np.ones((3, 3), bool), iterations=radius)
        return out


@dataclass
class Grid:
    """Axis-aligned voxel grid; voxel centres are lo + (i + 0.5) * voxel."""
    lo: np.ndarray
    voxel: float
    dims: tuple[int, int, int]

    @classmethod
    def around(cls, lo: np.ndarray, hi: np.ndarray, n_long: int) -> "Grid":
        lo, hi = np.asarray(lo, float), np.asarray(hi, float)
        voxel = float(np.max(hi - lo)) / n_long
        dims = tuple(int(np.ceil(x / voxel)) for x in (hi - lo))
        return cls(lo=lo, voxel=voxel, dims=dims)

    def centers(self) -> np.ndarray:
        axes = [self.lo[i] + (np.arange(self.dims[i]) + 0.5) * self.voxel for i in range(3)]
        g = np.meshgrid(*axes, indexing="ij")
        return np.stack([a.ravel() for a in g], axis=1)

    def index_to_world(self, idx: np.ndarray) -> np.ndarray:
        return self.lo + (np.asarray(idx, float) + 0.5) * self.voxel


def hull_field(views: list[View], sils: list[Silhouette], pts: np.ndarray, k: int = 1,
               exclude: View | None = None, chunk: int = 1 << 19, tolerance: float = 0.0) -> np.ndarray:
    """Robust hull field at each point (negative = inside).

    Fixed (reference) views must always agree; among the other views the k-th largest signed
    distance is used, so up to k-1 of them may reject a point without carving it. `tolerance`
    (world units) grows the silhouettes of the non-fixed views, absorbing small misalignments.
    """
    anchors = [(v, s) for v, s in zip(views, sils) if v.fixed and v is not exclude]
    voters = [(v, s) for v, s in zip(views, sils) if not v.fixed and v is not exclude]
    k = max(1, min(k, len(voters)))
    out = np.empty(len(pts), np.float32)
    for start in range(0, len(pts), chunk):
        p = pts[start:start + chunk]
        f = np.full(len(p), -np.inf, np.float32)
        if voters:
            vals = np.stack([s.sample(v, p) for v, s in voters])
            f = -np.partition(-vals, k - 1, axis=0)[k - 1] - tolerance
        for v, s in anchors:
            f = np.maximum(f, s.sample(v, p))
        out[start:start + chunk] = f
    return out


def occupancy(views: list[View], sils: list[Silhouette], grid: Grid, k: int = 1,
              exclude: View | None = None) -> np.ndarray:
    return (hull_field(views, sils, grid.centers(), k, exclude) < 0).reshape(grid.dims)


def surface_points(occ: np.ndarray, grid: Grid) -> np.ndarray:
    """Centres of occupied voxels that touch empty space (enough to render the hull's outline)."""
    shell = occ & ~ndimage.binary_erosion(occ, border_value=0)
    return grid.index_to_world(np.argwhere(shell))


def iou(a: np.ndarray, b: np.ndarray) -> float:
    union = np.count_nonzero(a | b)
    return np.count_nonzero(a & b) / union if union else 0.0
