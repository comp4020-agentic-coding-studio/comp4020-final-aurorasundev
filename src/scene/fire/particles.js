// Sparse smoke, embers and a warm glow under the fire. Smoke is a few
// camera-facing wisps cut from a generated smoke photograph (used as a
// luminance mask, tinted grey); embers are a handful of points; the glow is
// a soft additive disc on the surface below. Buffers are allocated once.
import * as THREE from "three";

const WISPS = 5;
const EMBERS = 28;

/**
 * @param {{ smoke: THREE.Texture }} textures
 * @param {{ seed: number, size: number }} options size: world diameter of the burning paper
 */
export function createParticles(textures, { seed, size }) {
  const group = new THREE.Group();
  let s = (seed * 2654435761) >>> 0 || 7;
  const random = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };

  // ---- smoke wisps
  const wispMaterials = [];
  const wisps = [];
  for (let i = 0; i < WISPS; i++) {
    const material = new THREE.SpriteMaterial({
      color: new THREE.Color("#7f7a74"),
      alphaMap: textures.smoke,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 12;
    sprite.visible = false;
    group.add(sprite);
    wispMaterials.push(material);
    wisps.push({ sprite, age: random() * 3, life: 2.6 + random() * 1.4, x: 0, z: 0, sway: random() * 6.28 });
  }

  // ---- embers
  const emberPos = new Float32Array(EMBERS * 3);
  const emberLife = new Float32Array(EMBERS);
  const embers = Array.from({ length: EMBERS }, () => ({ v: new THREE.Vector3(), age: 0, life: 0 }));
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3).setUsage(THREE.DynamicDrawUsage));
  emberGeo.setAttribute("aLife", new THREE.BufferAttribute(emberLife, 1).setUsage(THREE.DynamicDrawUsage));
  const emberMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // point size in pixels = world size × pixels per unit / depth
    uniforms: { uSize: { value: 0.006 }, uScale: { value: 900 } },
    vertexShader: /* glsl */ `
      attribute float aLife;
      uniform float uSize;
      uniform float uScale;
      varying float vLife;
      void main() {
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * uScale * (0.6 + aLife) / max(-mv.z, 0.1);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.2, d) * vLife;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0, 0.45, 0.1) * a, a);
      }`,
  });
  const emberPoints = new THREE.Points(emberGeo, emberMaterial);
  emberPoints.frustumCulled = false;
  emberPoints.renderOrder = 13;
  group.add(emberPoints);

  // ---- glow on the surface under the fire
  const glowMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uAmount: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "uniform float uAmount; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float a = exp(-r * r * 4.0) * uAmount; gl_FragColor = vec4(vec3(1.0, 0.42, 0.12) * a, a); }",
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial);
  glow.rotation.x = -Math.PI / 2;
  glow.renderOrder = 2;
  group.add(glow);

  const tmp = new THREE.Vector3();

  return {
    group,
    /**
     * @param {number} dt
     * @param {{ source: THREE.Vector3, top: number, fire: number, smoke: number, surfaceY: number }} f
     *   source: centre of the burning region; top: world y the flames reach;
     *   fire, smoke: 0..1 amounts; surfaceY: the floor or hearth under it
     */
    update(dt, { source, top, fire, smoke, surfaceY }) {
      // wisps rise from above the flames, sway, thin out
      for (const w of wisps) {
        w.age += dt;
        if (w.age > w.life) {
          w.age = 0;
          w.life = 2.6 + random() * 1.4;
          w.x = (random() - 0.5) * size * 0.4;
          w.z = (random() - 0.5) * size * 0.4;
          w.sway = random() * 6.28;
        }
        const t = w.age / w.life;
        const sprite = w.sprite;
        sprite.visible = smoke > 0.01;
        const height = size * (1.1 + 1.6 * t);
        sprite.scale.set(size * (0.35 + 0.5 * t), height, 1);
        sprite.position.set(
          source.x + w.x + Math.sin(w.sway + w.age * 1.3) * size * 0.12 * t,
          // the wisp's foot starts among the flame tips (B02), not above them
          source.y + (top - source.y) * 0.2 + height * 0.5 + w.age * size * 0.25,
          source.z + w.z,
        );
        sprite.material.rotation = Math.sin(w.sway + w.age * 0.7) * 0.18;
        sprite.material.opacity = smoke * 0.45 * Math.sin(Math.PI * t);
      }

      // embers: born at the burning region, drift up, flicker out
      for (let i = 0; i < EMBERS; i++) {
        const e = embers[i];
        e.age += dt;
        if (e.age > e.life) {
          if (fire > 0.05 && random() < fire * 0.9) {
            e.age = 0;
            e.life = 0.5 + random() * 1.1;
            tmp.set((random() - 0.5) * size * 0.8, (random() - 0.3) * size * 0.3, (random() - 0.5) * size * 0.8).add(source);
            emberPos.set([tmp.x, tmp.y, tmp.z], i * 3);
            e.v.set((random() - 0.5) * 0.08, 0.15 + random() * 0.3, (random() - 0.5) * 0.08);
          } else {
            emberLife[i] = 0;
            continue;
          }
        }
        emberPos[i * 3] += (e.v.x + Math.sin(e.age * 7 + i) * 0.04) * dt;
        emberPos[i * 3 + 1] += e.v.y * dt;
        emberPos[i * 3 + 2] += e.v.z * dt;
        const t = e.age / e.life;
        emberLife[i] = Math.max(0, (1 - t) * (0.6 + 0.4 * Math.sin(e.age * 23 + i)));
      }
      emberGeo.attributes.position.needsUpdate = true;
      emberGeo.attributes.aLife.needsUpdate = true;

      glow.position.set(source.x, surfaceY + 0.002, source.z);
      glow.scale.setScalar(size * 2.2);
      glowMaterial.uniforms.uAmount.value = fire * 0.2;
    },
    /** pixels per world unit at distance 1 (viewport height / (2 tan(fov/2))) */
    setPixelScale(pixelsPerUnit) {
      emberMaterial.uniforms.uScale.value = pixelsPerUnit;
    },
    dispose() {
      for (const m of wispMaterials) m.dispose();
      emberGeo.dispose();
      emberMaterial.dispose();
      glow.geometry.dispose();
      glowMaterial.dispose();
      group.removeFromParent();
    },
  };
}
