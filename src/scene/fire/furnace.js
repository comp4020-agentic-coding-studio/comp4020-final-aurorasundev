// The furnace for the local ritual (B01/B05): one squat, open cast-iron
// chamber with a thick rounded rim and a raised hearth inside, so a paper
// set into it, and later its ash, stay visible over the front rim from the
// space's camera. No legs, handles or chimney.
//
// Its interior is lit by the fire through a uniform (a warm falloff from
// the burning point) rather than a scene light, so adding it never changes
// the scene's light count and never recompiles every other material.
import * as THREE from "three";
import { NOISE_GLSL } from "./noise.glsl.js";

/**
 * Where on the floor the furnace sits so it shows at a given height on
 * screen: the floor point under normalised device y `ndcY` at the screen's
 * horizontal centre.
 */
export function furnaceAnchor(camera, ndcY, floorY) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, ndcY), camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY);
  const hit = new THREE.Vector3();
  return ray.ray.intersectPlane(plane, hit) ? hit : new THREE.Vector3(0, floorY, 0);
}

function profile(R, H, wall, hearth) {
  // (radius, height) points, outside bottom → rim → inside → hearth centre
  const p = [];
  const rr = wall * 0.5; // rim rounding
  p.push(new THREE.Vector2(0.001, 0));
  p.push(new THREE.Vector2(R - 0.012, 0));
  p.push(new THREE.Vector2(R, 0.012));
  p.push(new THREE.Vector2(R + 0.004, H * 0.5));
  p.push(new THREE.Vector2(R, H - rr));
  for (let i = 1; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    p.push(new THREE.Vector2(R - rr + Math.cos(a) * rr, H - rr + Math.sin(a) * rr));
  }
  p.push(new THREE.Vector2(R - wall, H - rr));
  p.push(new THREE.Vector2(R - wall - 0.002, hearth + 0.03));
  p.push(new THREE.Vector2(R - wall - 0.02, hearth + 0.004));
  p.push(new THREE.Vector2(R - wall - 0.05, hearth));
  p.push(new THREE.Vector2(0.001, hearth));
  return p;
}

const FURNACE_PARS = /* glsl */ `
uniform sampler2D uIron;
uniform vec3 uGlowPoint;
uniform float uGlow;
uniform float uGlowRadius;
uniform float uReveal;
uniform float uTimeF;
varying vec3 vFWorld;
varying vec3 vFLocal;
${NOISE_GLSL}
`;

/**
 * @param {THREE.Camera} camera
 * @param {{ iron: THREE.Texture }} textures
 * @param {{ radius?: number, position?: THREE.Vector3 }} [options]
 */
export function createFurnace(camera, textures, { radius = 0.42, position = new THREE.Vector3() } = {}) {
  const R = radius;
  const H = radius * 0.62;
  const wall = radius * 0.085;
  // high enough that a paper set on it, and later its ash, show over the
  // front rim from the space's camera (B02/B03)
  const hearthY = H * 0.55;
  const geometry = new THREE.LatheGeometry(profile(R, H, wall, hearthY), 96);
  geometry.computeVertexNormals();

  const iron = textures.iron;
  const uniforms = {
    uGlowPoint: { value: new THREE.Vector3() },
    uGlow: { value: 0 },
    uGlowRadius: { value: R * 0.6 },
    uReveal: { value: 0 },
    uTimeF: { value: 0 },
  };
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#ffffff"),
    roughness: 0.74,
    metalness: 0.18,
    envMapIntensity: 0.55,
  });
  uniforms.uIron = { value: iron };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vFWorld;\nvarying vec3 vFLocal;`)
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>\nvFWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFLocal = transformed;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FURNACE_PARS}`)
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        // appears and leaves as a fine dither, staying opaque (no sorting
        // against the flames it must hide behind its wall)
        if (snoise(vFLocal * 38.0) * 0.5 + 0.5 > uReveal * 1.02) discard;`,
      )
      .replace(
        "#include <map_fragment>",
        `
        float fInside;
        {
          // cylindrical mapping on the walls, planar on the hearth and rim
          // top, so the iron never streaks the way lathe UVs would
          float r = length(vFLocal.xz);
          float around = atan(vFLocal.z, vFLocal.x) / 6.2831853;
          vec2 wallUv = vec2(around * ${(Math.PI * 2 * R / (R * 1.1)).toFixed(3)}, vFLocal.y / ${(R * 1.1).toFixed(4)});
          vec2 flatUv = vFLocal.xz / ${(R * 1.1).toFixed(4)};
          float flatness = smoothstep(0.55, 0.85, abs(normalize(cross(dFdx(vFLocal), dFdy(vFLocal))).y));
          vec3 ironCol = mix(texture2D(uIron, wallUv).rgb, texture2D(uIron, flatUv + 0.37).rgb, flatness);
          diffuseColor.rgb *= ironCol * vec3(2.6, 2.35, 2.1);
          fInside = 1.0 - smoothstep(${(R - wall * 0.6).toFixed(4)}, ${(R - wall * 0.3).toFixed(4)}, r);
          fInside *= 1.0 - smoothstep(${(H - wall * 0.7).toFixed(4)}, ${(H - wall * 0.2).toFixed(4)}, vFLocal.y);
          // soot inside and on the hearth, worn a little lighter on the rim's crown
          diffuseColor.rgb *= mix(1.0, 0.48, fInside);
          float crown = smoothstep(${(H - wall * 0.35).toFixed(4)}, ${H.toFixed(4)}, vFLocal.y);
          diffuseColor.rgb *= 1.0 + crown * 0.28;
          float mottle = snoise(vFLocal * 7.0) * 0.5 + 0.5;
          diffuseColor.rgb *= mix(0.84, 1.1, mottle);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          // fire light reaches only the inside surfaces that face it
          vec3 glowView = (viewMatrix * vec4(uGlowPoint, 1.0)).xyz;
          vec3 toGlow = glowView + vViewPosition;
          float facing = clamp(dot(normal, normalize(toGlow)), 0.0, 1.0);
          float d = length(toGlow) / uGlowRadius;
          float fall = exp(-d * d * 2.2);
          float flicker = 0.82 + 0.18 * snoise(vec3(uTimeF * 3.1, 0.0, 0.0));
          totalEmissiveRadiance += vec3(1.0, 0.38, 0.09) * fall * facing * fInside * uGlow * flicker * 0.32;
          // and a broad warm wash over the whole chamber (B02's lit brown inside)
          float wash = exp(-d * d * 0.35);
          totalEmissiveRadiance += vec3(0.55, 0.24, 0.07) * wash * (0.4 + 0.6 * facing) * fInside * uGlow * flicker * 0.1;
        }`,
      );
  };
  material.customProgramCacheKey = () => "throwaway-furnace-v2";

  const group = new THREE.Group();
  group.position.copy(position);
  const body = new THREE.Mesh(geometry, material);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // The opening: the paper is committed only when released inside it.
  const openingGeometry = new THREE.CylinderGeometry(R - wall, R - wall, H - hearthY + R * 0.5, 32, 1, true);
  openingGeometry.translate(0, hearthY + (H - hearthY + R * 0.5) / 2, 0);
  const openingMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  const dropTarget = new THREE.Mesh(openingGeometry, openingMaterial);
  dropTarget.name = "furnace-opening";
  group.add(dropTarget);

  let reveal = 0;
  let revealTarget = 0;
  let time = 0;
  const local = new THREE.Vector3();

  const api = {
    group,
    body,
    dropTarget,
    radius: R,
    height: H,
    innerRadius: R - wall,
    /** world point at the centre of the hearth surface */
    hearthPoint: new THREE.Vector3(),
    /** world y of the rim's top */
    rimY: 0,
    show() {
      revealTarget = 1;
    },
    hide() {
      revealTarget = 0;
    },
    get visible() {
      return reveal > 0;
    },
    /** is a world point inside the opening (the space above the hearth, within the rim)? */
    contains(point) {
      local.copy(point);
      group.worldToLocal(local);
      const r = Math.hypot(local.x, local.z);
      return r < (R - wall) * 0.92 && local.y > hearthY && local.y < H + R * 0.5;
    },
    /** fire light: a world point and a 0..1 strength */
    setGlow(point, strength) {
      uniforms.uGlowPoint.value.copy(point);
      uniforms.uGlow.value = strength;
    },
    /** @param {number} dt seconds; the reveal takes about half a second */
    update(dt) {
      time += dt;
      uniforms.uTimeF.value = time;
      const step = dt / 0.5;
      reveal = revealTarget > reveal ? Math.min(revealTarget, reveal + step) : Math.max(revealTarget, reveal - step);
      uniforms.uReveal.value = reveal * reveal * (3 - 2 * reveal);
      group.visible = reveal > 0;
      group.updateMatrixWorld(true);
      api.hearthPoint.set(0, hearthY, 0).applyMatrix4(group.matrixWorld);
      api.rimY = group.position.y + H;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      openingGeometry.dispose();
      openingMaterial.dispose();
      group.removeFromParent();
    },
  };
  group.updateMatrixWorld(true);
  api.hearthPoint.set(0, hearthY, 0).applyMatrix4(group.matrixWorld);
  api.rimY = group.position.y + H;
  return api;
}
