"""Green-screen keying: RGB photo on a chroma-key green background -> straight-alpha RGBA cut-out."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage


@dataclass
class KeyResult:
    rgba: np.ndarray        # float32 HxWx4 in [0, 1], straight (non-premultiplied) alpha, cropped
    offset: tuple[int, int]  # (x, y) of the crop's top-left corner in the original image
    full_size: tuple[int, int]  # (width, height) of the original image
    background: np.ndarray  # estimated key colour (RGB)


def _border_pixels(img: np.ndarray, width: int = 6) -> np.ndarray:
    return np.concatenate([img[:width].reshape(-1, 3), img[-width:].reshape(-1, 3),
                           img[:, :width].reshape(-1, 3), img[:, -width:].reshape(-1, 3)])


def green_key(img: np.ndarray) -> np.ndarray:
    """How much greener than the other two channels a pixel is (0 for neutral colours)."""
    return img[..., 1] - np.maximum(img[..., 0], img[..., 2])


def matte(img: np.ndarray, lo: float = 0.3, hi: float = 0.7) -> tuple[np.ndarray, np.ndarray]:
    """Soft alpha from the green key.

    Thresholds are fractions of the background's own key value, so the same settings work for
    saturated (#00FF00) and slightly washed-out greens. Returns (alpha, background_rgb).
    """
    border = _border_pixels(img)
    bg_key = float(np.median(green_key(border)))
    if bg_key < 0.2:
        raise ValueError(f"background does not look like a green screen (key={bg_key:.2f})")
    background = np.median(border[green_key(border) > 0.5 * bg_key], axis=0)
    key = green_key(img)
    alpha = np.clip((hi * bg_key - key) / ((hi - lo) * bg_key), 0.0, 1.0)
    return alpha.astype(np.float32), background.astype(np.float32)


def clean_alpha(alpha: np.ndarray, min_part: float = 0.004, max_hole: float = 0.0015) -> np.ndarray:
    """Drop specks outside the object and fill pin-holes inside it.

    min_part / max_hole are areas relative to the largest connected component. Larger holes (for
    example the opening of a trigger guard or a handle) are real geometry and are kept.
    """
    solid = alpha > 0.5
    labels, n = ndimage.label(solid)
    if n == 0:
        raise ValueError("no foreground found")
    sizes = ndimage.sum_labels(solid, labels, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= min_part * sizes.max()
    fg = keep[labels]

    holes, m = ndimage.label(~fg)
    if m:
        hole_sizes = ndimage.sum_labels(~fg, holes, index=np.arange(1, m + 1))
        border_ids = np.unique(np.concatenate([holes[0], holes[-1], holes[:, 0], holes[:, -1]]))
        small = np.zeros(m + 1, bool)
        small[1:] = hole_sizes < max_hole * sizes.max()
        small[border_ids] = False
        fg |= small[holes]

    # keep the soft edge only next to accepted foreground
    near = ndimage.binary_dilation(fg, iterations=2)
    out = np.where(near, alpha, 0.0)
    out[fg & (alpha < 0.5)] = np.maximum(out[fg & (alpha < 0.5)], 0.5)  # filled pin-holes
    return out.astype(np.float32)


def unmix(img: np.ndarray, alpha: np.ndarray, background: np.ndarray) -> np.ndarray:
    """Remove the green background from semi-transparent edge pixels and suppress green spill."""
    a = np.maximum(alpha, 1e-3)[..., None]
    fg = (img - (1.0 - a) * background) / a
    fg = np.where(alpha[..., None] > 0.02, fg, img)
    fg = np.clip(fg, 0.0, 1.0)
    # spill suppression: green may not exceed the brighter of red and blue
    fg[..., 1] = np.minimum(fg[..., 1], np.maximum(fg[..., 0], fg[..., 2]))
    return fg


def key_image(img: np.ndarray, margin: int = 16) -> KeyResult:
    """Key an RGB float image in [0, 1]; the result is cropped to the object plus a margin."""
    alpha, background = matte(img)
    alpha = clean_alpha(alpha)
    rgb = unmix(img, alpha, background)
    ys, xs = np.nonzero(alpha > 0.01)
    h, w = alpha.shape
    x0, x1 = max(xs.min() - margin, 0), min(xs.max() + margin + 1, w)
    y0, y1 = max(ys.min() - margin, 0), min(ys.max() + margin + 1, h)
    rgba = np.concatenate([rgb, alpha[..., None]], axis=-1)[y0:y1, x0:x1]
    return KeyResult(rgba=rgba.astype(np.float32), offset=(int(x0), int(y0)), full_size=(w, h),
                     background=background)
