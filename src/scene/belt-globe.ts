import * as THREE from "three";
import { GLOBE_R, GLOBE_SX, GLOBE_SY, MERIDIANS, meridianAngle } from "./belt-layout.ts";

// The belt's globe (design 2026-10-19 §4, option A): seven meridian rings and
// the silhouette ellipse of a flattened sphere, drawn as fine graphite thread.
// Each line is a thin ribbon extruded in screen space, so its width is set in
// CSS pixels whatever the scale, and varies a little along its length (slow
// noise per ring), the way a hand-wound thread or a lantern rib thickens and
// thins. No fill, no texture, no dither. The far half of each ring is a faint
// trace, so the globe reads as a paper lantern rather than a wire cage.
//
// The rings turn inside `spin` (the counter-rotation), which sits inside the
// flattened `globe`; the silhouette never turns. `draw` (0..1) draws the
// lines in from the poles for the page's entrance.

export type BeltGlobe = {
  group: THREE.Group;
  spin: THREE.Group;
  // 0..1: the lines drawn in from the poles
  setDraw: (v: number) => void;
  setOpacity: (v: number) => void;
  setResolution: (w: number, h: number, dpr: number) => void;
  // the globe's radius in world units, for the near/far shading
  setScale: (worldPerUnit: number) => void;
  dispose: () => void;
};

const SEGMENTS = 192;
// CSS pixels
const WIDTH = 1.15;
const INK = new THREE.Color(0x2c2d2b);

// smooth 1D value noise for the thread's weight
function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x: number, seed: number) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + seed * 17.3) * (1 - u) + hash(i + 1 + seed * 17.3) * u;
}

// one closed loop as a ribbon: two vertices per point, with the previous and
// next points so the vertex shader can find the screen-space normal
function ribbon(points: THREE.Vector3[], seed: number, poleOf: (p: THREE.Vector3) => number): THREE.BufferGeometry {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const prev = new Float32Array(n * 2 * 3);
  const next = new Float32Array(n * 2 * 3);
  const side = new Float32Array(n * 2);
  const weight = new Float32Array(n * 2);
  const pole = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    // weight: 0.65..1.4, slow along the loop, a different rhythm per ring
    const t = (i / n) * 9;
    const w = 0.65 + 0.75 * (0.65 * noise1(t, seed) + 0.35 * noise1(t * 2.7, seed + 5));
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s;
      pos.set([p.x, p.y, p.z], k * 3);
      prev.set([a.x, a.y, a.z], k * 3);
      next.set([b.x, b.y, b.z], k * 3);
      side[k] = s ? 1 : -1;
      weight[k] = w;
      pole[k] = poleOf(p);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = i * 2;
    const b = j * 2;
    index.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("prev", new THREE.BufferAttribute(prev, 3));
  g.setAttribute("next", new THREE.BufferAttribute(next, 3));
  g.setAttribute("side", new THREE.BufferAttribute(side, 1));
  g.setAttribute("weight", new THREE.BufferAttribute(weight, 1));
  g.setAttribute("pole", new THREE.BufferAttribute(pole, 1));
  g.setIndex(index);
  return g;
}

function threadMaterial(uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 prev;
      attribute vec3 next;
      attribute float side;
      attribute float weight;
      attribute float pole;
      uniform vec2 uResolution;
      uniform float uWidth;
      uniform float uRadius;
      varying float vSide;
      varying float vFront;
      varying float vPole;
      varying float vWeight;
      vec2 screen(vec4 c) { return c.xy / c.w * uResolution * 0.5; }
      void main() {
        mat4 mvp = projectionMatrix * modelViewMatrix;
        vec4 c = mvp * vec4(position, 1.0);
        vec2 a = screen(mvp * vec4(prev, 1.0));
        vec2 b = screen(mvp * vec4(next, 1.0));
        vec2 dir = normalize(b - a + vec2(1e-6, 0.0));
        vec2 nrm = vec2(-dir.y, dir.x);
        float w = uWidth * weight * 0.5 + 0.6;
        c.xy += nrm * side * w / (uResolution * 0.5) * c.w;
        gl_Position = c;
        // which side of the sphere the point is on (world z faces the camera)
        float z = (modelMatrix * vec4(position, 1.0)).z - (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
        vFront = smoothstep(-0.06, 0.06, z / uRadius);
        vSide = side * w;
        vPole = pole;
        vWeight = weight;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      uniform float uOpacity;
      uniform float uBack;
      uniform float uDraw;
      uniform float uWidth;
      varying float vSide;
      varying float vFront;
      varying float vPole;
      varying float vWeight;
      void main() {
        // drawn in from the poles: pole is 0 at a pole, 1 at the equator
        if (vPole > uDraw * 1.02) discard;
        float hw = uWidth * vWeight * 0.5;
        // a soft pixel edge on each side of the thread
        float edge = 1.0 - smoothstep(hw - 0.35, hw + 0.6, abs(vSide));
        float tone = 0.72 + 0.28 * clamp(vWeight, 0.0, 1.0);
        float a = uOpacity * edge * tone * mix(uBack, 1.0, vFront);
        if (a < 0.003) discard;
        gl_FragColor = vec4(uInk, a);
        #include <colorspace_fragment>
      }
    `,
  });
}

export function createBeltGlobe(): BeltGlobe {
  const group = new THREE.Group();
  group.scale.set(GLOBE_SX, GLOBE_SY, 1);
  const spin = new THREE.Group();
  group.add(spin);
  const uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uWidth: { value: WIDTH },
    uRadius: { value: GLOBE_R },
    uInk: { value: INK },
    uOpacity: { value: 0.62 },
    uBack: { value: 0.16 },
    uDraw: { value: 1 },
  };
  const material = threadMaterial(uniforms);
  // the silhouette lies on z = 0: it is never "behind", so it keeps full tone
  const outline = threadMaterial({ ...uniforms, uBack: { value: 1 } });
  const geometries: THREE.BufferGeometry[] = [];

  // a meridian ring in the y–z plane, turned about y by its own angle
  for (let i = 0; i < MERIDIANS; i++) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < SEGMENTS; k++) {
      const a = (k / SEGMENTS) * Math.PI * 2;
      pts.push(new THREE.Vector3(0, Math.sin(a) * GLOBE_R, Math.cos(a) * GLOBE_R));
    }
    const g = ribbon(pts, i + 1, (p) => 1 - Math.abs(p.y) / GLOBE_R);
    geometries.push(g);
    const line = new THREE.Mesh(g, material);
    line.rotation.y = meridianAngle(i);
    line.frustumCulled = false;
    spin.add(line);
  }
  // the silhouette: never turns, drawn in from the top and bottom too
  {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < SEGMENTS * 1.5; k++) {
      const a = (k / (SEGMENTS * 1.5)) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * GLOBE_R, Math.sin(a) * GLOBE_R, 0));
    }
    const g = ribbon(pts, 11, (p) => 1 - Math.abs(p.y) / GLOBE_R);
    geometries.push(g);
    const line = new THREE.Mesh(g, outline);
    line.frustumCulled = false;
    group.add(line);
  }

  return {
    group,
    spin,
    setDraw(v) {
      uniforms.uDraw.value = v;
    },
    setOpacity(v) {
      uniforms.uOpacity.value = 0.62 * v;
    },
    setResolution(w, h, dpr) {
      uniforms.uResolution.value.set(w * dpr, h * dpr);
      uniforms.uWidth.value = WIDTH * dpr;
    },
    setScale(k) {
      uniforms.uRadius.value = GLOBE_R * k;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      material.dispose();
      outline.dispose();
    },
  };
}
