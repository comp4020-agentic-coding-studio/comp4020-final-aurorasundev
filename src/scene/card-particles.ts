import * as THREE from "three";
import { ART_INSET } from "./sleeve-kit.ts";
import { GRID_DESKTOP, GRID_PHONE, POOL, RELEASE_FROM, type Mode } from "./particles-plan.ts";

// Cards breaking into grain and gathering back (design 2026-10-19 §4): one
// shared particle system for every card in particle form. The geometry (a
// GRID² grid of points with per-point seeds) and the shader program are made
// once; a fixed pool of POOL entries, each one draw of those points with its
// own uniforms, is reused from frame to frame. Nothing is allocated per frame.
//
// A caller hands each entry a card's world pose and one value, `dissolve`
// (0 solid .. 1 fully dispersed), with a mode and the band's tangent toward
// the back. Everything else happens in the vertex shader: each point keeps
// its place on the card until its own release, staggered across the card
// (from the edge nearest the back for the band, by noise in place), then
// drifts, lifts a little and fades. Points are soft round sprites, sized in
// screen pixels and DPR-aware; their colour is the card's image (or the
// blank stock until it decodes), the margin outside the art the sleeve's
// paper. The card's image is the only texture read: no text ever is.

export type ParticleDraw = {
  // the card's group transform, as the mesh uses it (unit card scaled by size)
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  size: number;
  dissolve: number;
  mode: Mode;
  // world direction along the band toward the back (unit), for band modes
  tangent: THREE.Vector3;
  // overall opacity (the card's fade, the crossfade, an exit)
  alpha: number;
  // the depth dim, as the mesh's tint
  tone: number;
  image: THREE.Texture | null;
  // 0 the blank stock .. 1 the image (a late image fades in)
  imageMix: number;
  renderOrder: number;
  // stable per card, so its grain does not reshuffle between frames
  seed: number;
};

export type CardParticles = {
  // call at most POOL times between begin() and end()
  begin: () => void;
  draw: (d: ParticleDraw) => void;
  end: () => void;
  // world units per CSS pixel, and the device pixel ratio in use
  setScreen: (worldPerPx: number, dpr: number, phone: boolean) => void;
  // advance the grain's slow shimmer (seconds)
  setTime: (t: number) => void;
  // compile once with the rest of the scene
  warm: () => void;
  dispose: () => void;
};

// tuned on SwiftShader screenshots: fine grain, not confetti
// the coarser phone grid overlaps more, so its lattice never shows
const POINT_OVERLAP = 1.6;
const POINT_OVERLAP_PHONE = 1.9;
const DRIFT_WORLD = 0.95; // drift along the band, in card widths at full travel
const LIFT = 0.16; // card widths
const SCATTER = 0.2; // card widths
const OUT_FLARE = 0.18; // card widths, away from the globe

function grid(n: number): THREE.BufferGeometry {
  const count = n * n;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const seed = new Float32Array(count * 4);
  // a fixed generator, so every visit draws the same grain
  let s = 0x9e3779b9 ^ n;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      // a touch of jitter inside each cell, so the grid never reads as one
      const u = Math.min(1, Math.max(0, (i + 0.5 + (rnd() - 0.5) * 0.9) / n));
      const v = Math.min(1, Math.max(0, (j + 0.5 + (rnd() - 0.5) * 0.9) / n));
      uv[k * 2] = u;
      uv[k * 2 + 1] = v;
      pos[k * 3] = u - 0.5;
      pos[k * 3 + 1] = v - 0.5;
      pos[k * 3 + 2] = 0.024;
      seed[k * 4] = rnd();
      seed[k * 4 + 1] = rnd();
      seed[k * 4 + 2] = rnd();
      seed[k * 4 + 3] = rnd();
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aUv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const vertex = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aSeed;
uniform float uDissolve;
uniform float uInPlace;
uniform vec3 uTangent;
uniform vec3 uOut;
uniform vec3 uUp;
uniform float uSize;
uniform float uPointPx;
uniform float uTime;
uniform float uSeedShift;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

const float RELEASE_FROM = ${RELEASE_FROM.toFixed(4)};
const float SPAN = 0.5;

void main() {
  vUv = aUv;
  vSeed = aSeed.w;
  vec3 local = position;
  vec4 world = modelMatrix * vec4(local, 1.0);
  vec3 offset = mat3(modelMatrix) * vec3(local.xy, 0.0);

  // overall travel: nothing moves until the mesh has handed over
  float t = clamp((uDissolve - RELEASE_FROM) / (1.0 - RELEASE_FROM), 0.0, 1.0);
  // each point's release: the band crumbles from the edge nearest the back
  // (with noise, so the edge is ragged); in place it is noise alone
  float toBack = clamp(dot(offset, uTangent) / max(uSize, 1e-5) + 0.5, 0.0, 1.0);
  float r = mix(0.68 * (1.0 - toBack) + 0.32 * aSeed.x, aSeed.x, uInPlace);
  float p = clamp((t - r * (1.0 - SPAN)) / SPAN, 0.0, 1.0);
  float pe = p * p;

  // a perpendicular wobble from the seeds, slowly turning
  float a = 6.2831 * (aSeed.y + uSeedShift) + uTime * (0.35 + 0.4 * aSeed.z);
  vec3 side = normalize(cross(uTangent, uOut) + 1e-4);
  vec3 jitter = (side * cos(a) + uOut * sin(a) * 0.5) * (0.4 + 0.6 * aSeed.z);

  vec3 band = uTangent * (${DRIFT_WORLD.toFixed(3)} * (0.55 + 0.9 * aSeed.y) * pe)
    + uOut * (${OUT_FLARE.toFixed(3)} * aSeed.z * pe)
    + uUp * (${LIFT.toFixed(3)} * (0.3 + aSeed.w) * pe)
    + jitter * (${SCATTER.toFixed(3)} * p);
  vec2 dir = vec2(cos(6.2831 * aSeed.y), sin(6.2831 * aSeed.y));
  vec3 inPlace = uUp * (${(LIFT * 1.6).toFixed(3)} * (0.4 + aSeed.w) * pe)
    + (normalize(cross(uUp, uOut) + 1e-4) * dir.x + uUp * dir.y * 0.6) * (${(SCATTER * 1.3).toFixed(3)} * (0.3 + 0.7 * aSeed.z) * pe)
    + jitter * (${(SCATTER * 0.4).toFixed(3)} * p);
  world.xyz += mix(band, inPlace, uInPlace) * uSize;

  vAlpha = (1.0 - smoothstep(0.2, 0.95, p)) * (1.0 - 0.35 * p * aSeed.z);
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  // screen-space size: the card's grid pitch on screen, a little overlapped
  // while whole so the card reads solid, finer as each grain flies
  gl_PointSize = max(1.0, uPointPx * (1.0 - 0.6 * p) * (0.8 + 0.4 * aSeed.w));
}
`;

const fragment = /* glsl */ `
uniform sampler2D uImg;
uniform sampler2D uStock;
uniform float uImgMix;
uniform float uHasImg;
uniform vec3 uPaper;
uniform float uAlpha;
uniform float uTone;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

const float INSET = ${ART_INSET.toFixed(4)};

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float soft = 1.0 - smoothstep(0.45, 1.0, r);
  if (soft <= 0.0) discard;
  float m = (1.0 - INSET) * 0.5;
  vec2 art = (vUv - m) / INSET;
  bool inArt = art.x >= 0.0 && art.x <= 1.0 && art.y >= 0.0 && art.y <= 1.0;
  vec3 stock = texture2D(uStock, vUv).rgb;
  vec3 col = uPaper * (0.94 + 0.06 * stock / max(stock.g, 1e-3));
  if (inArt) {
    vec3 blank = stock;
    vec3 img = uHasImg > 0.5 ? texture2D(uImg, art).rgb : blank;
    col = mix(blank, img, uImgMix);
  }
  // paper grain: each point a hair lighter or darker
  col *= uTone * (0.94 + 0.1 * vSeed);
  gl_FragColor = vec4(col, uAlpha * vAlpha * soft);
  #include <colorspace_fragment>
}
`;

export function createCardParticles(scene: THREE.Scene, stock: THREE.Texture, paper: THREE.Color): CardParticles {
  const geo = { desktop: grid(GRID_DESKTOP), phone: grid(GRID_PHONE) };
  let phone = false;
  let worldPerPx = 0.01;
  let dpr = 1;
  let time = 0;
  const points: THREE.Points[] = [];
  const mats: THREE.ShaderMaterial[] = [];
  for (let i = 0; i < POOL; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uDissolve: { value: 0 },
        uInPlace: { value: 0 },
        uTangent: { value: new THREE.Vector3(1, 0, 0) },
        uOut: { value: new THREE.Vector3(0, 0, 1) },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uSize: { value: 1 },
        uPointPx: { value: 3 },
        uTime: { value: 0 },
        uSeedShift: { value: 0 },
        uImg: { value: stock },
        uStock: { value: stock },
        uImgMix: { value: 0 },
        uHasImg: { value: 0 },
        uPaper: { value: paper.clone() },
        uAlpha: { value: 0 },
        uTone: { value: 1 },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    const pts = new THREE.Points(geo.desktop, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    pts.matrixAutoUpdate = true;
    scene.add(pts);
    points.push(pts);
    mats.push(mat);
  }
  let used = 0;
  const q = new THREE.Quaternion();
  const out = new THREE.Vector3();
  const up = new THREE.Vector3();

  return {
    begin() {
      used = 0;
    },
    draw(d) {
      if (used >= POOL) return;
      const pts = points[used];
      const u = mats[used].uniforms;
      used++;
      pts.visible = true;
      pts.position.copy(d.position);
      pts.quaternion.copy(d.quaternion);
      pts.scale.setScalar(d.size);
      pts.renderOrder = d.renderOrder;
      q.copy(d.quaternion);
      out.set(0, 0, 1).applyQuaternion(q);
      up.set(0, 1, 0).applyQuaternion(q);
      u.uDissolve.value = d.dissolve;
      u.uInPlace.value = d.mode === "inplace" ? 1 : 0;
      (u.uTangent.value as THREE.Vector3).copy(d.tangent);
      (u.uOut.value as THREE.Vector3).copy(out);
      (u.uUp.value as THREE.Vector3).copy(up);
      u.uSize.value = d.size;
      const grid = phone ? GRID_PHONE : GRID_DESKTOP;
      u.uPointPx.value = (d.size / worldPerPx / grid) * (phone ? POINT_OVERLAP_PHONE : POINT_OVERLAP) * dpr;
      u.uTime.value = time;
      u.uSeedShift.value = d.seed;
      u.uImg.value = d.image ?? stock;
      u.uHasImg.value = d.image ? 1 : 0;
      u.uImgMix.value = d.image ? d.imageMix : 0;
      u.uAlpha.value = d.alpha;
      u.uTone.value = d.tone;
    },
    end() {
      for (let i = used; i < POOL; i++) points[i].visible = false;
    },
    setScreen(k, ratio, isPhone) {
      worldPerPx = k;
      dpr = ratio;
      if (isPhone !== phone) {
        phone = isPhone;
        for (const p of points) p.geometry = phone ? geo.phone : geo.desktop;
      }
    },
    setTime(t) {
      time = t;
    },
    warm() {
      for (const p of points) p.visible = true;
    },
    dispose() {
      for (const p of points) scene.remove(p);
      for (const m of mats) m.dispose();
      geo.desktop.dispose();
      geo.phone.dispose();
    },
  };
}
