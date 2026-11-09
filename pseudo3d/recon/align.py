"""Camera pose estimation from silhouettes alone.

Generated views only come with a rough description of the camera ("45 degrees to the left, slightly
from above"), and their scale and framing are arbitrary. Every view except the fixed reference gets
seven unknowns (az, el, roll, log scale, cx, cy, aspect), estimated from the silhouettes only.

The main criterion is pairwise epipolar consistency. For two orthographic cameras with view directions
d_i and d_j, every plane spanned by d_i and d_j projects to a line in both images, so projecting both
silhouettes onto the common axis a = d_i x d_j must give the same set of positions (the outer ends of
that set are the classical epipolar tangents). The score of a pair is the 1D IoU of the two
projections; it is symmetric and anchored to the reference through every pair that includes it.

A leave-one-out score (IoU between a view's silhouette and the outline of the visual hull carved by all
other views) is kept for diagnostics. It is not used for optimisation because strict intersection makes
it drift: each carve trims the hull slightly, every view then shrinks to match, and the whole set
contracts away from the reference.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
from scipy import ndimage

from .camera import View
from .hull import Grid, Silhouette, iou, occupancy, surface_points

ASPECT_SIGMA = 0.10       # generated views are often stretched by several percent along thin axes
MIN_PAIR_SIN = np.sin(np.radians(15))  # near-parallel view pairs carry no epipolar information


def prior_sigma(view: View) -> float:
    """Expected angular error (degrees) of a generated view, by the kind of camera requested."""
    az, el = view.nominal
    axis_aligned = abs(abs(el) - 90) < 1 or (abs(el) < 1 and abs(az % 90) < 1)
    return 6.0 if axis_aligned else 15.0


def prior_penalty(view: View) -> float:
    """Squared deviation from the requested camera, in units of the expected error."""
    az0, el0 = view.nominal
    d_az = (view.az - az0 + 180) % 360 - 180
    sigma = prior_sigma(view)
    return float((d_az / sigma) ** 2 + ((view.el - el0) / sigma) ** 2 + (view.roll / sigma) ** 2
                 + (view.aspect / ASPECT_SIGMA) ** 2)


def anchor_reference(ref: View, half_length: float = 1.0) -> None:
    """Put the reference's silhouette centre at the origin; its width spans 2 * half_length units."""
    ys, xs = np.nonzero(ref.mask)
    ref.s = (xs.max() - xs.min() + 1) / (2 * half_length)
    ref.cx = (xs.max() + xs.min()) / 2
    ref.cy = (ys.max() + ys.min()) / 2
    ref.aspect = 0.0
    ref.fixed = True


def mask_bbox(mask: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    return np.array([xs.min(), ys.min(), xs.max() + 1, ys.max() + 1], float)


def contour(mask: np.ndarray, max_points: int = 6000) -> np.ndarray:
    """Boundary pixel centres (x, y) of a mask; their projection onto any line covers the mask's."""
    edge = mask & ~ndimage.binary_erosion(mask, border_value=0)
    ys, xs = np.nonzero(edge)
    pts = np.stack([xs, ys], axis=1).astype(np.float64)
    step = max(1, len(pts) // max_points)
    return pts[::step]


def fit_framing(view: View, pts: np.ndarray, mode: str = "both") -> None:
    """Choose s, cx, cy so the projected points' bounding box matches the view's silhouette box.

    mode "height" matches only the vertical extent (for level views, where the object's height is
    known but its depth is not yet), "width" only the horizontal one (top/bottom views), "both" the
    geometric mean of the two.
    """
    target = mask_bbox(view.mask)
    uv = pts @ view.rotation()[:2].T
    u0, u1 = uv[:, 0].min(), uv[:, 0].max()
    v0, v1 = uv[:, 1].min(), uv[:, 1].max()
    ea = float(np.exp(view.aspect / 2))  # the current aspect is kept; only s, cx, cy change
    sw = (target[2] - target[0]) / max(u1 - u0, 1e-9) / ea
    sh = (target[3] - target[1]) / max(v1 - v0, 1e-9) * ea
    view.s = {"height": sh, "width": sw, "both": float(np.sqrt(sw * sh))}[mode]
    view.cx = (target[0] + target[2]) / 2 - view.sx * (u0 + u1) / 2
    view.cy = (target[1] + target[3]) / 2 + view.sy * (v0 + v1) / 2


@dataclass
class Level:
    """Working resolution for hull computations: image pixels per world unit, voxels ~1.5 px wide."""
    px_per_unit: float
    voxel_px: float = 1.5

    def silhouettes(self, views: list[View]) -> list[Silhouette]:
        return [Silhouette(v, min(1.0, self.px_per_unit / v.s)) for v in views]

    def grid(self, lo: np.ndarray, hi: np.ndarray) -> Grid:
        voxel = self.voxel_px / self.px_per_unit
        return Grid.around(lo, hi, int(np.ceil(np.max(hi - lo) / voxel)))


class Aligner:
    def __init__(self, views: list[View], log=print, prior_weight: float = 0.003,
                 bin_width: float = 0.005, ref_weight: float = 4.0):
        self.views = views
        # The reference is the one image every generated view was derived from, so the geometry should
        # agree with it first; without extra weight the generated views outvote it and the recovered
        # object takes their (often slightly different) proportions.
        self.ref_weight = ref_weight
        self.ref = next(v for v in views if v.fixed)
        self.log = log
        self.prior_weight = prior_weight
        self.bin_width = bin_width
        self.contours = {v.name: contour(v.mask) for v in views}
        self.lo, self.hi = self.initial_bounds()

    # ------------------------------------------------------------------ bounds
    def initial_bounds(self) -> tuple[np.ndarray, np.ndarray]:
        """Box from the reference silhouette; depth is a generous guess refined later."""
        b = mask_bbox(self.ref.mask)
        x0, x1 = (b[0] - self.ref.cx) / self.ref.s, (b[2] - self.ref.cx) / self.ref.s
        y1, y0 = (self.ref.cy - b[1]) / self.ref.s, (self.ref.cy - b[3]) / self.ref.s
        depth = 0.6 * max(x1 - x0, y1 - y0)
        pad = 0.08 * max(x1 - x0, y1 - y0)
        return (np.array([x0 - pad, y0 - pad, -depth]), np.array([x1 + pad, y1 + pad, depth]))

    def update_bounds(self, level: Level, k: int = 2, margin: float = 0.1) -> None:
        """Fit the box to the current hull (plus a margin) so later grids spend voxels well."""
        grid = level.grid(self.lo, self.hi)
        occ = occupancy(self.views, level.silhouettes(self.views), grid, k=k)
        if not occ.any():
            return
        idx = np.argwhere(occ)
        lo = grid.index_to_world(idx.min(0)) - grid.voxel
        hi = grid.index_to_world(idx.max(0)) + grid.voxel
        pad = margin * np.max(hi - lo)
        self.lo, self.hi = lo - pad, hi + pad

    # ------------------------------------------------------------------ epipolar consistency
    def plane_coords(self, view: View) -> np.ndarray:
        """Contour points of a view expressed in its image plane, in world units (right, up)."""
        c = self.contours[view.name]
        return np.stack([(c[:, 0] - view.cx) / view.sx, -(c[:, 1] - view.cy) / view.sy], axis=1)

    def pair_score(self, vi: View, vj: View, ci: np.ndarray | None = None,
                   cj: np.ndarray | None = None) -> tuple[float, float]:
        """(1D IoU of the two silhouettes projected on the common axis, weight of the pair)."""
        Ri, Rj = vi.rotation(), vj.rotation()
        axis = np.cross(Ri[2], Rj[2])
        n = float(np.linalg.norm(axis))
        if n < MIN_PAIR_SIN:
            return 0.0, 0.0
        axis /= n
        ci = self.plane_coords(vi) if ci is None else ci
        cj = self.plane_coords(vj) if cj is None else cj
        ti = ci @ (Ri[:2] @ axis)
        tj = cj @ (Rj[:2] @ axis)
        lo = min(ti.min(), tj.min())
        bi = np.floor((ti - lo) / self.bin_width).astype(np.int64)
        bj = np.floor((tj - lo) / self.bin_width).astype(np.int64)
        size = int(max(bi.max(), bj.max())) + 1
        oi = np.bincount(bi, minlength=size) > 0
        oj = np.bincount(bj, minlength=size) > 0
        return np.count_nonzero(oi & oj) / np.count_nonzero(oi | oj), n

    def view_consistency(self, view: View) -> float:
        """Weighted mean epipolar IoU of a view against every other view."""
        ci = self.plane_coords(view)
        total = weight = 0.0
        for other in self.views:
            if other is view:
                continue
            sc, w = self.pair_score(view, other, ci=ci)
            if other.fixed or view.fixed:
                w *= self.ref_weight
            total += w * sc
            weight += w
        return total / weight if weight else 0.0

    def objective(self, view: View) -> float:
        return self.view_consistency(view) - self.prior_weight * prior_penalty(view)

    def consistency_table(self) -> dict[str, float]:
        return {v.name: round(self.view_consistency(v), 4) for v in self.views}

    # ------------------------------------------------------------------ hull diagnostics
    def hull_scores(self, level: Level, k: int = 1, leave_one_out: bool = False) -> dict[str, dict]:
        """IoU and recall of every silhouette against the outline of the (robust) hull."""
        sils = level.silhouettes(self.views)
        grid = level.grid(self.lo, self.hi)
        out = {}
        shared = None if leave_one_out else surface_points(occupancy(self.views, sils, grid, k=k), grid)
        for v, s in zip(self.views, sils):
            pts = shared if shared is not None else surface_points(
                occupancy(self.views, sils, grid, k=k, exclude=v), grid)
            r = s.render(v, pts)
            out[v.name] = {"iou": round(iou(s.mask, r), 4),
                           "recall": round(np.count_nonzero(s.mask & r) / np.count_nonzero(s.mask), 4)}
        return out

    # ------------------------------------------------------------------ initialisation
    def initialise(self, level: Level, order: list[str]) -> None:
        """Frame each view against the hull of the views placed before it, in the given order."""
        placed = [self.ref]
        by_name = {v.name: v for v in self.views}
        for name in order:
            view = by_name[name]
            view.az, view.el = view.nominal
            view.roll = view.aspect = 0.0
            sils = level.silhouettes(placed)
            grid = level.grid(self.lo, self.hi)
            pts = surface_points(occupancy(placed, sils, grid), grid)
            mode = "height" if abs(view.el) < 10 else "width" if abs(abs(view.el) - 90) < 10 else "both"
            fit_framing(view, pts, mode)
            placed.append(view)
            self.log(f"  init {name:7s} mode={mode:6s} s={view.s:7.1f}")

    # ------------------------------------------------------------------ refinement
    def pattern_search(self, view: View, steps: np.ndarray, min_steps: np.ndarray,
                       max_evals: int = 1500) -> float:
        """Compass search on all camera parameters (the score is piecewise constant, so no gradients)."""
        p = view.params()
        best = self.objective(view)
        steps = steps.copy()
        evals = 0
        while np.any(steps > min_steps) and evals < max_evals:
            improved = False
            for i in range(len(p)):
                if steps[i] <= min_steps[i]:
                    continue
                for sign in (1, -1):
                    q = p.copy()
                    q[i] += sign * steps[i]
                    view.set_params(q)
                    sc = self.objective(view)
                    evals += 1
                    if sc > best:
                        best, p, improved = sc, q, True
                        break
            if not improved:
                steps /= 2
        view.set_params(p)
        return best

    def refine(self, rounds: int = 4, angle_limit: float = 30.0, tol: float = 1e-4) -> dict[str, float]:
        """Coordinate descent over all movable views; returns the final per-view consistency."""
        for r in range(rounds):
            t0 = time.time()
            change = 0.0
            for view in self.views:
                if view.fixed:
                    continue
                before = self.view_consistency(view)
                px = 0.01 * view.s  # pixels per 0.01 world units (1% of the reference half length)
                self.pattern_search(
                    view,
                    steps=np.array([4.0, 4.0, 4.0, 0.04, 4 * px, 4 * px, 0.04]) * (0.5 ** min(r, 2)),
                    min_steps=np.array([0.05, 0.05, 0.05, 5e-4, 0.05 * px, 0.05 * px, 5e-4]))
                self.clamp(view, angle_limit)
                after = self.view_consistency(view)
                change = max(change, abs(after - before))
                self.log(f"  [{r}] {view.name:7s} {before:.4f} -> {after:.4f}  az={view.az:7.2f} "
                         f"el={view.el:6.2f} roll={view.roll:6.2f} aspect={view.aspect:+.3f}")
            table = self.consistency_table()
            self.log(f"  round {r}: mean consistency {np.mean(list(table.values())):.4f} "
                     f"({time.time() - t0:.1f} s)")
            if change < tol:
                break
        return self.consistency_table()

    @staticmethod
    def clamp(view: View, limit: float) -> None:
        """Keep the angles within `limit` degrees of the requested camera (avoids mirror solutions)."""
        az0, el0 = view.nominal
        d_az = (view.az - az0 + 180) % 360 - 180
        view.az = az0 + float(np.clip(d_az, -limit, limit))
        view.el = float(np.clip(view.el, el0 - limit, el0 + limit))
        view.roll = float(np.clip(view.roll, -limit, limit))
