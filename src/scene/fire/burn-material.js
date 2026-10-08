// A burning version of a paper's MeshStandardMaterial.
//
// Technique: a height-driven burn boundary perturbed by noise, as in
// OtanoStudio/Burn-Dissolve's BurnMaterial (Apache-2.0, see
// THIRD_PARTY_NOTICES.md), here measured in the paper's own object space
// along a burn-up axis fixed at ignition. The layering follows
// blvdesign/BurningPaperShader's separation (MIT): a dry brown stain and a
// scorch band ahead of the front, a thin segmented glowing edge, a charred
// lip and charcoal behind it, a pale ash fringe, then the paper is consumed.
// Consumption lags the charring, so a band of black paper stays visible
// below the front before it falls away.
//
// The source material keeps its maps and lighting: the patch only darkens,
// adds emission and discards. A matching depth material makes the shadow
// lose the consumed parts too.
import * as THREE from "three";
import { NOISE_GLSL } from "./noise.glsl.js";

const COMMON = /* glsl */ `
uniform float uProgress;   // front height, 0 = bottom of the paper, 1 = top
uniform vec3 uAxis;        // burn-up axis in object space (unit)
uniform vec3 uCenter;      // object-space centre the paper collapses towards
uniform float uHMin;
uniform float uHMax;
uniform float uSeed;
uniform vec3 uTilt;        // object space: the side the fire took first burns ahead
uniform float uNoiseScale;
uniform float uCollapse;   // 0..1, structure lost late in the burn
uniform float uTime;
uniform float uConsume;    // how far behind the front the paper falls away
varying vec3 vBurnPos;
${NOISE_GLSL}
float burnHeight(vec3 p) {
  float h = (dot(p, uAxis) - uHMin) / max(uHMax - uHMin, 1e-4);
  return h - dot(p - uCenter, uTilt) + fbm3(p * uNoiseScale + uSeed) * 0.16 + snoise(p * uNoiseScale * 4.3 - uSeed) * 0.02;
}
`;

const VERTEX_PARS = /* glsl */ `
attribute vec3 aBurnPos;
`;

// Paper behind the front shrivels towards the axis and, once collapse
// begins, everything sags into what is left below it.
const VERTEX_MAIN = /* glsl */ `
  vBurnPos = aBurnPos;
  {
    float span = uHMax - uHMin;
    float h = (dot(aBurnPos, uAxis) - uHMin) / max(span, 1e-4) - dot(aBurnPos - uCenter, uTilt) + snoise(aBurnPos * uNoiseScale + uSeed) * 0.14;
    float d = h - uProgress;
    float burnt = smoothstep(0.02, -0.22, d);
    vec3 fromAxis = transformed - uCenter;
    vec3 radial = fromAxis - uAxis * dot(fromAxis, uAxis);
    float wobble = snoise(aBurnPos * uNoiseScale * 2.1 + uSeed * 1.7);
    transformed -= radial * burnt * (0.28 + 0.16 * wobble);
    transformed += normal * burnt * wobble * 0.018 * span;
    float sag = uCollapse * (0.12 + 0.55 * clamp(h, 0.0, 1.0)) + burnt * 0.08;
    transformed -= uAxis * sag * span;
    transformed -= radial * uCollapse * 0.22;
  }
`;

const FRAGMENT_MAIN = /* glsl */ `
  float bD; float bChar; float bEdge; float bScorch; float bStain; float bAshRim; float bHeat;
  {
    float h = burnHeight(vBurnPos);
    bD = h - uProgress;
    float lag = uConsume + snoise(vBurnPos * uNoiseScale * 1.7 + uSeed * 3.1) * 0.06;
    if (bD < -lag) discard;
    bChar = smoothstep(0.0, -0.045, bD);
    bEdge = smoothstep(-0.055, -0.008, bD) * (1.0 - smoothstep(-0.004, 0.014, bD));
    bScorch = smoothstep(0.16, 0.0, bD) * (1.0 - bChar);
    bStain = smoothstep(0.045, 0.0, bD) * (1.0 - bChar);
    bAshRim = smoothstep(-lag + 0.07, -lag + 0.005, bD);
    bHeat = smoothstep(-0.32, -0.02, bD) * bChar;
  }
`;

const FRAGMENT_COLOR = /* glsl */ `
  {
    vec3 charred = texture2D(uCharMap, vBurnUv * 2.3 + uSeed).rgb;
    charred = charred * vec3(1.05, 0.98, 0.92) * 0.85 + vec3(0.012, 0.01, 0.008);
    float brittle = smoothstep(0.35, 0.8, snoise(vBurnPos * uNoiseScale * 9.0 + uSeed) * 0.5 + 0.5);
    charred = mix(charred, charred * 0.6, brittle * 0.5);
    vec3 dryBrown = vec3(0.80, 0.62, 0.40);
    vec3 stain = vec3(0.50, 0.27, 0.10);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * dryBrown, bScorch * 0.55);
    diffuseColor.rgb = mix(diffuseColor.rgb, stain, bStain * 0.75);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.045, 0.035), smoothstep(-0.004, -0.03, bD) * (1.0 - bChar * 0.4));
    diffuseColor.rgb = mix(diffuseColor.rgb, charred, bChar);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.46, 0.45, 0.43), bAshRim * 0.75);
  }
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
  roughnessFactor = mix(roughnessFactor, 1.0, bChar);
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
  {
    float seg = snoise(vBurnPos * uNoiseScale * 7.0 + vec3(0.0, -uTime * 2.2, uTime * 0.7) + uSeed) * 0.5 + 0.5;
    float flick = 0.75 + 0.25 * sin(uTime * 17.0 + seg * 9.0);
    float hot = smoothstep(0.3, 0.75, seg) * flick;
    vec3 amber = vec3(1.0, 0.34, 0.05);
    vec3 core = vec3(1.0, 0.72, 0.28);
    totalEmissiveRadiance += amber * bEdge * (0.55 + 2.1 * hot) * uGlow;
    totalEmissiveRadiance += core * pow(bEdge, 3.0) * hot * 1.6 * uGlow;
    float pockets = smoothstep(0.74, 0.95, snoise(vBurnPos * uNoiseScale * 14.0 + vec3(uTime * 0.3, 0.0, -uTime * 0.2)) * 0.5 + 0.5);
    totalEmissiveRadiance += vec3(1.0, 0.26, 0.04) * pockets * bHeat * 0.7 * uGlow * (1.0 - bAshRim);
  }
`;

/**
 * @param {THREE.MeshStandardMaterial} source the paper's material; it is cloned, not changed
 * @param {{ charMap: THREE.Texture, seed: number }} options
 */
export function createBurnMaterial(source, { charMap, seed }) {
  const uniforms = {
    uProgress: { value: -0.2 },
    uAxis: { value: new THREE.Vector3(0, 1, 0) },
    uCenter: { value: new THREE.Vector3() },
    uHMin: { value: 0 },
    uHMax: { value: 1 },
    uSeed: { value: (seed % 1000) * 0.137 },
    uTilt: { value: new THREE.Vector3() },
    uNoiseScale: { value: 4.5 },
    uCollapse: { value: 0 },
    uTime: { value: 0 },
    uConsume: { value: 0.3 },
    uGlow: { value: 1 },
    uCharMap: { value: charMap },
  };

  const material = source.clone();
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${COMMON}\n${VERTEX_PARS}\nvarying vec2 vBurnUv;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvBurnUv = uv;\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON}\nuniform float uGlow;\nuniform sampler2D uCharMap;\nvarying vec2 vBurnUv;`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${FRAGMENT_MAIN}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${FRAGMENT_COLOR}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${FRAGMENT_EMISSIVE}`);
  };
  material.customProgramCacheKey = () => "throwaway-burn-v2";

  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${COMMON}\n${VERTEX_PARS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${FRAGMENT_MAIN}`);
  };
  depthMaterial.customProgramCacheKey = () => "throwaway-burn-depth-v2";

  return {
    material,
    depthMaterial,
    uniforms,
    dispose() {
      material.dispose();
      depthMaterial.dispose();
    },
  };
}

/**
 * Fixes the burn-up axis at ignition: world up, expressed in the mesh's
 * object space, with the paper's extent along it measured from the vertices
 * its triangles actually use. Adds an `aBurnPos` attribute holding the
 * positions at that moment, so the burn pattern stays put if the vertices
 * move later.
 */
export function fixBurnFrame(mesh, uniforms, worldUp = new THREE.Vector3(0, 1, 0)) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const snapshot = new Float32Array(position.array);
  geometry.setAttribute("aBurnPos", new THREE.BufferAttribute(snapshot, 3));

  mesh.updateMatrixWorld(true);
  const q = new THREE.Quaternion();
  mesh.getWorldQuaternion(q);
  const axis = worldUp.clone().normalize().applyQuaternion(q.invert());
  uniforms.uAxis.value.copy(axis);

  const index = geometry.getIndex();
  let min = Infinity;
  let max = -Infinity;
  const centre = uniforms.uCenter.value.set(0, 0, 0);
  const seen = new Uint8Array(position.count);
  let n = 0;
  const v = new THREE.Vector3();
  const count = index ? index.count : position.count;
  for (let i = 0; i < count; i++) {
    const k = index ? index.getX(i) : i;
    if (seen[k]) continue;
    seen[k] = 1;
    v.fromArray(snapshot, k * 3);
    const h = v.dot(axis);
    if (h < min) min = h;
    if (h > max) max = h;
    centre.add(v);
    n++;
  }
  centre.multiplyScalar(1 / Math.max(n, 1));
  uniforms.uHMin.value = min;
  uniforms.uHMax.value = max;
  return { axis, min, max, used: seen, snapshot };
}
