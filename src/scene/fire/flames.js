// A small volumetric flame drawn as a stack of view-aligned slices.
//
// Technique from Housz/ThreeVolumetricFire (MIT, see THIRD_PARTY_NOTICES.md):
// slices perpendicular to the view direction cut through a box, and each
// fragment looks up flame density from its position in that box (distance
// from the axis, height) displaced upwards by animated turbulence, so the
// top breaks into tongues. Changed for Throwaway: the slices are a fixed
// quad stack built once and oriented in the vertex shader (the original
// re-slices a lattice and allocates new geometry every frame); the colour
// profile is computed in the shader instead of read from firetex.png; the
// density is shaped into a ring of narrow tongues around the burning paper
// with a few taller licks; blending is premultiplied "over" instead of
// additive, so the flame stays orange on a light warm-grey background.
import * as THREE from "three";
import { NOISE_GLSL } from "./noise.glsl.js";

const SLICES = 28;

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
uniform float uStrength;  // 0..1: how much of the paper is burning
uniform float uSeed;
uniform float uOpacity;
uniform float uHollow;    // 0: solid core, 1: flames only around the rim
varying vec3 vWorld;
${NOISE_GLSL}
float turbulence(vec3 p) {
  float sum = 0.0;
  float amp = 1.0;
  for (int i = 0; i < 4; i++) {
    sum += abs(snoise(p)) * amp;
    p *= 2.0;
    amp *= 0.5;
  }
  return sum;
}
void main() {
  // box space: x, z in -0.5..0.5, y in 0..1 (base to tip)
  vec3 loc = (uToBox * vec4(vWorld, 1.0)).xyz;
  if (loc.y < 0.0 || loc.y > 1.0 || abs(loc.x) > 0.5 || abs(loc.z) > 0.5) discard;
  float r = length(loc.xz) * 2.0;
  float angle = atan(loc.z, loc.x);

  // Housz: the sample height is pushed up by turbulence, sqrt-weighted so
  // the base stays attached while the top tears into tongues
  vec3 q = vec3(loc.x * 2.6, loc.y * 1.6 - uTime * 1.35, loc.z * 2.6) + uSeed;
  float turb = turbulence(q);
  float y = loc.y + sqrt(loc.y) * 0.95 * turb;

  // tongues: each direction around the paper reaches its own, changing
  // height; they rise from a ring just outside the paper's surface and lean
  // in over it, thinning to points
  float tongue = snoise(vec3(cos(angle) * 1.6 + uSeed, sin(angle) * 1.6, uTime * 0.9)) * 0.5 + 0.5;
  float reach = mix(0.2, 1.0, pow(tongue, 1.8)) * mix(0.35, 1.0, uStrength);
  float rise = clamp(y / reach, 0.0, 1.0);
  float centre = mix(0.66, 0.3, rise * rise) * mix(1.0, 0.0, 1.0 - uHollow);
  float thick = mix(0.3, 0.05, rise);
  float body = 1.0 - smoothstep(thick * 0.45, thick, abs(r - centre));
  // split the sheet into separate licks around the paper
  float licks = snoise(vec3(cos(angle) * 3.4 - uSeed, sin(angle) * 3.4, loc.y * 2.2 - uTime * 2.6)) * 0.5 + 0.5;
  body *= smoothstep(0.2 + 0.45 * rise, 0.45 + 0.45 * rise, licks);
  float tip = 1.0 - smoothstep(reach * 0.5, reach, y);
  float base = smoothstep(0.0, 0.06, loc.y);
  float density = body * tip * base;
  if (density < 0.003) discard;

  float heat = clamp(1.0 - y / reach, 0.0, 1.0) * density;
  vec3 deep = vec3(0.55, 0.07, 0.015);
  vec3 orange = vec3(1.0, 0.38, 0.06);
  vec3 yellow = vec3(1.0, 0.72, 0.30);
  vec3 core = vec3(1.0, 0.93, 0.75);
  vec3 col = mix(deep, orange, smoothstep(0.05, 0.35, heat));
  col = mix(col, yellow, smoothstep(0.35, 0.7, heat));
  col = mix(col, core, smoothstep(0.75, 0.98, heat));

  float a = clamp(density * (0.25 + heat) * uOpacity * 14.0 / ${SLICES.toFixed(1)}, 0.0, 1.0);
  // premultiplied: a little brighter than the alpha, so it reads as light
  gl_FragColor = vec4(col * a * 1.35, a);
}
`;

/**
 * @param {THREE.Camera} camera
 * @param {{ seed?: number }} [options]
 */
export function createFlames(camera, { seed = 1 } = {}) {
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uRadius: { value: 1 },
    uRight: { value: new THREE.Vector3(1, 0, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) },
    uForward: { value: new THREE.Vector3(0, 0, -1) },
    uToBox: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uStrength: { value: 0 },
    uSeed: { value: (seed % 997) * 0.31 },
    uOpacity: { value: 1.6 },
    uHollow: { value: 1 },
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
  material.toneMapped = true;
  const mesh = new THREE.Mesh(sliceGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  const box = new THREE.Matrix4();
  const boxPos = new THREE.Vector3();
  const boxScale = new THREE.Vector3();
  const boxQuat = new THREE.Quaternion();
  const camPos = new THREE.Vector3();

  return {
    mesh,
    uniforms,
    /**
     * @param {THREE.Vector3} base world point at the centre of the flame's base
     * @param {number} width world width (diameter) of the flame at its base
     * @param {number} height world height of the tallest tongue
     * @param {number} strength 0..1
     * @param {number} time seconds
     */
    update(base, width, height, strength, time) {
      mesh.visible = strength > 0.01;
      uniforms.uTime.value = time;
      uniforms.uStrength.value = strength;
      boxPos.copy(base);
      boxScale.set(width, height, width);
      // box space: origin at the base centre, y = 1 at the tip
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
