// A small volumetric flame drawn as a stack of view-aligned slices.
//
// Technique from Housz/ThreeVolumetricFire (MIT, see THIRD_PARTY_NOTICES.md):
// slices perpendicular to the view direction cut through a box, and each
// fragment looks up flame density from its position in that box (distance
// from an axis, height) displaced upwards by animated turbulence, so the top
// tears into ragged tips. Changed for Throwaway: the slices are a fixed quad
// stack built once and oriented in the vertex shader (the original re-slices
// a lattice and allocates new geometry every frame); instead of one column
// read from firetex.png, the box holds a handful of narrow tongues standing
// around the burning paper, each a teardrop profile computed in the shader
// whose base, height and sway are set per frame from JS (no allocations);
// blending is premultiplied "over" instead of additive, so the flame stays
// orange on a light warm-grey background.
import * as THREE from "three";
import { NOISE_GLSL } from "./noise.glsl.js";

const SLICES = 32;
const TONGUES = 7;

function sliceGeometry() {
  const positions = new Float32Array(SLICES * 4 * 3);
  const index = [];
  for (let s = 0; s < SLICES; s++) {
    // far slice first: drawn back to front without sorting
    const depth = 1 - (2 * (s + 0.5)) / SLICES;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    corners.forEach(([x, y], c) => positions.set([x, y, depth], (s * 4 + c) * 3));
    const b = s * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

const VERTEX = /* glsl */ `
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
varying vec3 vWorld;
void main() {
  vec3 world = uCenter + (uRight * position.x + uUp * position.y) * uRadius + uForward * position.z * uRadius;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform mat4 uToBox;
uniform float uTime;
uniform float uSeed;
uniform float uOpacity;
uniform vec4 uTongueA[${TONGUES}]; // base x, base y, base z (box space), height
uniform vec4 uTongueB[${TONGUES}]; // half width, lean x, lean z, phase
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  // box space: x, z in -0.5..0.5, y in 0..1
  vec3 loc = (uToBox * vec4(vWorld, 1.0)).xyz;
  if (loc.y < 0.0 || loc.y > 1.0 || abs(loc.x) > 0.5 || abs(loc.z) > 0.5) discard;

  // Housz: turbulence carried upwards with time displaces the sample, more
  // towards the top, so tips tear and flicker while bases stay attached
  vec3 q = vec3(loc.x * 9.0, loc.y * 5.0 - uTime * 4.2, loc.z * 9.0) + uSeed;
  float turb = snoise(q) + 0.5 * snoise(q * 2.1 + 7.3);

  float density = 0.0;
  float heat = 0.0;
  for (int i = 0; i < ${TONGUES}; i++) {
    vec4 A = uTongueA[i];
    vec4 B = uTongueB[i];
    if (A.w <= 0.001) continue;
    float t = (loc.y - A.y) / A.w;
    if (t < -0.12 || t > 1.0) continue;
    float tc = clamp(t, 0.0, 1.0);
    // the tongue bends inwards over the paper and sways as it rises
    vec2 c = A.xz + B.yz * tc * tc;
    c += vec2(sin(uTime * 5.3 + B.w), cos(uTime * 4.1 + B.w * 1.7)) * B.x * 0.45 * tc;
    vec2 d = loc.xz - c;
    d += vec2(turb, -turb) * B.x * 0.55 * (0.25 + tc);
    // teardrop: round foot, widest low down, drawn to a point
    float w = B.x * (smoothstep(-0.1, 0.12, t) * 0.65 + 0.2) * pow(1.0 - tc, 0.65);
    float r = length(d) / max(w, 1e-4);
    float k = exp(-r * r * 2.4) * (1.0 - smoothstep(0.62, 1.0, t + turb * 0.12));
    density += k;
    heat = max(heat, k * (1.0 - tc * 0.85) * exp(-r * r * 1.5));
  }
  if (density < 0.004) discard;
  density = min(density, 1.0);

  // over-range on purpose: the room's ACES tone mapping pulls these back to
  // a saturated orange and a pale yellow core instead of a washed peach
  vec3 deep = vec3(0.75, 0.07, 0.005);
  vec3 orange = vec3(1.55, 0.3, 0.015);
  vec3 yellow = vec3(1.9, 0.75, 0.1);
  vec3 core = vec3(2.2, 1.4, 0.55);
  vec3 col = mix(deep, orange, smoothstep(0.04, 0.3, heat));
  col = mix(col, yellow, smoothstep(0.35, 0.7, heat));
  col = mix(col, core, smoothstep(0.75, 0.95, heat));

  float a = clamp(density * (0.22 + heat * 0.95) * uOpacity * 4.0 / ${SLICES.toFixed(1)}, 0.0, 1.0);
  // premultiplied
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * @param {THREE.Camera} camera
 * @param {{ seed?: number }} [options]
 */
export function createFlames(camera, { seed = 1 } = {}) {
  const tongueA = Array.from({ length: TONGUES }, () => new THREE.Vector4());
  const tongueB = Array.from({ length: TONGUES }, () => new THREE.Vector4());
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uRadius: { value: 1 },
    uRight: { value: new THREE.Vector3(1, 0, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) },
    uForward: { value: new THREE.Vector3(0, 0, -1) },
    uToBox: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uSeed: { value: (seed % 997) * 0.31 },
    uOpacity: { value: 5.0 },
    uTongueA: { value: tongueA },
    uTongueB: { value: tongueB },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(sliceGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  // each tongue keeps its own place around the paper and its own rhythm
  let s = (seed * 2246822519) >>> 0 || 3;
  const random = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const tongues = Array.from({ length: TONGUES }, (_, i) => ({
    angle: ((i + random() * 0.6) / TONGUES) * Math.PI * 2,
    // mostly small licks along the edge
    tall: 0.38 + random() * 0.34,
    surge: 0,
    surgeRate: 1.3 + random() * 0.8,
    rate: 2.2 + random() * 2.6,
    phase: random() * 100,
    width: 0.75 + random() * 0.5,
    out: 0.85 + random() * 0.25,
  }));
  // now and then one of two tongues stretches up well clear of the paper
  // (B02's tall lick, B04's tongue), flickering, then sinks back
  const tallOne = Math.floor(random() * TONGUES);
  tongues[tallOne].tall = 0.45;
  tongues[tallOne].surge = 1.3;
  tongues[(tallOne + 3) % TONGUES].surge = 0.9;

  const box = new THREE.Matrix4();
  const boxPos = new THREE.Vector3();
  const boxScale = new THREE.Vector3();
  const boxQuat = new THREE.Quaternion();
  const camPos = new THREE.Vector3();

  return {
    mesh,
    uniforms,
    /**
     * @param {THREE.Vector3} base world point on the surface under the paper's centre
     * @param {number} width world diameter of the box the flames live in
     * @param {number} height world height of the box (the tallest tongue's reach)
     * @param {number} strength 0..1, how much is burning
     * @param {number} time seconds
     * @param {number} [front] 0..1 of the box height: where the tongues stand (the burning front)
     * @param {number} [ring] 0..1 of the box half-width: how far from the axis they stand
     * @param {THREE.Vector2} [slant] box-space x/z: a slanted front stands this much
     *   higher (in box heights) on that side, and its tongues there surge tallest
     */
    update(base, width, height, strength, time, front = 0, ring = 0.6, slant = null) {
      mesh.visible = strength > 0.01;
      uniforms.uTime.value = time;
      const half = 0.5 * ring;
      const slantLen = slant ? slant.length() : 0;
      for (let i = 0; i < TONGUES; i++) {
        const g = tongues[i];
        // flicker: two incommensurate waves plus a slow swell
        const f =
          0.62 +
          0.22 * Math.sin(time * g.rate + g.phase) +
          0.12 * Math.sin(time * g.rate * 2.7 + g.phase * 1.3) +
          0.1 * Math.sin(time * 0.9 + g.phase * 0.7);
        // tongues gutter one by one as the fire weakens
        const alive = Math.min(1, Math.max(0, strength * 1.6 - (i / TONGUES) * 0.6));
        const x = Math.cos(g.angle) * half * g.out;
        const z = Math.sin(g.angle) * half * g.out;
        // where the front runs higher, the tongue stands higher, and the
        // burning side is where the tall ones rise
        const along = slantLen > 1e-5 ? (Math.cos(g.angle) * slant.x + Math.sin(g.angle) * slant.y) / slantLen : 0;
        const baseY = Math.min(0.75, Math.max(0, front + along * slantLen));
        const surge = slantLen > 1e-5 ? 1.5 * Math.pow(Math.max(0, along), 2) : g.surge;
        const env = surge * Math.pow(Math.max(0, Math.sin(time * g.surgeRate + g.phase)), 3);
        const h = Math.min(1 - baseY, Math.max(0, (1 - baseY) * g.tall * f * alive * (1 + env)));
        tongueA[i].set(x, baseY * 0.85, z, h);
        tongueB[i].set(0.1 * g.width * (0.6 + 0.4 * alive) * (1 + 0.25 * env), -x * 0.7, -z * 0.7, g.phase);
      }
      boxPos.copy(base);
      boxScale.set(width, height, width);
      // box space: origin at the base centre, y = 1 at the top
      box.compose(boxPos, boxQuat, boxScale);
      uniforms.uToBox.value.copy(box).invert();
      // slices span the box's bounding sphere, facing the camera
      const radius = 0.5 * Math.sqrt(width * width * 2 + height * height);
      uniforms.uCenter.value.set(base.x, base.y + height / 2, base.z);
      uniforms.uRadius.value = radius;
      camera.getWorldPosition(camPos);
      uniforms.uForward.value.subVectors(uniforms.uCenter.value, camPos).normalize();
      uniforms.uRight.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      uniforms.uUp.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}
