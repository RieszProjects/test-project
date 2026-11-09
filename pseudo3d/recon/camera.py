"""Orthographic camera model shared by the reconstruction and the web viewer.

Object frame: +X is the object's "forward" (e.g. a muzzle), +Y is up and +Z points toward the camera
of the reference view. A view is described by

* az, el (degrees): the camera sits in direction d = (sin az cos el, sin el, cos az cos el) from the
  origin and looks back at it;
* roll (degrees): in-image rotation, positive turns the image axes counter-clockwise;
* s, cx, cy: pixels per world unit and the pixel position of the world origin;
* aspect: log ratio between horizontal and vertical scale. A real orthographic camera has 0; generated
  images are sometimes drawn slightly stretched, which this absorbs.

A world point X lands at pixel (cx + sx * right.X, cy - sy * up.X) with sx = s * exp(aspect / 2) and
sy = s * exp(-aspect / 2); y grows downward as in the image. right0 = (cos az, 0, -sin az) and
up0 = d x right0 are the axes before roll.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


def basis(az: float, el: float, roll: float = 0.0) -> np.ndarray:
    """3x3 matrix whose rows are (right, up, toward-camera) for the given angles in degrees."""
    a, e, r = np.radians([az, el, roll])
    d = np.array([np.sin(a) * np.cos(e), np.sin(e), np.cos(a) * np.cos(e)])
    right0 = np.array([np.cos(a), 0.0, -np.sin(a)])
    up0 = np.cross(d, right0)
    right = np.cos(r) * right0 + np.sin(r) * up0
    up = -np.sin(r) * right0 + np.cos(r) * up0
    return np.stack([right, up, d])


@dataclass
class View:
    """One keyed photo of the object plus its current camera estimate (pixels refer to `rgba`)."""
    name: str
    rgba: np.ndarray                 # HxWx4 float32, straight alpha
    az: float
    el: float
    roll: float = 0.0
    s: float = 1.0
    cx: float = 0.0
    cy: float = 0.0
    aspect: float = 0.0
    nominal: tuple[float, float] = (0.0, 0.0)
    fixed: bool = False              # the reference view anchors the frame and is never moved
    meta: dict = field(default_factory=dict)

    @property
    def size(self) -> tuple[int, int]:
        return self.rgba.shape[1], self.rgba.shape[0]

    @property
    def mask(self) -> np.ndarray:
        return self.rgba[..., 3] > 0.5

    def rotation(self) -> np.ndarray:
        return basis(self.az, self.el, self.roll)

    @property
    def sx(self) -> float:
        return self.s * float(np.exp(self.aspect / 2))

    @property
    def sy(self) -> float:
        return self.s * float(np.exp(-self.aspect / 2))

    def params(self) -> np.ndarray:
        return np.array([self.az, self.el, self.roll, np.log(self.s), self.cx, self.cy, self.aspect])

    def set_params(self, p: np.ndarray) -> None:
        self.az, self.el, self.roll = float(p[0]), float(p[1]), float(p[2])
        self.s, self.cx, self.cy = float(np.exp(p[3])), float(p[4]), float(p[5])
        self.aspect = float(p[6])

    def project(self, pts: np.ndarray) -> np.ndarray:
        """World points (N,3) -> pixel coordinates (N,2) as (x, y)."""
        uv = pts @ self.rotation()[:2].T
        return np.stack([self.cx + self.sx * uv[:, 0], self.cy - self.sy * uv[:, 1]], axis=1)

    def depth(self, pts: np.ndarray) -> np.ndarray:
        """Distance toward the camera (larger = closer)."""
        return pts @ self.rotation()[2]

    def summary(self) -> dict:
        return {"name": self.name, "az": round(self.az, 2), "el": round(self.el, 2),
                "roll": round(self.roll, 2), "s": round(self.s, 3), "cx": round(self.cx, 2),
                "cy": round(self.cy, 2), "aspect": round(self.aspect, 4), "nominal": list(self.nominal)}
