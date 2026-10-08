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
 *   settleTo?: THREE.Vector3,         furnace: world point the paper's centre settles to as it ignites
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
  const frame = fixBurnFrame(mesh, burn.uniforms);
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
    order.push({ k, h: (local.dot(frame.axis) - frame.min) / Math.max(frame.max - frame.min, 1e-4) });
  }
  order.sort((a, b) => a.h - b.h);
  const scale = mesh.getWorldScale(new THREE.Vector3()).x;
  const diameter = radiusLocal * 2 * scale * 0.86;
  const height = (frame.max - frame.min) * scale;
  const worldCentre = () => mesh.localToWorld(local.copy(centreLocal));

  // furnace: the paper drops the last few centimetres onto the hearth
  let settleFrom = null;
  let settleOffset = null;
  if (options.settleTo) {
    settleFrom = mesh.position.clone();
    settleOffset = worldCentre().clone().sub(mesh.position);
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
    ash.setBed(bed, diameter * (mode === "furnace" ? 0.72 : 0.55), diameter * (mode === "furnace" ? 0.1 : 0.07));
  }
  placeBed();

  function releaseFlakes(consumedH, settled) {
    while (releasePtr < order.length && order[releasePtr].h < consumedH) {
      if (releasePtr % releaseEvery === 0 && released < flakeCount) {
        at.fromArray(frame.snapshot, order[releasePtr].k * 3);
        mesh.localToWorld(at);
        const c = worldCentre();
        outward.set(at.x - c.x, 0, at.z - c.z).normalize();
        ash.release(at, outward, surfaceY, settled);
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
        mesh.position.copy(settleFrom).lerp(local.copy(options.settleTo).sub(settleOffset), k);
      }
    } else if (time < IGNITE + FRONT) {
      const v = (time - IGNITE) / FRONT;
      // slow to take hold, steady, then quick through the last of it
      progress = lerp(-0.02, end, v * v * (0.55 + 0.45 * v) * 0.5 + v * 0.5);
      strength = Math.min(1, 0.45 + v * 2.2) * (1 - smooth(0.7, 1.0, v) * 0.55);
      collapse = smooth(0.58, 1.0, v);
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
    // the remaining paper slumps into what is below it
    if (!settleFrom || time >= IGNITE) {
      const restPosition = settleFrom ? local.copy(options.settleTo).sub(settleOffset) : original.position;
      mesh.position.set(restPosition.x, restPosition.y - collapse * height * 0.32, restPosition.z);
    }
    mesh.visible = progress < end + 0.05;

    const consumed = progress - consume;
    releaseFlakes(consumed, false);
    ash.setGrowth(smooth(-0.05, 1.05, consumed) * 0.85 + (time >= total ? 0.15 : smooth(IGNITE + FRONT, total, time) * 0.15));

    // flames rise from under the paper and lick up its sides past the
    // burning front; the tallest tongues clear what is left of the top
    const c = worldCentre();
    const frontY = surfaceY + Math.max(0, Math.min(progress, 1)) * height * (1 - 0.3 * collapse);
    const topY = surfaceY + height * (1 - 0.7 * collapse);
    base.set(c.x, surfaceY + height * 0.02, c.z);
    const reach = Math.max(frontY + diameter * 0.35, topY + diameter * 0.25 * strength) - base.y;
    flames.update(base, diameter * (1.3 - 0.35 * collapse), reach, strength, time);
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
    if (settleFrom) mesh.position.copy(options.settleTo).sub(settleOffset);
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
