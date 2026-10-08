// What a burning paper leaves: thin charred flakes that break off as the
// front passes and fall (a few lift on the heat first), and a shallow mound
// of powder that grows under the paper. Flakes are one InstancedMesh using a
// 4×4 atlas of generated flake photographs; the mound is a low displaced
// disc using a generated ash-bed photograph. No physics bodies.
import * as THREE from "three";

const ATLAS_CELLS = 4;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// a unit disc with enough rings for the displacement to shape a mound; its
// UVs map the whole ash-bed photograph across it
const moundGeometry = () => new THREE.RingGeometry(0.0001, 1, 48, 10);

/**
 * @param {{ flakes: THREE.Texture, ashBed: THREE.Texture }} textures
 * @param {{ count: number, seed: number, flakeSize: number }} options flakeSize: world size of a typical flake
 */
export function createAsh(textures, { count, seed, flakeSize }) {
  const random = rand(seed * 7919 + 13);
  const group = new THREE.Group();

  // ---- flakes
  const plane = new THREE.PlaneGeometry(1, 1, 2, 2);
  plane.rotateX(-Math.PI / 2);
  const cell = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const k = Math.floor(random() * ATLAS_CELLS * ATLAS_CELLS);
    cell[i * 2] = k % ATLAS_CELLS;
    cell[i * 2 + 1] = ATLAS_CELLS - 1 - Math.floor(k / ATLAS_CELLS);
  }
  plane.setAttribute("aCell", new THREE.InstancedBufferAttribute(cell, 2));
  const flakeMaterial = new THREE.MeshStandardMaterial({
    map: textures.flakes,
    color: new THREE.Color("#8e8a85"),
    roughness: 1,
    metalness: 0,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    envMapIntensity: 0.2,
  });
  flakeMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aCell;")
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (vMapUv + aCell) / ${ATLAS_CELLS.toFixed(1)};\n#endif`,
      )
      // a slight curl: thin flakes are never perfectly flat
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.y += (transformed.x * transformed.x + transformed.z * transformed.z) * 0.35;");
  };
  flakeMaterial.customProgramCacheKey = () => "throwaway-ash-flakes-v1";
  const flakes = new THREE.InstancedMesh(plane, flakeMaterial, count);
  flakes.frustumCulled = false;
  flakes.count = 0;
  group.add(flakes);

  const state = Array.from({ length: count }, () => ({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    rot: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    size: 1,
    settled: false,
    restY: 0,
    age: 0,
    lift: 0,
  }));
  let used = 0;

  // ---- mound
  const moundGeo = moundGeometry();
  const moundUniforms = { uGrow: { value: 0 }, uHeight: { value: 0.04 }, uSeed: { value: (seed % 101) * 0.7 } };
  const moundMaterial = new THREE.MeshStandardMaterial({
    map: textures.ashBed,
    color: new THREE.Color("#c9c4bd"),
    roughness: 1,
    metalness: 0,
    alphaTest: 0.22,
    envMapIntensity: 0.15,
  });
  moundMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, moundUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uGrow;\nuniform float uHeight;\nuniform float uSeed;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          float r = length(transformed.xy);
          float lump = sin(transformed.x * 9.0 + uSeed) * sin(transformed.y * 8.0 - uSeed) * 0.18
                     + sin(transformed.x * 23.0 - uSeed * 2.0) * sin(transformed.y * 19.0 + uSeed) * 0.08;
          float h = pow(max(1.0 - r * r, 0.0), 1.6) * (1.0 + lump);
          transformed.z += h * uHeight * uGrow;
        }`,
      );
  };
  moundMaterial.customProgramCacheKey = () => "throwaway-ash-mound-v1";
  const mound = new THREE.Mesh(moundGeo, moundMaterial);
  mound.rotation.x = -Math.PI / 2;
  mound.receiveShadow = true;
  mound.castShadow = true;
  mound.visible = false;
  group.add(mound);

  // a soft dark contact shade under the ash
  const shadeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uAmount: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "uniform float uAmount; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float a = pow(max(1.0 - r, 0.0), 2.2) * uAmount; gl_FragColor = vec4(0.16, 0.14, 0.12, a); }",
  });
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadeMaterial);
  shade.rotation.x = -Math.PI / 2;
  shade.renderOrder = 1;
  group.add(shade);

  let moundRadius = flakeSize * 3;
  let opacity = 1;
  let growth = 0;
  function applyGrowth() {
    const k = growth * opacity;
    mound.visible = k > 0.001;
    moundUniforms.uGrow.value = k;
    const spread = moundRadius * (0.35 + 0.65 * Math.sqrt(growth));
    mound.scale.set(spread, spread, 1);
    shadeMaterial.uniforms.uAmount.value = 0.32 * Math.sqrt(k);
  }

  return {
    group,
    /**
     * Where the ash gathers: centre on the resting surface (hearth or floor), the
     * mound's full radius and height.
     */
    setBed(centre, radius, height) {
      mound.position.copy(centre);
      shade.position.set(centre.x, centre.y + 0.001, centre.z);
      shade.scale.setScalar(radius * 3.2);
      moundRadius = radius;
      mound.scale.set(radius, radius, 1);
      // the disc's z is not scaled, so the height is in world units
      moundUniforms.uHeight.value = height;
    },
    /** 0..1 how much powder has gathered */
    setGrowth(g) {
      growth = Math.min(Math.max(g, 0), 1);
      applyGrowth();
    },
    /**
     * Breaks a flake off at a world point.
     * @param {THREE.Vector3} at
     * @param {THREE.Vector3} outward a rough direction away from the paper
     * @param {number} restY the surface it settles on
     * @param {boolean} settled place it already lying (reduced motion)
     */
    release(at, outward, restY, settled = false) {
      if (used >= count) return;
      const f = state[used++];
      f.pos.copy(at);
      const lifts = random() < 0.1;
      f.vel.copy(outward).multiplyScalar(0.03 + random() * 0.05);
      f.vel.y = lifts ? 0.05 + random() * 0.06 : -0.02 - random() * 0.04;
      f.lift = lifts ? 0.25 + random() * 0.35 : 0;
      f.rot.set(random() * 6.28, random() * 6.28, random() * 6.28);
      f.spin.set((random() - 0.5) * 7, (random() - 0.5) * 5, (random() - 0.5) * 7);
      f.size = flakeSize * (0.55 + random() * 0.9);
      f.restY = restY + random() * flakeSize * 0.12;
      f.settled = settled;
      f.age = 0;
      if (settled) {
        f.pos.y = f.restY;
        f.rot.x = (random() - 0.5) * 0.4;
        f.rot.z = (random() - 0.5) * 0.4;
      }
      flakes.count = used;
    },
    /** @param {number} dt seconds */
    update(dt, time) {
      for (let i = 0; i < used; i++) {
        const f = state[i];
        f.age += dt;
        if (!f.settled) {
          // light paper: falls slowly, drifts, the odd one rides the heat first
          const gravity = f.age < f.lift ? 0.25 : -0.9;
          f.vel.y += gravity * dt;
          f.vel.y = Math.max(f.vel.y, -0.38);
          f.vel.x += Math.sin(time * 2.3 + i) * 0.05 * dt;
          f.vel.z += Math.cos(time * 1.9 + i * 1.3) * 0.05 * dt;
          f.vel.x *= 1 - 0.8 * dt;
          f.vel.z *= 1 - 0.8 * dt;
          f.pos.addScaledVector(f.vel, dt);
          f.rot.addScaledVector(f.spin, dt);
          if (f.pos.y <= f.restY && f.vel.y < 0) {
            f.pos.y = f.restY;
            f.settled = true;
            // lie down, mostly flat
            f.rot.x = (Math.random() - 0.5) * 0.5;
            f.rot.z = (Math.random() - 0.5) * 0.5;
          }
        }
        _e.set(f.rot.x, f.rot.y, f.rot.z);
        _q.setFromEuler(_e);
        _s.setScalar(f.size * opacity + 1e-5);
        _m.compose(f.pos, _q, _s);
        flakes.setMatrixAt(i, _m);
      }
      flakes.instanceMatrix.needsUpdate = true;
    },
    /** 0..1 fade for the remote ending: flakes shrink, the powder settles flat */
    setOpacity(o) {
      opacity = Math.min(Math.max(o, 0), 1);
      applyGrowth();
    },
    dispose() {
      plane.dispose();
      flakeMaterial.dispose();
      moundGeo.dispose();
      moundMaterial.dispose();
      shade.geometry.dispose();
      shadeMaterial.dispose();
      group.removeFromParent();
    },
  };
}
