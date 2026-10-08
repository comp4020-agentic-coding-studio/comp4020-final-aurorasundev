// What a burning paper leaves: thin charred flakes that break off as the
// front passes and fall (a few lift on the heat first), and a shallow mound
// of powder that grows under the paper. Flakes are one InstancedMesh using a
// 4×4 atlas of generated flake photographs; the mound is a low displaced
// disc using a generated ash-bed photograph, with a few embers that die in
// it slowly after the flames. No physics bodies.
import * as THREE from "three";

const ATLAS_CELLS = 4;
const EMBERS = 14;
// flakes are mostly charcoal, some mid grey, a few pale paper ash that kept its shape
const FLAKE_TONES = [
  [0.55, new THREE.Color("#4a4542")],
  [0.85, new THREE.Color("#8e8a85")],
  [1.0, new THREE.Color("#cbc6be")],
];
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
    color: new THREE.Color("#ffffff"),
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
  for (let i = 0; i < count; i++) {
    const r = random();
    flakes.setColorAt(i, FLAKE_TONES.find(([p]) => r <= p)[1]);
  }
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
    color: new THREE.Color("#ffffff"),
    roughness: 1,
    metalness: 0,
    // blended, so the powder's edge thins out instead of ending in a cut line
    transparent: true,
    alphaTest: 0.03,
    envMapIntensity: 0.15,
  });
  moundMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, moundUniforms);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uSeed;");
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
    // the photograph's black flakes against white ash are too harsh under the
    // room's light: compress them towards a soft grey
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      {
        // loose powder, not a disc: the edge breaks up along the photograph's
        // own flakes and a few lobes
        vec2 c = vMapUv - 0.5;
        float lobes = sin(atan(c.y, c.x) * 5.0 + uSeed) * 0.07 + sin(atan(c.y, c.x) * 11.0 - uSeed * 1.3) * 0.04;
        float edge = length(c) * 2.0 + lobes + (0.5 - diffuseColor.g) * 0.5;
        diffuseColor.a *= smoothstep(1.0, 0.62, edge);
      }
      diffuseColor.rgb = diffuseColor.rgb * 0.55 + vec3(0.07, 0.066, 0.062);
      // drifts of paler powder between the flakes, so it is not one grey
      float drift = sin(vMapUv.x * 17.0 + uSeed) * sin(vMapUv.y * 13.0 - uSeed * 0.7) * 0.5 + 0.5;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.58, 0.55), drift * drift * 0.35);`,
    );
  };
  moundMaterial.customProgramCacheKey = () => "throwaway-ash-mound-v4";
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

  // ---- embers lingering in the ash: dull points, each going out at its own time
  const emberPos = new Float32Array(EMBERS * 3);
  const emberGlow = new Float32Array(EMBERS);
  const emberSpots = Array.from({ length: EMBERS }, () => ({
    a: random() * Math.PI * 2,
    r: Math.sqrt(random()) * 0.6,
    out: 0.15 + random() * 0.85,
    phase: random() * 50,
    size: 0.6 + random() * 0.8,
  }));
  const emberSize = new Float32Array(emberSpots.map((e) => e.size));
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3).setUsage(THREE.DynamicDrawUsage));
  emberGeo.setAttribute("aGlow", new THREE.BufferAttribute(emberGlow, 1).setUsage(THREE.DynamicDrawUsage));
  emberGeo.setAttribute("aSize", new THREE.BufferAttribute(emberSize, 1));
  const emberMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uPx: { value: 7 } },
    vertexShader: /* glsl */ `
      attribute float aGlow;
      attribute float aSize;
      uniform float uPx;
      varying float vGlow;
      void main() {
        vGlow = aGlow;
        gl_PointSize = uPx * aSize * (0.5 + 0.5 * aGlow);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d) * vGlow;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(vec3(0.9, 0.16, 0.03), vec3(1.0, 0.5, 0.14), vGlow) * a * 1.4, a);
      }`,
  });
  const emberPoints = new THREE.Points(emberGeo, emberMaterial);
  emberPoints.frustumCulled = false;
  emberPoints.renderOrder = 3;
  emberPoints.visible = false;
  group.add(emberPoints);
  let emberLevel = 0;

  let moundRadius = flakeSize * 3;
  // how far the powder's surface stands above the bed at a world point (without the lumps)
  const moundRise = (x, z) => {
    const r = Math.hypot(x - mound.position.x, z - mound.position.z) / Math.max(mound.scale.x, 1e-4);
    return Math.pow(Math.max(1 - r * r, 0), 1.6) * moundUniforms.uHeight.value * moundUniforms.uGrow.value;
  };
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
          if (f.pos.y <= f.restY + moundRise(f.pos.x, f.pos.z) && f.vel.y < 0) {
            f.settled = true;
            // lie down, mostly flat
            f.rot.x = (random() - 0.5) * 0.5;
            f.rot.z = (random() - 0.5) * 0.5;
          }
        }
        // lying flakes ride up as the powder gathers under them
        if (f.settled) f.pos.y = f.restY + moundRise(f.pos.x, f.pos.z);
        _e.set(f.rot.x, f.rot.y, f.rot.z);
        _q.setFromEuler(_e);
        _s.setScalar(f.size * opacity + 1e-5);
        _m.compose(f.pos, _q, _s);
        flakes.setMatrixAt(i, _m);
      }
      flakes.instanceMatrix.needsUpdate = true;

      emberPoints.visible = emberLevel * opacity > 0.01;
      if (emberPoints.visible) {
        const spread = mound.scale.x;
        for (let i = 0; i < EMBERS; i++) {
          const e = emberSpots[i];
          const x = mound.position.x + Math.cos(e.a) * e.r * spread;
          const z = mound.position.z + Math.sin(e.a) * e.r * spread;
          emberPos[i * 3] = x;
          emberPos[i * 3 + 1] = mound.position.y + moundRise(x, z) + flakeSize * 0.15;
          emberPos[i * 3 + 2] = z;
          // each goes out once the level falls below its own threshold
          const alive = Math.min(1, Math.max(0, (emberLevel - (1 - e.out)) / 0.25));
          const breathe = 0.6 + 0.25 * Math.sin(time * 2.1 + e.phase) + 0.15 * Math.sin(time * 5.3 + e.phase * 1.7);
          emberGlow[i] = alive * breathe * opacity;
        }
        emberGeo.attributes.position.needsUpdate = true;
        emberGeo.attributes.aGlow.needsUpdate = true;
      }
    },
    /** 0..1 how many embers still glow in the ash */
    setEmbers(level) {
      emberLevel = Math.min(Math.max(level, 0), 1);
    },
    /** device pixels for a full ember point */
    setEmberPixels(px) {
      emberMaterial.uniforms.uPx.value = px;
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
      emberGeo.dispose();
      emberMaterial.dispose();
      group.removeFromParent();
    },
  };
}
