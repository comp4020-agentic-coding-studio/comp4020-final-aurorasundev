// One paper burning from the bottom up, after the server has confirmed it
// is gone. The same effect plays in the furnace for the visitor who placed
// it (mode "furnace") and where the paper already lies for anyone else
// watching (mode "remote", B04). It only presents: it never changes what
// the space knows, and nothing in it is shared with other visitors.
//
// Ordinary motion (durationMs = 4800 by default):
//   0.0–0.4 s   settle onto the hearth, lower edge darkens, small flames start
//   0.4–3.8 s   the front climbs; charred paper below it shrivels and falls
//               away as flakes; the powder gathers
//   ~2.3–3.8 s  what is left loses its structure and collapses into the ash
//   3.8–4.8 s   flames die, embers and a thread of smoke, then only ash
// The furnace's ash then stays until the caller disposes the effect (the
// ritual holds it for at least three seconds); a remote burn's ash stays
// about five seconds more and fades over one, then `finished` is true.
// Reduced motion: no flames, flicker, smoke or falling; the paper chars and
// turns to ash in place over about 1.4 s.
import * as THREE from "three";
import { createAsh } from "./ash.js";
import { createBurnMaterial, fixBurnFrame } from "./burn-material.js";
import { createFlames } from "./flames.js";
import { createParticles } from "./particles.js";

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

const REMOTE_HOLD = 5;
const REMOTE_FADE = 1;

/**
 * @param {{
 *   scene: THREE.Object3D,
 *   camera: THREE.Camera,
 *   mesh: THREE.Mesh,                 the paper (its material must be a MeshStandardMaterial)
 *   textures: Awaited<ReturnType<typeof import("./assets.js").loadFireTextures>>,
 *   mode: "furnace" | "remote",
 *   seed?: number,                    any number; the same seed gives the same burn pattern
 *   durationMs?: number,              flames to last ember, default 4800
 *   reducedMotion?: boolean,
 *   surfaceY: number,                 world y of the hearth (furnace) or floor (remote) under the paper
 *   settleTo?: THREE.Vector3,         furnace: world point on the hearth the paper comes to rest on (its lowest point lands there, centred above it)
 *   furnace?: { setGlow(point: THREE.Vector3, strength: number): void },
 *   viewportHeight?: number,          CSS pixels, for ember size
 * }} options
 */
export function createBurnEffect(options) {
  const { scene, camera, mesh, textures, mode, surfaceY, furnace } = options;
  const seed = Math.abs(Math.floor(options.seed ?? Math.random() * 1e6)) || 1;
  const total = Math.max(2.5, (options.durationMs ?? 4800) / 1000);
  const reduced = !!options.reducedMotion;
  const IGNITE = 0.4;
  const EMBER = 1.0;
  const FRONT = total - IGNITE - EMBER;

  const original = { material: mesh.material, depth: mesh.customDepthMaterial, position: mesh.position.clone() };
  const burn = createBurnMaterial(/** @type {THREE.MeshStandardMaterial} */ (mesh.material), {
    charMap: textures.charred,
    seed,
  });
  // remote papers keep a wider band of charcoal before it falls away (B04)
  burn.uniforms.uConsume.value = mode === "remote" ? 0.42 : 0.34;
  const frame = fixBurnFrame(mesh, burn.uniforms);
  // the fire takes one side first, so the front leans as in B02/B04: the
  // side roughly facing the viewer, turned by up to ±45° per seed
  {
    const span = Math.max(frame.max - frame.min, 1e-4);
    const toViewer = camera.getWorldPosition(new THREE.Vector3()).sub(mesh.getWorldPosition(new THREE.Vector3()));
    const angle = Math.atan2(toViewer.z, toViewer.x) + (((seed * 0.6180339887) % 1) - 0.5) * (Math.PI / 2);
    const side = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    side.applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()).invert());
    side.addScaledVector(frame.axis, -side.dot(frame.axis)).normalize();
    burn.uniforms.uTilt.value.copy(side).multiplyScalar(0.45 / span);
  }
  mesh.material = burn.material;
  mesh.customDepthMaterial = burn.depthMaterial;

  // the paper's size and centre in the world, from the vertices it uses
  const local = new THREE.Vector3();
  const centreLocal = burn.uniforms.uCenter.value.clone();
  let radiusLocal = 0;
  const order = [];
  for (let k = 0; k < frame.used.length; k++) {
    if (!frame.used[k]) continue;
    local.fromArray(frame.snapshot, k * 3);
    radiusLocal = Math.max(radiusLocal, local.distanceTo(centreLocal));
    const tilt = local.clone().sub(centreLocal).dot(burn.uniforms.uTilt.value);
    order.push({ k, h: (local.dot(frame.axis) - frame.min) / Math.max(frame.max - frame.min, 1e-4) - tilt });
  }
  order.sort((a, b) => a.h - b.h);
  const scale = mesh.getWorldScale(new THREE.Vector3()).x;
  const diameter = radiusLocal * 2 * scale * 0.86;
  const height = (frame.max - frame.min) * scale;
  const worldCentre = () => mesh.localToWorld(local.copy(centreLocal));

  // furnace: the paper drops the last few centimetres onto the hearth, its
  // lowest point landing on the surface
  let settleFrom = null;
  let restPosition = original.position.clone();
  if (options.settleTo) {
    settleFrom = mesh.position.clone();
    let lowest = Infinity;
    for (let k = 0; k < frame.used.length; k++) {
      if (!frame.used[k]) continue;
      lowest = Math.min(lowest, mesh.localToWorld(local.fromArray(frame.snapshot, k * 3)).y);
    }
    const c = worldCentre();
    restPosition = new THREE.Vector3(
      mesh.position.x + options.settleTo.x - c.x,
      mesh.position.y + options.settleTo.y - lowest,
      mesh.position.z + options.settleTo.z - c.z,
    );
  }

  const flames = createFlames(camera, { seed });
  const particles = createParticles(textures, { seed, size: diameter });
  const flakeCount = mode === "furnace" ? 70 : 42;
  const ash = createAsh(textures, { count: flakeCount, seed, flakeSize: diameter * 0.085 });
  const bed = new THREE.Vector3();
  scene.add(flames.mesh, particles.group, ash.group);
  if (options.viewportHeight && camera.isPerspectiveCamera) {
    particles.setPixelScale(options.viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
  }

  const releaseEvery = Math.max(1, Math.floor(order.length / flakeCount));
  let releasePtr = 0;
  let released = 0;

  let time = 0;
  let disposed = false;
  let finished = false;
  let phase = "igniting";
  const base = new THREE.Vector3();
  const source = new THREE.Vector3();
  const at = new THREE.Vector3();
  const outward = new THREE.Vector3();

  function placeBed() {
    const c = worldCentre();
    bed.set(c.x, surfaceY, c.z);
    ash.setBed(bed, diameter * (mode === "furnace" ? 0.72 : 0.42), diameter * (mode === "furnace" ? 0.1 : 0.05));
  }
  placeBed();

  function releaseFlakes(consumedH, settled) {
    while (releasePtr < order.length && order[releasePtr].h < consumedH) {
      if (releasePtr % releaseEvery === 0 && released < flakeCount) {
        at.fromArray(frame.snapshot, order[releasePtr].k * 3);
        mesh.localToWorld(at);
        const c = worldCentre();
        outward.set(at.x - c.x, 0, at.z - c.z).normalize();
        // on the open floor the flakes skitter further than in the furnace
        ash.release(at, outward.multiplyScalar(mode === "furnace" ? 1 : 2.2), surfaceY, settled);
        released++;
      }
      releasePtr++;
    }
  }

  function stepNormal(dt) {
    const u = burn.uniforms;
    const consume = u.uConsume.value;
    const end = 1 + consume + 0.12;
    let progress;
    let strength;
    let collapse = 0;
    let glow = 1;
    let smoke;
    if (time < IGNITE) {
      const e = time / IGNITE;
      progress = lerp(-0.2, -0.02, e);
      strength = 0.45 * e;
      smoke = 0.2 * e;
      phase = "igniting";
      if (settleFrom) {
        const k = 1 - (1 - e) * (1 - e);
        mesh.position.copy(settleFrom).lerp(restPosition, k);
      }
    } else if (time < IGNITE + FRONT) {
      const v = (time - IGNITE) / FRONT;
      // slow to take hold, steady, then quick through the last of it
      progress = lerp(-0.02, end, Math.pow(v, 0.92));
      // biggest while there is most paper to burn, then shrinking with it
      strength = Math.min(1, 0.45 + v * 2.2) * (1 - smooth(0.45, 0.95, v) * 0.75);
      collapse = smooth(0.68, 1.0, v);
      smoke = 0.25 + 0.75 * Math.min(1, v * 2);
      phase = "burning";
    } else if (time < total) {
      const v = (time - IGNITE - FRONT) / EMBER;
      progress = end + v * 0.2;
      strength = 0.45 * (1 - smooth(0.0, 0.7, v));
      collapse = 1;
      glow = 1 - v;
      smoke = 0.9 * (1 - v);
      phase = "embers";
    } else {
      progress = end + 0.2;
      strength = 0;
      collapse = 1;
      glow = 0;
      smoke = Math.max(0, 0.3 - (time - total) * 0.3);
      if (phase !== "ashes" && phase !== "fading" && phase !== "gone") phase = "ashes";
    }
    u.uProgress.value = progress;
    u.uCollapse.value = collapse;
    u.uGlow.value = glow;
    u.uTime.value = time;
    // what is left rests on the surface as its underside burns away, then
    // slumps into the ash
    const consumed = progress - consume;
    const sink = Math.min(Math.max(consumed, 0), 1) * 0.9 + collapse * 0.08;
    if (!settleFrom || time >= IGNITE) {
      mesh.position.set(restPosition.x, restPosition.y - sink * height, restPosition.z);
    }
    mesh.visible = progress < end + 0.05;

    releaseFlakes(consumed, false);
    ash.setGrowth(smooth(-0.05, 1.05, consumed) * 0.85 + (time >= total ? 0.15 : smooth(IGNITE + FRONT, total, time) * 0.15));

    // tongues stand around the burning front, lean in over the paper and
    // the tallest licks clear its top; they draw in as what is left shrinks
    const c = worldCentre();
    const frontY = surfaceY + Math.max(0, Math.min(progress, 1) - sink) * height;
    base.set(c.x, surfaceY, c.z);
    // in the furnace the fire licks along the char (B02); on the open floor
    // one tall tongue climbs well clear of the paper (B04)
    const flameBox = height * (mode === "furnace" ? 1.75 : 2.4);
    const front = Math.min(0.6, (frontY - surfaceY) / flameBox);
    // the tongues stand on the burning edge: a crumpled ball is narrow at its
    // foot and widest at its middle, then everything draws in as it slumps
    const p = Math.min(Math.max(progress, 0), 1);
    const across = Math.sqrt(Math.max(0.15, 1 - (2 * p - 1) * (2 * p - 1)));
    const ring = (across * (1 - 0.35 * collapse)) / 1.5;
    flames.update(base, diameter * 1.5, flameBox, strength * (0.4 + 0.6 * (1 - Math.min(Math.max(consumed, 0), 1))), time, front, ring);
    const reach = flameBox;
    source.set(c.x, frontY, c.z);
    particles.update(dt, {
      source,
      top: base.y + reach,
      fire: strength,
      smoke,
      surfaceY,
    });
    if (furnace) furnace.setGlow(source, strength * 0.9 + glow * 0.15);
  }

  function stepReduced(dt) {
    const u = burn.uniforms;
    const consume = u.uConsume.value;
    const end = 1 + consume + 0.12;
    u.uTime.value = 0;
    u.uGlow.value = 0;
    if (settleFrom) mesh.position.copy(restPosition);
    // chars from the bottom up, then falls to ash
    const progress = time < 0.6 ? lerp(-0.2, 1.0, time / 0.6) : lerp(1.0, end + 0.2, Math.min(1, (time - 0.6) / 0.8));
    u.uConsume.value = time < 0.6 ? 0.9 : consume;
    u.uProgress.value = progress;
    mesh.visible = time < 1.4;
    releaseFlakes(time < 0.6 ? -1 : progress - consume, true);
    ash.setGrowth(smooth(0.6, 1.4, time));
    flames.update(base.copy(worldCentre()), diameter, diameter, 0, 0);
    particles.update(dt, { source: base, top: base.y, fire: 0, smoke: 0, surfaceY });
    phase = time < 1.4 ? "burning" : phase === "burning" || phase === "igniting" ? "ashes" : phase;
    if (time >= 1.4) u.uConsume.value = consume;
  }

  const reducedTotal = 1.4;
  const doneAt = reduced ? reducedTotal : total;

  return {
    /** "igniting" | "burning" | "embers" | "ashes" | "fading" | "gone" */
    get phase() {
      return phase;
    },
    /** the flames are out and only ash is left */
    get done() {
      return time >= doneAt;
    },
    /** remote only: the ash has faded too; the caller can dispose */
    get finished() {
      return finished;
    },
    get elapsed() {
      return time;
    },
    /** @param {number} dt seconds since the last frame (clamp it on the caller's side after a tab switch) */
    update(dt) {
      if (disposed) return;
      time += dt;
      if (reduced) stepReduced(dt);
      else stepNormal(dt);
      ash.update(reduced ? 0 : dt, time);
      if (mode === "remote" && time > doneAt) {
        const after = time - doneAt;
        if (after > REMOTE_HOLD) {
          phase = after > REMOTE_HOLD + REMOTE_FADE ? "gone" : "fading";
          ash.setOpacity(1 - (after - REMOTE_HOLD) / REMOTE_FADE);
          if (after > REMOTE_HOLD + REMOTE_FADE) finished = true;
        }
      }
    },
    /** Removes everything the effect added and gives the paper back its material. */
    dispose() {
      if (disposed) return;
      disposed = true;
      flames.dispose();
      particles.dispose();
      ash.dispose();
      mesh.material = original.material;
      mesh.customDepthMaterial = original.depth;
      mesh.geometry.deleteAttribute("aBurnPos");
      burn.dispose();
      if (furnace) furnace.setGlow(source, 0);
    },
  };
}
