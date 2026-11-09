// Unstructured-lumigraph blending weights (Buehler et al. 2001), shared by the UI and the tests.
// angles[i] is the angle between the current viewing direction and photo i (Infinity = unusable).
// With t the k-th smallest angle, w_i = (1 - a_i / t) / a_i for a_i < t and 0 otherwise, normalised;
// so at most k-1 photos mix, and a photo seen exactly from its own direction gets all the weight.
// `sharp` raises the weights to a power, shortening the cross-fade between neighbouring photos.
export function ulrWeights(angles, k, sharp = 1) {
  const sorted = angles.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return angles.map(() => 0);
  const t = sorted.length >= k ? sorted[k - 1] : sorted[sorted.length - 1] * 1.25 + 0.05;
  const w = angles.map((a) => (a < t ? ((1 - a / t) / Math.max(a, 1e-3)) ** sharp : 0));
  const sum = w.reduce((x, y) => x + y, 0);
  return sum > 0 ? w.map((x) => x / sum) : w;
}
