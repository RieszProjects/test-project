// GLSL sources. All programs bind aPosition to location 0 and aNormal to location 1.

export const MAX_VIEWS = 24;

// Depth pass: render the mesh as seen by one source camera into a layer of a depth texture array.
export const depthVS = `#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 uTexToClip;
uniform mat4 uViewTex;
void main() {
  gl_Position = uTexToClip * uViewTex * vec4(aPosition, 1.0);
}`;

export const depthFS = `#version 300 es
precision highp float;
void main() {}`;

export const meshVS = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProj;
out vec3 vPos;
out vec3 vNormal;
void main() {
  vPos = aPosition;
  vNormal = aNormal;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

// View-dependent projective texturing. Every source photo is projected onto the surface; a photo
// is a candidate where its camera sees the point (depth test), where it is not transparent, and where
// the surface faces it. Candidates are blended with unstructured-lumigraph weights (Buehler et al. 2001):
// with p_i the angle between the current and the i-th camera direction and t the k-th smallest angle,
// w_i = (1 - p_i / t) / p_i, so at most k-1 photos mix and each photo is reproduced exactly from its
// own viewpoint. The weights are computed once per frame from the camera direction (uGlobalW), so the
// whole object cross-fades coherently instead of breaking into per-pixel patches; per-pixel ULR weights
// are only a fallback where none of the globally weighted photos sees the surface. Weights also fade
// near silhouette edges, where generated views disagree the most.
export const meshFS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
#define MAX_VIEWS ${MAX_VIEWS}

uniform sampler2DArray uImages;
uniform sampler2DArray uDepths;
uniform mat4 uViewTex[MAX_VIEWS];
uniform vec3 uViewDir[MAX_VIEWS];
uniform vec3 uViewColor[MAX_VIEWS];
uniform float uViewOn[MAX_VIEWS];
uniform float uGlobalW[MAX_VIEWS];
uniform int uViewCount;
uniform vec3 uEye;
uniform vec3 uCamBack;
uniform int uOrtho;
uniform int uMode;          // 0 blend, 1 nearest photo, 2 geometry, 3 photo weights
uniform int uK;             // blend the k-1 closest photos
uniform float uSharp;       // exponent on the angular weights: higher = shorter cross-fades
uniform float uBias;
uniform float uDepthTexel;

in vec3 vPos;
in vec3 vNormal;
out vec4 outColor;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSRGB(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

float visibility(int i, vec3 p, float facing) {
  float bias = uBias * (1.0 + 4.0 * (1.0 - clamp(facing, 0.0, 1.0)));
  float vis = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 o = (vec2(float(k & 1), float(k >> 1)) - 0.5) * uDepthTexel;
    float d = texture(uDepths, vec3(p.xy + o, float(i))).r;
    vis += step(p.z - bias, d);
  }
  return vis * 0.25;
}

vec3 clay(vec3 n, vec3 toEye) {
  vec3 key = normalize(vec3(0.45, 0.8, 0.55));
  vec3 fill = normalize(vec3(-0.6, 0.2, -0.4));
  float diff = max(dot(n, key), 0.0) * 0.75 + max(dot(n, fill), 0.0) * 0.25;
  float hemi = 0.5 + 0.5 * n.y;
  float rim = pow(1.0 - max(dot(n, toEye), 0.0), 3.0);
  vec3 base = vec3(0.70, 0.66, 0.60);
  return base * (0.22 + 0.62 * diff + 0.16 * hemi) + vec3(0.85, 0.72, 0.48) * rim * 0.35;
}

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 toEye = uOrtho == 1 ? uCamBack : normalize(uEye - vPos);

  if (uMode == 2) {
    outColor = vec4(clay(n, toEye), 1.0);
    return;
  }

  float ang[MAX_VIEWS];
  float base[MAX_VIEWS];
  vec3 col[MAX_VIEWS];
  int valid = 0;
  vec4 accAny = vec4(0.0);
  for (int i = 0; i < MAX_VIEWS; i++) {
    ang[i] = 1e3;
    base[i] = 0.0;
    col[i] = vec3(0.0);
    if (i >= uViewCount || uViewOn[i] < 0.5) continue;
    float facing = dot(n, uViewDir[i]);
    if (facing <= 0.02) continue;
    vec4 p = uViewTex[i] * vec4(vPos, 1.0);
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) continue;
    float vis = visibility(i, p.xyz, facing);
    if (vis <= 0.0) continue;
    vec4 c = texture(uImages, vec3(p.xy, float(i)));
    float soft = textureLod(uImages, vec3(p.xy, float(i)), 3.0).a;  // ~8 px blurred alpha
    float b = vis * c.a * (0.05 + 0.95 * smoothstep(0.5, 0.95, soft)) * smoothstep(0.02, 0.4, facing);
    if (b <= 1e-4) continue;
    ang[i] = acos(clamp(dot(toEye, uViewDir[i]), -1.0, 1.0));
    base[i] = b;
    col[i] = toLinear(c.rgb);
    accAny += vec4(col[i] * b, b);
    valid++;
  }

  vec3 color;
  if (valid == 0) {
    // no photo sees this point: neutral clay so the gap is visible but not distracting
    color = toLinear(clay(n, toEye)) * 0.35;
  } else {
    // threshold t = k-th smallest angle among candidates (or a bit beyond the largest one)
    float t = 0.0;
    float prev = -1.0;
    int k = min(uK, valid);
    for (int r = 0; r < MAX_VIEWS; r++) {
      if (r >= k) break;
      float m = 1e3;
      for (int i = 0; i < MAX_VIEWS; i++) {
        if (ang[i] > prev && ang[i] < m) m = ang[i];
      }
      prev = m;
      t = m;
    }
    if (valid < uK) t = t * 1.25 + 0.05;
    // coherent weights first; per-pixel ULR only where no globally weighted photo sees the point
    vec4 acc = vec4(0.0);
    vec3 tint = vec3(0.0);
    float bestW = -1.0;
    vec3 bestC = vec3(0.0);
    for (int i = 0; i < MAX_VIEWS; i++) {
      float w = base[i] * uGlobalW[i];
      if (w <= 0.0) continue;
      acc += vec4(col[i] * w, w);
      tint += uViewColor[i] * w;
      if (w > bestW) { bestW = w; bestC = col[i]; }
    }
    if (acc.a <= 1e-6) {
      for (int i = 0; i < MAX_VIEWS; i++) {
        if (ang[i] >= t) continue;
        float w = base[i] * pow((1.0 - ang[i] / t) / max(ang[i], 1e-3), uSharp);
        acc += vec4(col[i] * w, w);
        tint += uViewColor[i] * w;
        if (w > bestW) { bestW = w; bestC = col[i]; }
      }
    }
    if (acc.a <= 0.0) {
      color = accAny.rgb / accAny.a;
    } else if (uMode == 1) {
      color = bestC;
    } else if (uMode == 3) {
      color = toLinear(tint / acc.a) * (0.35 + 0.65 * max(dot(n, toEye), 0.0));
    } else {
      color = acc.rgb / acc.a;
    }
  }
  outColor = vec4(toSRGB(color), 1.0);
}`;

// Source camera cards: each photo drawn on a small plane placed in the direction it was taken from.
export const cardVS = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;   // (u, v, layer)
uniform mat4 uViewProj;
out vec3 vUVL;
void main() {
  vUVL = aNormal;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

export const cardFS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
#define MAX_VIEWS ${MAX_VIEWS}
uniform sampler2DArray uImages;
uniform float uHighlight[MAX_VIEWS];
uniform float uFade[MAX_VIEWS];
uniform float uViewOn[MAX_VIEWS];
in vec3 vUVL;
out vec4 outColor;
void main() {
  int layer = int(vUVL.z + 0.5);
  vec2 uv = vUVL.xy;
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float hl = uHighlight[layer];
  float on = uViewOn[layer];
  vec4 photo = texture(uImages, vec3(uv, float(layer)));
  vec3 frame = mix(vec3(0.42, 0.40, 0.36), vec3(0.93, 0.76, 0.45), hl);
  vec4 back = vec4(0.06, 0.065, 0.08, 0.55 + 0.2 * hl);
  vec4 c = vec4(mix(back.rgb, photo.rgb, photo.a), max(back.a, photo.a));
  if (edge < 0.012) c = vec4(frame, 0.95);
  if (!gl_FrontFacing) c.rgb *= 0.45;  // seen from behind: dimmed (and mirrored)
  c.a *= mix(0.35, 1.0, on) * (0.55 + 0.45 * hl) * uFade[layer];
  outColor = vec4(c.rgb * c.a, c.a);
}`;

// Soft contact shadow under the object.
export const shadowVS = `#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform vec2 uHalf;
out vec2 vQ;
void main() {
  vQ = aPosition.xz;
  gl_Position = uViewProj * vec4(uCenter + vec3(aPosition.x * uHalf.x, 0.0, aPosition.z * uHalf.y), 1.0);
}`;

export const shadowFS = `#version 300 es
precision highp float;
in vec2 vQ;
uniform float uStrength;
out vec4 outColor;
void main() {
  float r = length(vQ);
  float a = uStrength * smoothstep(1.0, 0.0, r) * smoothstep(1.0, 0.25, r);
  outColor = vec4(0.0, 0.0, 0.0, a);
}`;
