import * as THREE from "three";

// A restrained, view-dependent sheen for the charcoal record face: a narrow
// bow-tie highlight across the grooves, the way light catches concentric
// grooves on real vinyl. It patches an existing MeshStandardMaterial (whose
// map is the record face with a transparent label window and whose bumpMap is
// the groove height), so the face keeps its matte charcoal look and gains only
// a thin neutral glint. No colour shift, no iridescence, no metal.
//
// The axis follows the half vector between the light and the eye, measured in
// the disc's own plane: tilt the record or move the camera and the bow-tie
// pivots; spin it and the grooves pass under a highlight that stays with the
// light. A turn adds a small lean in the direction of travel (`sweep`), which
// settles back as the spin slows.

export type VinylSheen = {
  // per frame: `disc` is the object the face turns with
  update: (disc: THREE.Object3D, camera: THREE.Camera, lightDir: THREE.Vector3, spinSpeed: number) => void;
};

export type VinylSheenOptions = {
  // where the grooves run, as fractions of the plate's half-width
  inner: number;
  outer: number;
  // peak added light, linear (keep small: the face is near black)
  strength?: number;
};

export function applyVinylSheen(material: THREE.MeshStandardMaterial, o: VinylSheenOptions): VinylSheen {
  const uniforms = {
    uSheenAxis: { value: 0 },
    uSheenAmount: { value: 1 },
    uSheenStrength: { value: o.strength ?? 0.055 },
    uSheenBand: { value: new THREE.Vector2(o.inner, o.outer) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uSheenAxis;
uniform float uSheenAmount;
uniform float uSheenStrength;
uniform vec2 uSheenBand;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
  // the face plate's own polar coordinates
  vec2 p = vMapUv - 0.5;
  float r = length(p) * 2.0;
  float ang = atan(p.y, p.x);
  float band = smoothstep(uSheenBand.x + 0.02, uSheenBand.x + 0.07, r) * (1.0 - smoothstep(uSheenBand.y - 0.05, uSheenBand.y - 0.005, r));
  // bow-tie: two narrow lobes along the axis, through the centre
  float bowtie = pow(abs(cos(ang - uSheenAxis)), 6.0);
  // fine groove relief breaks the glint into rings rather than a smear
  float groove = 0.7 + 0.6 * texture2D(bumpMap, vBumpMapUv).r;
  // a little brighter toward the middle of the grooved band
  float mid = 0.75 + 0.25 * sin(3.14159 * clamp((r - uSheenBand.x) / (uSheenBand.y - uSheenBand.x), 0.0, 1.0));
  outgoingLight += vec3(0.86, 0.86, 0.84) * (uSheenStrength * uSheenAmount * band * bowtie * groove * mid);
}
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "throwaway-vinyl-sheen-v1";
  material.needsUpdate = true;

  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const view = new THREE.Vector3();
  const half = new THREE.Vector3();
  return {
    update(disc, camera, lightDir, spinSpeed) {
      disc.getWorldPosition(pos);
      disc.getWorldQuaternion(q).invert();
      view.copy(camera.position).sub(pos).normalize();
      half.copy(lightDir).normalize().add(view).normalize().applyQuaternion(q);
      const inPlane = Math.hypot(half.x, half.y);
      // highlights lie where the groove tangent is perpendicular to the half
      // vector's projection, i.e. along that projection's direction
      const sweep = Math.max(-0.6, Math.min(0.6, spinSpeed * 0.25));
      uniforms.uSheenAxis.value = Math.atan2(half.y, half.x) - sweep * 1.6;
      // a record seen dead-on to the half vector has no defined axis: fade
      uniforms.uSheenAmount.value = Math.min(1, 0.35 + inPlane * 1.6);
    },
  };
}
