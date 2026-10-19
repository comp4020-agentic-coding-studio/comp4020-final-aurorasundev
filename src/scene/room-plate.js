// The room's wall/floor photographic plate (public/textures/room/manifest.json).
//
// One complete, non-tileable background image with baked window light is
// projected onto the existing 3D wall and floor from a fixed "plate camera":
// the home baseline pose for the current aspect, never the active camera. The
// ritual and burn lenses therefore see the light stay on the same patch of
// floor and wall instead of sliding with the screen. The image's wall/floor
// junction is pinned to the real seam (wall and floor each map their own half
// so the junction row lands exactly on the geometric edge), and outside the
// projected room both surfaces fade to a close plain base colour.
//
// The plate drives the surface's lit colour directly (it already holds its
// light), corrected for the renderer's ACES tone mapping so the home view
// matches the raw image. Live shadows still darken it by the scene's own
// shadowed/unshadowed light ratio, so paper and furnace shadows keep their
// depth; the floor's existing shadow deepening runs after it unchanged.
import * as THREE from "three";

// Measured on the source: the plaster ends at row ~410 of 941 (the manifest
// estimate is 408); the thin dark contact line sits on row 411.
const SOURCE_JUNCTION_V = 410.5 / 941;
const SOURCE_ASPECT = 1672 / 941;
// Outer band of the image used to fade into the base colour. The home view is
// overscanned by this much, so at home nothing fades.
const EDGE = 0.045;
// The most a half of the image is stretched vertically past uniform scale
// (a steep portrait phone sees much more floor than the plate shows).
const MAX_STRETCH = 1.6;
// Where the visible crop sits when the screen is narrower than the image:
// slightly left of centre, so a phone still catches some window light.
const CROP_BIAS = 0.15;
// Image width per world unit for the continued grain: the bottom rows of the
// plate span about three units of floor at home.
const GRAIN_U_PER_UNIT = 0.33;
// Plain colours the image fades to: the wall's average along its right edge,
// and the floor's average over its lowest quarter (rows 700-941).
const WALL_BASE = [148 / 255, 163 / 255, 173 / 255];
const FLOOR_BASE = [204 / 255, 193 / 255, 186 / 255];

export function createRoomPlate() {
  const exposure = { value: 1 };
  // ACES (three r160's fitted version) inverted on the CPU: see
  // tonemapping_pars_fragment. The shader solves the RRT/ODT fit per channel.
  const acesIn = new THREE.Matrix3().set(
    0.59719, 0.35458, 0.04823,
    0.07600, 0.90834, 0.01566,
    0.02840, 0.13383, 0.83777,
  );
  const acesOut = new THREE.Matrix3().set(
    1.60475, -0.53108, -0.07367,
    -0.10208, 1.10813, -0.00605,
    -0.00327, -0.07276, 1.07602,
  );
  const shared = {
    uPlate: { value: null },
    uPlateOn: { value: 0 },
    uPlateViewProj: { value: new THREE.Matrix4() },
    // u0, visible u fraction, screen seam (from top), image junction v
    uPlateMap: { value: new THREE.Vector4(0, 1, 0.5, SOURCE_JUNCTION_V) },
    uPlateEdge: { value: EDGE },
    uPlateExposure: exposure,
    uAcesInInv: { value: acesIn.clone().invert() },
    uAcesOutInv: { value: acesOut.clone().invert() },
  };
  const wallK = { value: 1 };
  const floorK = { value: 1 };
  const wallBase = { value: new THREE.Color().setRGB(...WALL_BASE, THREE.SRGBColorSpace) };
  const floorBase = { value: new THREE.Color().setRGB(...FLOOR_BASE, THREE.SRGBColorSpace) };

  const plateCamera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  const seamPoint = new THREE.Vector3();
  let sourceAspect = SOURCE_ASPECT;
  let lastFit = null;

  /** Recomputed on resize only; `pose` is the scene's home-camera pose. */
  function fit(pose, aspect, floorY, wallZ) {
    lastFit = [pose, aspect, floorY, wallZ];
    pose(plateCamera, aspect);
    plateCamera.updateProjectionMatrix();
    plateCamera.updateMatrixWorld(true);
    shared.uPlateViewProj.value.multiplyMatrices(plateCamera.projectionMatrix, plateCamera.matrixWorldInverse);
    seamPoint.set(0, floorY, wallZ).project(plateCamera);
    const seam = THREE.MathUtils.clamp((1 - seamPoint.y) / 2, 0.02, 0.98);
    const vj = SOURCE_JUNCTION_V;
    // k: screen heights per image height
    const kWide = aspect / (sourceAspect * (1 - 2 * EDGE));
    const kWall = seam / (vj - EDGE);
    const kFloor = (1 - seam) / (1 - EDGE - vj);
    const k = Math.max(kWide, kWall / MAX_STRETCH, kFloor / MAX_STRETCH);
    const visible = aspect / (sourceAspect * k);
    const u0 = EDGE + (1 - 2 * EDGE - visible) * CROP_BIAS;
    shared.uPlateMap.value.set(u0, visible, seam, vj);
    wallK.value = 1 / Math.max(kWall, k);
    floorK.value = 1 / Math.max(kFloor, k);
  }

  function patch(shader, surface) {
    const floor = surface === "floor";
    Object.assign(shader.uniforms, shared, {
      uPlateK: floor ? floorK : wallK,
      uPlateBase: floor ? floorBase : wallBase,
      uPlateGrainOrigin: { value: new THREE.Vector2(0.5, floor ? 0.8 : 0.2) },
      uPlateGrainScale: { value: new THREE.Vector2(GRAIN_U_PER_UNIT, GRAIN_U_PER_UNIT * SOURCE_ASPECT) },
      // quiet patches: the right half of the plaster, the lower floor
      uPlateGrainU: { value: new THREE.Vector2(floor ? 0.05 : 0.55, floor ? 0.95 : 0.95) },
      uPlateGrainV: { value: new THREE.Vector2(floor ? 0.6 : 0.06, floor ? 0.98 : 0.38) },
    });
    const axes = floor ? "vec2(vPlateWorld.x, vPlateWorld.z)" : "vec2(vPlateWorld.x, -vPlateWorld.y)";
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPlateWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvPlateWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vPlateWorld;
uniform sampler2D uPlate;
uniform float uPlateOn;
uniform mat4 uPlateViewProj;
uniform vec4 uPlateMap;
uniform float uPlateEdge;
uniform float uPlateK;
uniform vec3 uPlateBase;
uniform float uPlateExposure;
uniform mat3 uAcesInInv;
uniform mat3 uAcesOutInv;
uniform vec2 uPlateGrainOrigin;
uniform vec2 uPlateGrainScale;
uniform vec2 uPlateGrainU;
uniform vec2 uPlateGrainV;
vec3 plateInverseFit(vec3 y) {
  y = clamp(y, 0.0, 0.985);
  vec3 a = 1.0 - 0.983729 * y;
  vec3 b = 0.0245786 - 0.4329510 * y;
  vec3 c = -(0.000090537 + 0.238081 * y);
  return (-b + sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
}
// the linear scene light that ACES + exposure turns back into this colour
vec3 plateUntonemap(vec3 target) {
  vec3 v = plateInverseFit(uAcesOutInv * target);
  return max(uAcesInInv * v, 0.0) * 0.6 / uPlateExposure;
}
float plateMirror(float t, vec2 range) {
  float w = range.y - range.x;
  return range.x + w - abs(w - mod(t - range.x, 2.0 * w));
}
vec3 plateColour() {
  vec4 clip = uPlateViewProj * vec4(vPlateWorld, 1.0);
  float ahead = step(1e-4, clip.w);
  vec2 screen = clip.xy / max(clip.w, 1e-4) * 0.5 + 0.5;
  float fromTop = 1.0 - screen.y;
  // each surface maps its own half, so the image junction row sits on the seam
  vec2 uv = vec2(uPlateMap.x + screen.x * uPlateMap.y, uPlateMap.w + (fromTop - uPlateMap.z) * uPlateK);
  // Past the image (only the ritual lenses see there) the surface goes on as
  // the image's own fine grain laid over a plain base matched to the plate's
  // edge average: the window light dissolves over a short distance while the
  // stone or plaster texture continues, so there is no line, band or repeat
  // of the light. The grain is sampled by ping-ponging inside the outer band
  // of the image, so its scale matches the nearest rows.
  // signed distance past the image (negative inside)
  vec2 out2 = max(-uv, uv - 1.0);
  float beyond = ahead * max(out2.x, out2.y) + (1.0 - ahead) * 10.0;
  vec2 st = clamp(uv, 0.0, 1.0);
  st.y = 1.0 - st.y;
  vec3 detail = texture2D(uPlate, st).rgb;
  // the light only: a heavily blurred sample, which carries the edge's tone
  // outward without the streaks a clamped edge row would draw
  vec3 light = texture2D(uPlate, st, 6.0).rgb;
  // grain in the surface's own world coordinates (no projective stretching
  // near the camera), mirrored inside a quiet patch of the same material
  vec2 g = uPlateGrainOrigin + uPlateGrainScale * ${axes};
  vec2 gs = vec2(plateMirror(g.x, uPlateGrainU), plateMirror(g.y, uPlateGrainV));
  gs.y = 1.0 - gs.y;
  vec3 grain = clamp(texture2D(uPlate, gs).rgb / max(texture2D(uPlate, gs, 6.0).rgb, vec3(0.02)), 0.92, 1.08);
  vec3 continued = mix(light, uPlateBase, smoothstep(0.0, uPlateEdge * 8.0, beyond)) * grain;
  return mix(detail, continued, smoothstep(-uPlateEdge, uPlateEdge * 0.5, beyond));
}`)
      // with the plate, light a white surface so the light itself can be measured
      .replace("#include <color_fragment>", "#include <color_fragment>\nif (uPlateOn > 0.5) diffuseColor.rgb = vec3(1.0);")
      .replace("#include <opaque_fragment>", `if (uPlateOn > 0.5) {
  // the key light is the only shadow caster, sorted first by three.js
  vec3 plateLost = vec3(0.0);
  #if NUM_DIR_LIGHTS > 0
    plateLost = (1.0 - getShadowMask()) * saturate(dot(normal, directionalLights[0].direction))
      * directionalLights[0].color * RECIPROCAL_PI;
  #endif
  vec3 plateShade = outgoingLight / max(outgoingLight + plateLost, vec3(1e-4));
  outgoingLight = plateUntonemap(plateColour()) * plateShade;
}
#include <opaque_fragment>`);
    if (surface === "wall") {
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <shadowmap_pars_fragment>", "#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>");
    }
  }

  let texture = null;
  let disposed = false;
  /** Async; on failure the original plain wall and floor stay. */
  function load(url, renderer) {
    exposure.value = renderer.toneMappingExposure;
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        tex.needsUpdate = true;
        texture = tex;
        if (tex.image?.width && tex.image?.height) sourceAspect = tex.image.width / tex.image.height;
        if (lastFit) fit(...lastFit);
        shared.uPlate.value = tex;
        shared.uPlateOn.value = 1;
      },
      undefined,
      () => {
        // keep the plain room
      },
    );
  }

  return {
    fit,
    patchFloor: (shader) => patch(shader, "floor"),
    patchWall: (shader) => patch(shader, "wall"),
    load,
    dispose() {
      disposed = true;
      shared.uPlateOn.value = 0;
      shared.uPlate.value = null;
      texture?.dispose();
      texture = null;
    },
  };
}
