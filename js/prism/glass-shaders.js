/**
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.), apps/docs/app/[lang]/(home)/components/prism-background. See LICENSE-vgpu.
 *
 * GLSL ES 3.00 sources for the glass pipeline (WGSL ports of environment.wgsl,
 * glass-common.wgsl, glass-back.wgsl, glass.wgsl). Halo spec 5d numbers win.
 */

const HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

/** Hub background (#121214) sRGB, linearized in-shader. */
const BG_SRGB = 'vec3(18.0, 18.0, 20.0) / 255.0';
/** Light intensity on the hub (skomina spec .ambient-stage opacity 0.6); keep in sync with #fx CSS. */
const LIGHT_GAIN = '0.6';

const COLOR = `
vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.04045))));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));
}
// +-1 LSB triangular dither: breaks up 8-bit banding in the soft bloom.
vec3 dither8(vec3 c) {
  vec2 p = gl_FragCoord.xy;
  float a = fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  float b = fract(sin(dot(p, vec2(39.3468, 11.1357))) * 24634.6345);
  return c + vec3((a + b - 1.0) / 255.0);
}
`;

/** Analytic studio environment (halo 5d). */
const ENVIRONMENT = `
const float ENV_EXPOSURE = 2.3;

float panelMask(vec3 dir, vec3 fwd, vec2 size, float feather) {
  fwd = normalize(fwd);
  vec3 helper = abs(fwd.y) > 0.92 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(helper, fwd));
  vec3 up = cross(fwd, right);
  float facing = dot(dir, fwd);
  if (facing <= 0.01) return 0.0;
  float lx = abs(dot(dir, right) / facing);
  float ly = abs(dot(dir, up) / facing);
  float ex = 1.0 - smoothstep(size.x, size.x + feather, lx);
  float ey = 1.0 - smoothstep(size.y, size.y + feather, ly);
  return ex * ey;
}

vec3 sampleEnv(vec3 d) {
  vec3 dir = normalize(d);
  float floorBlend = 1.0 - smoothstep(-0.22, -0.02, dir.y);
  vec3 room = mix(vec3(0.00025, 0.0003, 0.0004), vec3(0.006, 0.007, 0.009), floorBlend);
  float negZ = 1.0 - smoothstep(-0.08, 0.08, dir.z);
  float aboveFloor = smoothstep(-0.28, -0.08, dir.y);
  room = mix(room, vec3(0.00002), negZ * aboveFloor);
  float horizon = exp(-abs(dir.y + 0.1) * 22.0) * 0.0012;
  vec3 color = room + vec3(horizon, horizon * 0.96, horizon * 0.9);
  color += vec3(0.82, 0.84, 0.88) * (panelMask(dir, vec3(-0.82, 0.08, 0.57), vec2(1.35, 1.1), 0.22) * 0.011);
  color += vec3(1.0, 0.97, 0.91) * (panelMask(dir, vec3(0.0, -0.707, 0.707), vec2(0.38, 0.62), 0.18) * 0.22);
  color += vec3(0.76, 0.88, 1.0) * (panelMask(dir, vec3(0.612, 0.354, 0.707), vec2(0.5, 0.16), 0.035) * 20.0);
  vec3 mapped = color / (vec3(1.0) + color);
  return srgbToLinear(pow(max(mapped, vec3(0.0)), vec3(1.0 / 2.2))) * ENV_EXPOSURE;
}
`;

const GLASS_UNIFORMS = `
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec4 uPlanes[5]; // xyz outward normal, w offset: dot(n,p)=w. 0..2 sides, 3 front, 4 back
uniform float uIor;
uniform float uF0;
uniform float uRefl;
uniform vec3 uAbsorb;    // per world unit (px), linear RGB
`;

const GLASS_VERT = `${HEADER}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
${GLASS_UNIFORMS}
out vec3 vPos;
out vec3 vNormal;
void main() {
  vPos = aPos;
  vNormal = aNormal;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

const FRESNEL = `
float fresnelSchlick(float f0, float facing) {
  float m = 1.0 - clamp(facing, 0.0, 1.0);
  float m2 = m * m;
  return f0 + (1.0 - f0) * m2 * m2 * m;
}
`;

/** Back face pass: glass -> air with TIR bounces over ideal planes. */
const GLASS_BACK_FRAG = `${HEADER}
in vec3 vPos;
in vec3 vNormal;
${GLASS_UNIFORMS}
out vec4 outColor;
${COLOR}${ENVIRONMENT}${FRESNEL}
const float NO_HIT = 100000.0;
const int NO_PLANE = 5;
const int MAX_BOUNCES = 3;

// x: distance, y: plane index
vec2 nextSurface(vec3 origin, vec3 dir, int departed) {
  float nearest = NO_HIT;
  float idx = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i == departed) continue;
    vec4 pl = uPlanes[i];
    float den = dot(pl.xyz, dir);
    if (den <= 0.00001) continue;
    float d = (pl.w - dot(pl.xyz, origin)) / den;
    if (d >= 0.0 && d < nearest) { nearest = d; idx = float(i); }
  }
  return vec2(nearest, idx);
}

struct ExitPath {
  vec3 position;
  vec3 dir;
  vec3 incident;
  vec3 inward;
  bool escaped;
  int plane;
};

ExitPath traceExit(vec3 pos, vec3 dir, vec3 inward, int plane) {
  for (int b = 0; b <= MAX_BOUNCES; b++) {
    vec3 t = refract(dir, inward, uIor);
    if (length(t) > 0.00001) return ExitPath(pos, normalize(t), dir, inward, true, plane);
    dir = reflect(dir, inward);
    vec2 hit = nextSurface(pos, dir, plane);
    if (hit.x >= 10000.0) break;
    pos += dir * hit.x;
    plane = int(hit.y + 0.5);
    inward = -uPlanes[plane].xyz;
  }
  return ExitPath(pos, dir, dir, inward, false, plane);
}

ExitPath traceReflectedExit(ExitPath e) {
  vec3 dir = reflect(e.incident, e.inward);
  vec2 hit = nextSurface(e.position, dir, e.plane);
  if (hit.x >= 10000.0) return ExitPath(e.position, dir, dir, e.inward, false, e.plane);
  int plane = int(hit.y + 0.5);
  return traceExit(e.position + dir * hit.x, dir, -uPlanes[plane].xyz, plane);
}

void main() {
  vec3 incident = -normalize(uCamPos - vPos);
  vec3 inward = -normalize(vNormal);
  ExitPath ex = traceExit(vPos, incident, inward, NO_PLANE);
  ExitPath rx = traceReflectedExit(ex);
  float rFacing = clamp(-dot(rx.incident, rx.inward), 0.0, 1.0);
  float rTrans = rx.escaped ? 1.0 - fresnelSchlick(uF0, rFacing) : 0.0;
  vec3 env = sampleEnv(rx.dir) * uRefl * rTrans;
  float facing = clamp(-dot(ex.incident, ex.inward), 0.0, 1.0);
  float weight = ex.escaped ? fresnelSchlick(uF0, facing) : 1.0;
  outColor = vec4(env * weight, weight);
}
`;

/** Front face pass: reflect + refract into glass, sample RT at exit. */
const GLASS_FRONT_FRAG = `${HEADER}
in vec3 vPos;
in vec3 vNormal;
${GLASS_UNIFORMS}
uniform sampler2D uScene;
uniform vec2 uRes;
out vec4 outColor;
${COLOR}${ENVIRONMENT}${FRESNEL}
const float NO_EXIT = 100000.0;
const float SURFACE_EPS = 0.0002;

float planeExit(vec3 origin, vec3 dir, vec4 pl) {
  float den = dot(pl.xyz, dir);
  if (den <= 0.00001) return NO_EXIT;
  float d = (pl.w - dot(pl.xyz, origin)) / den;
  return d > 0.0001 ? d : NO_EXIT;
}

float nearestExit(vec3 origin, vec3 dir) {
  float nearest = planeExit(origin, dir, uPlanes[3]);
  nearest = min(nearest, planeExit(origin, dir, uPlanes[4]));
  for (int i = 0; i < 3; i++) nearest = min(nearest, planeExit(origin, dir, uPlanes[i]));
  return nearest;
}

vec3 shoulder(vec3 c) {
  c = max(c, vec3(0.0));
  const float k = 0.8;
  vec3 over = max(c - k, vec3(0.0));
  vec3 rolled = k + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
  return mix(c, rolled, vec3(greaterThan(c, vec3(k))));
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 view = normalize(uCamPos - vPos);
  vec3 incident = -view;
  float facing = clamp(dot(view, normal), 0.0, 1.0);
  vec3 envRefl = sampleEnv(reflect(incident, normal));
  float fresnel = fresnelSchlick(uF0, facing);
  vec3 inside = normalize(refract(incident, normal, 1.0 / uIor));
  vec3 start = vPos + inside * SURFACE_EPS;
  float dist = nearestExit(start, inside);
  bool valid = dist < 10000.0;
  vec3 exitPos = start + inside * (valid ? dist : 0.0);
  vec2 uv = gl_FragCoord.xy / uRes;
  if (valid) {
    vec4 clip = uViewProj * vec4(exitPos, 1.0);
    uv = (clip.xy / max(clip.w, 0.00001)) * 0.5 + 0.5;
  }
  vec2 halfTexel = 0.5 / uRes;
  uv = clamp(uv, halfTexel, vec2(1.0) - halfTexel);
  vec3 background = texture(uScene, uv).rgb;
  vec3 transmitted = valid ? background * exp(-uAbsorb * dist) : vec3(0.0);
  vec3 reflected = envRefl * uRefl;
  float grazing = pow(1.0 - facing, 1.5);
  float lum = dot(envRefl, vec3(0.2126, 0.7152, 0.0722));
  float panel = smoothstep(0.5, 0.82, lum) * clamp(uRefl * 0.4, 0.0, 0.7) * (0.65 + 0.35 * grazing);
  vec3 glass = max(transmitted * (1.0 - fresnel) + reflected * fresnel, vec3(0.0));
  glass += max(reflected * panel, vec3(0.0));
  outColor = vec4(dither8(linearToSrgb(shoulder(glass))), 1.0);
}
`;

const FULLSCREEN_VERT = `${HEADER}
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Pass 1: hub bg screen-blended with fx light (fx is sRGB, premultiplied, flipY uploaded). */
const BG_FRAG = `${HEADER}
uniform sampler2D uLight;
uniform vec2 uRes;
out vec4 outColor;
${COLOR}
void main() {
  vec4 l = texture(uLight, gl_FragCoord.xy / uRes);
  vec3 bg = srgbToLinear(${BG_SRGB});
  // l.rgb is premultiplied (rgb * a), matching the CSS screen-blend fallback.
  // LIGHT_GAIN mirrors the hub spec's ambient opacity (0.6) and the #fx fallback CSS.
  vec3 light = srgbToLinear(clamp(l.rgb * ${LIGHT_GAIN}, 0.0, 1.0));
  outColor = vec4(1.0 - (1.0 - bg) * (1.0 - light), 1.0);
}
`;

/** Pass 3: linear RT to sRGB screen. */
const BLIT_FRAG = `${HEADER}
uniform sampler2D uScene;
uniform vec2 uRes;
out vec4 outColor;
${COLOR}
void main() {
  outColor = vec4(dither8(linearToSrgb(texture(uScene, gl_FragCoord.xy / uRes).rgb)), 1.0);
}
`;

export const SHADERS = Object.freeze({
  glassVert: GLASS_VERT,
  glassBackFrag: GLASS_BACK_FRAG,
  glassFrontFrag: GLASS_FRONT_FRAG,
  fullscreenVert: FULLSCREEN_VERT,
  bgFrag: BG_FRAG,
  blitFrag: BLIT_FRAG,
});
