// Adapted from paper-crumple-demo's src/main-vat.js by nagasawa (ITEM Inc.),
// MIT licence (see ./LICENSE and THIRD_PARTY_NOTICES.md), commit f84648b0.
//
// Kept: the camera rig, lights, SSAO, cannon-es sphere bodies, the grab/throw
// spring, the open pose and the discard (crumple back into the stage) motion,
// the rolling/settling logic and stage bounds, all with the demo's constants.
// Changed: everything that ran at module top level now lives inside
// createPaperScene() and is torn down by dispose(); papers are keyed by real
// paper ids instead of a count of 40 fictional designs; a click asks the app
// to open a paper instead of opening it directly; the red wall, GUI, URL
// debug flags and #info element are gone; colours match Throwaway's palette;
// pixel ratio, SSAO and shadow size are reduced on phones.
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createPaper, updatePaperFrame } from "./paper.js";
import { loadVATData } from "./paper-vat.js";

const BACKGROUND = "#e7e4de";
const WALL_COLOR = "#ddd6c7";
const FLOOR_COLOR = "#d3cdbc";
const PAPER_COLOR = "#ece6da";

const FLOOR_VISUAL_Y = -0.1;
const WALL_Z = -1.1;

const OPEN_DISTANCE = 1.5;
const CLOSED_SCALE = 0.82;
const OPEN_DURATION = 1.15;
const DISCARD_DURATION = 1.25;
const ROLL_LINEAR_RESISTANCE = 2.6;
const ROLL_ANGULAR_RESISTANCE = 4.5;
const ROLL_SETTLE_SPEED = 0.018;
const PHYSICS_STEP = 1 / 60;
const PAPER_MASS = 0.16;
const GRAB_LIFT = 0.5;
const GRAB_STIFFNESS = 14;
const GRAB_MAX_SPEED = 4.5;
const THROW_MAX_SPEED = 3.2;
const CLICK_DRAG_THRESHOLD_PX = 6;
const BOUNDS_PULL = 3.0;
const ANIM_SPEED = 1.5;
// Fully flat when open, so the HTML words sit on a flat sheet.
const OPEN_FRAME = 0;

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const lerp = (a, b, t) => a + (b - a) * t;
const clampAbs = (v, limit) => Math.min(Math.max(v, -limit), limit);
const randomRange = (min, max) => min + Math.random() * (max - min);

/**
 * @param {HTMLElement} container  the scene fills it; the canvas is appended
 * @param {HTMLElement} buttonLayer  one focusable "Open paper" button per paper is placed here
 * @param {{
 *   vatBase: string,
 *   compact: boolean,
 *   onPaperOpen: (id: string) => void,
 *   onReady: () => void,
 *   onError: (err: Error) => void,
 * }} options
 */
export function createPaperScene(container, buttonLayer, options) {
  const { compact } = options;
  let disposed = false;
  const timeouts = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timeouts.delete(t);
      if (!disposed) fn();
    }, ms);
    timeouts.add(t);
  };

  const size = () => ({
    w: Math.max(1, container.clientWidth),
    h: Math.max(1, container.clientHeight),
  });

  // ==================================================
  // Basic scene setup
  // ==================================================
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  let stageBounds = { minX: -2.4, maxX: 2.4, minZ: WALL_Z, maxZ: 1.7 };

  // The demo framed a wide, distant 16:9 stage; the references are a much
  // closer "hero shot" where each paper fills a good fraction of the frame.
  // A portrait phone looks down more steeply and gets a narrower, deeper
  // stage so papers stay clear of the controls.
  function applyCamera() {
    const { w, h } = size();
    camera.aspect = w / h;
    if (camera.aspect < 0.8) {
      camera.fov = 46;
      camera.position.set(0, 2.55, 1.85);
      camera.lookAt(0, 0.15, 0.1);
      const halfW = Math.min(0.92, 1.45 * camera.aspect);
      stageBounds = { minX: -halfW, maxX: halfW, minZ: -0.95, maxZ: 0.95 };
    } else {
      camera.fov = 38;
      camera.position.set(0, 1.6, 2.5);
      camera.lookAt(0, 0.2, -0.15);
      const halfW = Math.min(1.5, 0.76 * camera.aspect);
      stageBounds = { minX: -halfW, maxX: halfW, minZ: -0.95, maxZ: 0.7 };
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    measureStageEdges();
  }

  // How far left/right a paper can sit at a given depth and still be in
  // view: wide at the back, narrower near the camera. Spawning, physics and
  // dragging all use it, so papers spread across the frame (D01) without
  // rolling off its near edge.
  let edgeFar = 1;
  let edgeNear = 1;
  function measureStageEdges() {
    const v = new THREE.Vector3();
    const halfAt = (z) => {
      v.set(1, 0, z).project(camera);
      return 0.86 / Math.abs(v.x);
    };
    edgeFar = halfAt(stageBounds.minZ);
    edgeNear = halfAt(stageBounds.maxZ);
  }
  const halfWidthAt = (z) =>
    lerp(edgeFar, edgeNear, clamp01((z - stageBounds.minZ) / (stageBounds.maxZ - stageBounds.minZ)));
  applyCamera();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.25 : 1.5));
  renderer.setSize(size().w, size().h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // ACES rolls off the directional light's highlights instead of clipping
  // them, which is what keeps the references' paper looking bright but
  // never flat white.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "paper-canvas";
  container.appendChild(renderer.domElement);

  // A procedural (no asset, no network) studio environment: soft, varied
  // window-lit walls that give the paper the subtle sheen and ambient
  // occlusion the references show in their crumple folds, without the flat
  // single-colour look a bare directional light produces on its own.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  // A lit floor plus a flat, unlit wall behind it give the room the two-plane
  // depth the references' "studio corner" shot has (wall and floor as two
  // distinct values meeting at a horizon), instead of papers sitting on an
  // undifferentiated flat background colour.
  const floorGeometry = new THREE.PlaneGeometry(16, 12);
  // The environment map lights the floor the same everywhere, shadow or not
  // (it isn't blocked by the shadow map), so it's turned down hard here —
  // otherwise it alone keeps the contact shadows from ever reading as dark
  // as the references', no matter how the direct lights are balanced.
  const floorMat = new THREE.MeshStandardMaterial({
    color: FLOOR_COLOR,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.3,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_VISUAL_Y, 1);
  floor.receiveShadow = true;
  scene.add(floor);

  // The references' ground fades into the background with no hard seam. Fog
  // does that here. three.js fogs by depth along the camera's view direction,
  // so both ends are measured that way: it starts halfway back across the
  // stage and is complete where the floor meets the wall, so the back half
  // of the floor drifts into the wall's colour while the front stays as lit.
  // Papers ignore it. (A band only past the last paper was too narrow to
  // read as anything but a line; a fog set by eye washed out the floor.)
  const viewDepth = (point) => {
    const forward = camera.getWorldDirection(new THREE.Vector3());
    return point.clone().sub(camera.position).dot(forward);
  };
  function measureFog() {
    const seam = viewDepth(new THREE.Vector3(0, FLOOR_VISUAL_Y, WALL_Z));
    const midStage = (stageBounds.minZ + stageBounds.maxZ) / 2;
    scene.fog.near = viewDepth(new THREE.Vector3(0, FLOOR_VISUAL_Y, midStage));
    scene.fog.far = seam;
  }
  scene.fog = new THREE.Fog(new THREE.Color(WALL_COLOR), 4, 5);
  measureFog();

  const wallHeight = 12;
  const wallGeometry = new THREE.PlaneGeometry(24, wallHeight);
  const wallMat = new THREE.MeshBasicMaterial({ color: WALL_COLOR });
  const wall = new THREE.Mesh(wallGeometry, wallMat);
  wall.position.set(0, FLOOR_VISUAL_Y + wallHeight / 2, WALL_Z);
  scene.add(wall);

  // Lights
  // plan.md's D01 target is soft broad light and restrained contact shadows
  // with visible but gentle shade in the folds. The hemisphere and fill reach
  // shadowed ground too (no light here is blocked except the key), so they
  // set how light the shadows stay; the key stays soft-edged and moderate.
  // Broad soft light from above, warm from the ground: D01's papers are lit
  // all round, with gentle shade in the folds rather than black creases.
  const ambient = new THREE.HemisphereLight(0xfffaf2, 0xd8cfbf, 0.75);
  scene.add(ambient);

  // A gentle fill preserves detail on the shaded faces of matte paper.
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
  fillLight.position.set(0.4, 2.2, 4.2);
  scene.add(fillLight);

  const dirLight = new THREE.DirectionalLight(0xfff6ea, 1.75);
  dirLight.position.set(-2.2, 3.1, 1.8);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048);
  dirLight.shadow.camera.left = -4;
  dirLight.shadow.camera.right = 4;
  dirLight.shadow.camera.top = 4;
  dirLight.shadow.camera.bottom = -3;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 12;
  dirLight.shadow.bias = -0.001;
  dirLight.shadow.radius = 3;
  scene.add(dirLight);

  // Post-processing — SSAO darkens the creases and folds (desktop only)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ssaoPass = new SSAOPass(scene, camera, size().w, size().h);
  ssaoPass.kernelRadius = 0.025;
  ssaoPass.minDistance = 0.0003;
  ssaoPass.maxDistance = 0.12;
  ssaoPass.enabled = !compact;
  composer.addPass(ssaoPass);
  composer.addPass(new OutputPass());

  // One shared, unprinted surface: fine grain and short fibres, never text.
  const paperCanvas = document.createElement("canvas");
  paperCanvas.width = paperCanvas.height = 512;
  const paperContext = paperCanvas.getContext("2d");
  const grain = paperContext.createImageData(512, 512);
  for (let i = 0; i < grain.data.length; i += 4) {
    const shade = 244 + Math.random() * 10 - 5;
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = shade;
    grain.data[i + 3] = 255;
  }
  paperContext.putImageData(grain, 0, 0);
  paperContext.lineWidth = 0.6;
  paperContext.strokeStyle = "rgba(130, 122, 108, 0.09)";
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const angle = Math.random() * Math.PI * 2;
    const length = 2 + Math.random() * 7;
    paperContext.beginPath();
    paperContext.moveTo(x, y);
    paperContext.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    paperContext.stroke();
  }
  const paperTexture = new THREE.CanvasTexture(paperCanvas);
  paperTexture.colorSpace = THREE.SRGBColorSpace;
  paperTexture.wrapS = paperTexture.wrapT = THREE.RepeatWrapping;
  paperTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const paperBump = paperTexture.clone();
  paperBump.colorSpace = THREE.NoColorSpace;
  const paperMaterial3d = new THREE.MeshStandardMaterial({
    color: PAPER_COLOR,
    map: paperTexture,
    bumpMap: paperBump,
    bumpScale: 0.012,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.16,
    side: THREE.DoubleSide,
  });
  // the horizon fog is for the far floor and the wall, never the papers
  paperMaterial3d.fog = false;

  // ==================================================
  // State
  // ==================================================
  /** @type {Map<string, any>} */
  const papers = new Map();
  let animData = null;
  let activePaper = null;
  let wantedIds = [];
  const flatSize = { width: 1, depth: 1.4 };
  // The flat sheet measured from the vertices its triangles use: the FBX also
  // carries dummy bounding-box vertices that would inflate geometry bounds.
  const flatBox = new THREE.Box3();

  let collisionRadius = 0.25;
  let restCenterY = FLOOR_VISUAL_Y + 0.25;
  let restMeshY = 0.02;
  const crumpleCenter = new THREE.Vector3(0, 0.2, 0);

  // ==================================================
  // Simplified physics — only crumpled paper is treated as a rigid sphere
  // ==================================================
  const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -7.0, 0) });
  physicsWorld.allowSleep = false;
  physicsWorld.defaultContactMaterial.friction = 0.8;
  physicsWorld.defaultContactMaterial.restitution = 0.15;

  const paperPhysicsMaterial = new CANNON.Material("paper");
  const floorPhysicsMaterial = new CANNON.Material("floor");
  physicsWorld.addContactMaterial(
    new CANNON.ContactMaterial(paperPhysicsMaterial, floorPhysicsMaterial, { friction: 1.0, restitution: 0.12 }),
  );
  physicsWorld.addContactMaterial(
    new CANNON.ContactMaterial(paperPhysicsMaterial, paperPhysicsMaterial, { friction: 0.6, restitution: 0.3 }),
  );

  const floorBody = new CANNON.Body({
    mass: 0,
    material: floorPhysicsMaterial,
    shape: new CANNON.Plane(),
    position: new CANNON.Vec3(0, FLOOR_VISUAL_Y, 0),
    quaternion: new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0),
  });
  physicsWorld.addBody(floorBody);

  const _crumpleOffset = new THREE.Vector3();
  function crumpleWorldOffset(scale, quaternion) {
    return _crumpleOffset.copy(crumpleCenter).multiplyScalar(scale).applyQuaternion(quaternion);
  }

  function createPaperBody(paper) {
    const off = crumpleWorldOffset(CLOSED_SCALE, paper.mesh.quaternion);
    const body = new CANNON.Body({
      mass: PAPER_MASS,
      material: paperPhysicsMaterial,
      shape: new CANNON.Sphere(collisionRadius),
      linearDamping: 0.15,
      angularDamping: 0.35,
      position: new CANNON.Vec3(
        paper.mesh.position.x + off.x,
        paper.mesh.position.y + off.y,
        paper.mesh.position.z + off.z,
      ),
    });
    body.quaternion.set(paper.mesh.quaternion.x, paper.mesh.quaternion.y, paper.mesh.quaternion.z, paper.mesh.quaternion.w);
    physicsWorld.addBody(body);
    return body;
  }

  function setPaperBodyDynamic(paper, enabled) {
    const body = paper.body;
    body.type = enabled ? CANNON.Body.DYNAMIC : CANNON.Body.KINEMATIC;
    body.mass = enabled ? PAPER_MASS : 0;
    body.collisionFilterGroup = enabled ? 1 : 0;
    body.collisionFilterMask = enabled ? 1 : 0;
    if (!enabled) {
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.force.set(0, 0, 0);
      body.torque.set(0, 0, 0);
    }
    body.updateMassProperties();
    body.wakeUp();
  }

  function syncBodyToMesh(paper) {
    const off = crumpleWorldOffset(paper.mesh.scale.x, paper.mesh.quaternion);
    paper.body.position.set(paper.mesh.position.x + off.x, paper.mesh.position.y + off.y, paper.mesh.position.z + off.z);
    paper.body.quaternion.set(paper.mesh.quaternion.x, paper.mesh.quaternion.y, paper.mesh.quaternion.z, paper.mesh.quaternion.w);
  }

  function syncMeshToBody(paper, scale = CLOSED_SCALE) {
    paper.mesh.quaternion.set(paper.body.quaternion.x, paper.body.quaternion.y, paper.body.quaternion.z, paper.body.quaternion.w);
    const off = crumpleWorldOffset(scale, paper.mesh.quaternion);
    paper.mesh.position.set(paper.body.position.x - off.x, paper.body.position.y - off.y, paper.body.position.z - off.z);
    paper.mesh.scale.setScalar(scale);
  }

  const isOnGround = (body) => body.position.y <= restCenterY + 0.05;

  function applyRollingResistance(body, dt) {
    const linearDecay = Math.exp(-ROLL_LINEAR_RESISTANCE * dt);
    const angularDecay = Math.exp(-ROLL_ANGULAR_RESISTANCE * dt);
    body.velocity.x *= linearDecay;
    body.velocity.z *= linearDecay;
    body.angularVelocity.x *= angularDecay;
    body.angularVelocity.y *= angularDecay;
    body.angularVelocity.z *= angularDecay;
  }

  function finishRollingPaper(paper, maxFrame) {
    paper.state = "closed";
    paper.time = 0;
    paper.frameIdx = maxFrame;
    updatePaperFrame(paper, animData, paper.frameIdx);
    syncBodyToMesh(paper);
    syncMeshToBody(paper);
  }

  function applyPhysicsBounds(dt) {
    const minZ = stageBounds.minZ + collisionRadius;
    const maxZ = stageBounds.maxZ - collisionRadius;

    for (const paper of livePapers()) {
      if (paper.body.type !== CANNON.Body.DYNAMIC) continue;
      const body = paper.body;
      const maxX = halfWidthAt(body.position.z) - collisionRadius;
      const minX = -maxX;
      if (body.position.x < minX) {
        if (body.velocity.x < 0) body.velocity.x = Math.abs(body.velocity.x) * 0.42;
        body.velocity.x += BOUNDS_PULL * dt;
      } else if (body.position.x > maxX) {
        if (body.velocity.x > 0) body.velocity.x = -Math.abs(body.velocity.x) * 0.42;
        body.velocity.x -= BOUNDS_PULL * dt;
      }
      if (body.position.z < minZ) {
        if (body.velocity.z < 0) body.velocity.z = Math.abs(body.velocity.z) * 0.42;
        body.velocity.z += BOUNDS_PULL * dt;
      } else if (body.position.z > maxZ) {
        if (body.velocity.z > 0) body.velocity.z = -Math.abs(body.velocity.z) * 0.42;
        body.velocity.z -= BOUNDS_PULL * dt;
      }
    }
  }

  function captureTransform(paper) {
    return {
      position: paper.mesh.position.clone(),
      quaternion: paper.mesh.quaternion.clone(),
      scale: paper.mesh.scale.x,
      frameIdx: paper.frameIdx,
    };
  }

  const _viewDir = new THREE.Vector3();
  function computeOpenPose() {
    camera.getWorldDirection(_viewDir);
    const position = camera.position.clone().addScaledVector(_viewDir, OPEN_DISTANCE);
    const yAxis = _viewDir.clone().negate();
    const zAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));

    // Leave room for the header above the sheet and fit the width on phones.
    const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * OPEN_DISTANCE;
    const viewW = viewH * camera.aspect;
    const scale = Math.min((viewH * 0.8) / flatSize.depth, (viewW * 0.9) / flatSize.width);
    return { position, quaternion, scale };
  }

  // ==================================================
  // Creating and removing paper
  // ==================================================
  function randomSpawnPosition() {
    // Takes the first spot clear of every paper; on a stage too small for
    // that (a phone), the roomiest spot tried rather than the last one.
    const margin = collisionRadius * 1.3;
    const wanted = (collisionRadius * 4.2) ** 2;
    const pos = new THREE.Vector3(0, restMeshY, 0);
    const best = pos.clone();
    let bestRoom = -1;
    for (let attempt = 0; attempt < 80; attempt++) {
      pos.z = randomRange(stageBounds.minZ + margin, stageBounds.maxZ - margin);
      const half = halfWidthAt(pos.z) - margin;
      pos.x = randomRange(-half, half);
      let room = Infinity;
      for (const p of livePapers()) {
        const dx = p.body.position.x - pos.x;
        const dz = p.body.position.z - pos.z;
        room = Math.min(room, dx * dx + dz * dz);
      }
      if (room > bestRoom) {
        bestRoom = room;
        best.copy(pos);
      }
      if (room > wanted) break;
    }
    return best;
  }

  // Papers arriving from the stream (someone else's throw, the first
  // snapshot, a refill) drop from inside the upper part of the frame, a
  // quarter of the way down, so they're seen at once and land within about
  // half a second. The demo's fixed drop height started them above the top
  // edge on desktop, where they fell unseen for most of a second.
  const ARRIVAL_SCREEN_Y = 0.5; // NDC; 1 is the top edge
  const ARRIVAL_DROP = { min: 0.25, max: 0.9 };
  function arrivalDropHeight(position) {
    const v = new THREE.Vector3();
    const screenY = (lift) => v.set(position.x, position.y + lift, position.z).project(camera).y;
    if (screenY(ARRIVAL_DROP.max) <= ARRIVAL_SCREEN_Y) return ARRIVAL_DROP.max;
    let low = 0;
    let high = ARRIVAL_DROP.max;
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) / 2;
      if (screenY(mid) > ARRIVAL_SCREEN_Y) high = mid;
      else low = mid;
    }
    return Math.max(low, ARRIVAL_DROP.min);
  }

  function spawnPaper(id, position, dropIn, dropHeight = randomRange(0.8, 1.2)) {
    const maxFrame = animData.frameCount - 1;
    const base = createPaper(animData, paperMaterial3d);
    base.mesh.castShadow = true;
    base.mesh.rotation.set(0, Math.PI + randomRange(-0.6, 0.6), randomRange(-0.18, 0.18));
    base.mesh.position.copy(position);
    base.mesh.scale.setScalar(CLOSED_SCALE);
    scene.add(base.mesh);
    const body = createPaperBody(base);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "paper-hit";
    button.setAttribute("aria-label", "Open paper");
    button.addEventListener("click", () => options.onPaperOpen(id));
    buttonLayer.appendChild(button);

    const paper = {
      ...base,
      id,
      body,
      button,
      frameIdx: maxFrame,
      state: "closed",
      time: 0,
      start: null,
      target: null,
      throw: null,
      onUnfolded: null,
    };
    updatePaperFrame(paper, animData, maxFrame);
    papers.set(id, paper);

    if (dropIn) {
      paper.state = "rolling";
      paper.throw = { settleTimer: 0 };
      body.position.y += dropHeight;
      // a little tumble, not enough to send it rolling on after it lands
      body.angularVelocity.set(randomRange(-0.7, 0.7), randomRange(-0.4, 0.4), randomRange(-0.7, 0.7));
      syncMeshToBody(paper);
    }
    return paper;
  }

  function removePaper(paper) {
    if (paper === activePaper) activePaper = null;
    if (pointerState && pointerState.paper === paper) pointerState.paper = null;
    scene.remove(paper.mesh);
    paper.mesh.geometry.dispose();
    paper.ownMaterial?.dispose();
    if (!paper.bodyRemoved) physicsWorld.removeBody(paper.body);
    paper.button.remove();
    papers.delete(paper.id);
  }

  function syncPapers() {
    if (!animData) return;
    const wanted = new Set(wantedIds);
    for (const [id, paper] of [...papers.entries()]) {
      if (wanted.has(id) || paper === activePaper) continue;
      // null marks a paper still waiting for its staggered drop-in
      if (!paper) papers.delete(id);
      else if (paper.state !== "fading") startFade(paper, false);
    }
    let i = 0;
    for (const id of wantedIds) {
      if (papers.has(id)) continue;
      const delay = i++ * 70 + randomRange(0, 90);
      papers.set(id, null);
      later(() => {
        if (papers.get(id) !== null) return;
        papers.delete(id);
        if (!wantedIds.includes(id)) return;
        const position = randomSpawnPosition();
        // with reduced motion it is simply there, without the drop
        if (reduceMotion()) spawnPaper(id, position, false);
        else spawnPaper(id, position, true, arrivalDropHeight(position));
      }, delay);
    }
  }

  // ==================================================
  // Pointer handling — click to open / drag to grab and throw
  // ==================================================
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const grabPlane = new THREE.Plane();
  const grabHitPoint = new THREE.Vector3();
  let pointerState = null;
  const canvas = renderer.domElement;
  canvas.style.touchAction = "none";

  const livePapers = () => [...papers.values()].filter(Boolean);

  function updatePointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickPaper(e) {
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const list = livePapers();
    const hit = raycaster.intersectObjects(list.map((p) => p.mesh));
    if (hit.length === 0) return null;
    return list.find((p) => p.mesh === hit[0].object) || null;
  }

  const isGrabbable = (paper) => paper.state === "closed" || paper.state === "rolling";

  function onPointerDown(e) {
    if (!animData || pointerState || activePaper) return;
    const p = pickPaper(e);
    pointerState = { paper: p, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, grabbing: false };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events may carry no valid pointerId
    }
    if (p && p.state === "rolling") beginGrab(p, e);
  }

  function onPointerMove(e) {
    if (!pointerState) {
      updateHoverCursor(e);
      return;
    }
    if (e.pointerId !== pointerState.pointerId) return;
    if (!pointerState.grabbing) {
      const p = pointerState.paper;
      const moved = Math.hypot(e.clientX - pointerState.startX, e.clientY - pointerState.startY);
      if (p && isGrabbable(p) && moved > CLICK_DRAG_THRESHOLD_PX) beginGrab(p, e);
    }
    if (pointerState.grabbing && pointerState.paper) updateGrabTarget(pointerState.paper, e);
  }

  function onPointerUp(e) {
    if (!pointerState || e.pointerId !== pointerState.pointerId) return;
    if (pointerState.grabbing) {
      if (pointerState.paper) releaseGrab(pointerState.paper, true);
    } else {
      const p = pickPaper(e);
      if (p && p.state === "closed" && !activePaper) options.onPaperOpen(p.id);
    }
    pointerState = null;
  }

  function onPointerCancel(e) {
    if (!pointerState || e.pointerId !== pointerState.pointerId) return;
    if (pointerState.grabbing && pointerState.paper) releaseGrab(pointerState.paper, false);
    pointerState = null;
  }

  function updateHoverCursor(e) {
    if (!animData || activePaper) return;
    const p = pickPaper(e);
    canvas.style.cursor = p ? (isGrabbable(p) ? "pointer" : "default") : "";
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  function beginGrab(paper, e) {
    pointerState.grabbing = true;
    paper.state = "grabbed";
    paper.time = 0;
    const body = paper.body;
    body.type = CANNON.Body.KINEMATIC;
    body.mass = 0;
    body.updateMassProperties();
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.collisionFilterGroup = 1;
    body.collisionFilterMask = 1;
    body.wakeUp();
    paper.grab = { target: new THREE.Vector3(body.position.x, restCenterY + GRAB_LIFT, body.position.z) };
    updateGrabTarget(paper, e);
    canvas.style.cursor = "grabbing";
  }

  function updateGrabTarget(paper, e) {
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    grabPlane.normal.set(0, 1, 0);
    grabPlane.constant = -(restCenterY + GRAB_LIFT);
    if (!raycaster.ray.intersectPlane(grabPlane, grabHitPoint)) return;
    paper.grab.target.set(
      clampAbs(grabHitPoint.x, halfWidthAt(grabHitPoint.z) - collisionRadius),
      restCenterY + GRAB_LIFT,
      Math.min(Math.max(grabHitPoint.z, stageBounds.minZ + collisionRadius), stageBounds.maxZ - collisionRadius),
    );
  }

  function releaseGrab(paper, withThrow) {
    const body = paper.body;
    let vx = withThrow ? body.velocity.x : 0;
    let vz = withThrow ? body.velocity.z : 0;
    const speed = Math.hypot(vx, vz);
    if (speed > THROW_MAX_SPEED) {
      const k = THROW_MAX_SPEED / speed;
      vx *= k;
      vz *= k;
    }
    body.type = CANNON.Body.DYNAMIC;
    body.mass = PAPER_MASS;
    body.updateMassProperties();
    body.velocity.set(vx, 0, vz);
    body.angularVelocity.set((vz / collisionRadius) * 0.6, 0, (-vx / collisionRadius) * 0.6);
    body.wakeUp();
    paper.state = "rolling";
    paper.time = 0;
    paper.throw = { settleTimer: 0 };
    canvas.style.cursor = "";
  }

  function startOpen(paper) {
    setPaperBodyDynamic(paper, false);
    syncMeshToBody(paper);
    paper.state = "opening";
    paper.time = 0;
    paper.start = captureTransform(paper);
    const pose = computeOpenPose();
    paper.target = { position: pose.position, quaternion: pose.quaternion, scale: pose.scale, frameIdx: OPEN_FRAME };
  }

  function startDiscard(paper) {
    if (paper.state === "discarding" || paper.state === "rolling") return;
    // The open paper sits in front of the camera, so always discard it
    // toward the back, into the stage.
    const dir = new THREE.Vector3(randomRange(-1, 1), 0, randomRange(-1.3, -0.45)).normalize();
    paper.state = "discarding";
    paper.time = 0;
    paper.start = captureTransform(paper);
    setPaperBodyDynamic(paper, true);
    syncBodyToMesh(paper);
    paper.body.velocity.set(dir.x * randomRange(1.4, 2.0), randomRange(0.5, 0.9), dir.z * randomRange(1.4, 2.0));
    paper.body.angularVelocity.set(randomRange(-2.4, 2.4), randomRange(-0.8, 0.8), randomRange(-2.4, 2.4));
    paper.throw = { settleTimer: 0 };
  }

  // ==================================================
  // Animation playback
  // ==================================================
  let prevTime = performance.now() / 1000;
  const _project = new THREE.Vector3();
  const _edge = new THREE.Vector3();
  const _camUp = new THREE.Vector3();

  function tick() {
    const now = performance.now() / 1000;
    // A stalled tab or a slow device can produce one huge dt; without a cap
    // that single step would jump the open/close/throw timers straight past
    // their animation, so it would look like it had snapped instead of moved.
    const dt = Math.min(now - prevTime, 0.05);
    prevTime = now;

    if (animData) {
      physicsWorld.step(PHYSICS_STEP, dt, 3);
      applyPhysicsBounds(dt);
      for (const p of papers.values()) if (p) updatePaperMotion(p, dt);
      placeButtons();
    }
    composer.render();
  }

  // Keeps each paper's keyboard button over the paper on screen; direct style
  // writes, so nothing in React re-renders per frame.
  function placeButtons() {
    const { w, h } = size();
    _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    for (const p of papers.values()) {
      if (!p) continue;
      _project.set(p.body.position.x, p.body.position.y, p.body.position.z);
      _edge.copy(_project).addScaledVector(_camUp, collisionRadius * 1.15);
      _project.project(camera);
      _edge.project(camera);
      const x = ((_project.x + 1) / 2) * w;
      const y = ((1 - _project.y) / 2) * h;
      const r = Math.max(22, Math.abs(((1 - _edge.y) / 2) * h - y));
      const style = p.button.style;
      style.transform = `translate(${(x - r).toFixed(1)}px, ${(y - r).toFixed(1)}px)`;
      style.width = style.height = `${(r * 2).toFixed(1)}px`;
      p.button.hidden = p.state !== "closed" && p.state !== "rolling";
    }
  }

  const ASH = new THREE.Color("#4b423a");
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // A paper leaves the local scene. `burn` is for one that was let go: it
  // darkens and lifts as it fades, where it is, with no flames or debris.
  // Anything else (another visitor's destruction, a window refill) just
  // shrinks away. Its own material, so fading it leaves the others alone.
  function startFade(paper, burn) {
    if (!paper.bodyRemoved) physicsWorld.removeBody(paper.body);
    paper.bodyRemoved = true;
    paper.mesh.visible = true;
    paper.mesh.castShadow = false;
    paper.ownMaterial = paperMaterial3d.clone();
    paper.ownMaterial.transparent = true;
    paper.mesh.material = paper.ownMaterial;
    paper.state = "fading";
    paper.time = 0;
    paper.fade = {
      burn,
      duration: reduceMotion() ? 0.2 : burn ? 1.5 : 0.7,
      scale: paper.mesh.scale.x,
      frame: paper.frameIdx,
      color: paper.ownMaterial.color.clone(),
    };
  }

  function updatePaperMotion(paper, dt) {
    const maxFrame = animData.frameCount - 1;

    if (paper.state === "fading") {
      paper.time += dt;
      const { burn, duration, scale, frame, color } = paper.fade;
      const t = clamp01(paper.time / duration);
      if (burn) {
        // An open sheet balls itself up first (a flat card fading out reads
        // as a slab), darkening as it goes, then fades in the last stretch.
        const crumple = easeOutCubic(clamp01(t / 0.6));
        if (frame < maxFrame) {
          paper.frameIdx = lerp(frame, maxFrame, crumple);
          updatePaperFrame(paper, animData, paper.frameIdx);
        }
        paper.mesh.scale.setScalar(lerp(scale, Math.min(scale, CLOSED_SCALE) * 0.85, crumple));
        paper.ownMaterial.color.lerpColors(color, ASH, clamp01(t * 1.4));
        paper.ownMaterial.opacity = 1 - easeInCubic(clamp01((t - 0.45) / 0.55));
        if (!reduceMotion()) paper.mesh.position.y += dt * 0.08;
      } else {
        paper.ownMaterial.opacity = 1 - easeInCubic(t);
        paper.mesh.scale.setScalar(scale * (1 - 0.6 * easeInCubic(t)));
      }
      if (t >= 1) removePaper(paper);
      return;
    }

    if (paper.state === "opening") {
      paper.time += dt * ANIM_SPEED;
      const t = clamp01(paper.time / OPEN_DURATION);
      const e = easeOutCubic(t);
      paper.mesh.position.lerpVectors(paper.start.position, paper.target.position, e);
      paper.mesh.quaternion.slerpQuaternions(paper.start.quaternion, paper.target.quaternion, e);
      paper.mesh.scale.setScalar(lerp(paper.start.scale, paper.target.scale, e));
      paper.frameIdx = lerp(paper.start.frameIdx, paper.target.frameIdx, easeInCubic(t));
      updatePaperFrame(paper, animData, paper.frameIdx);
      if (t >= 1) {
        paper.state = "open";
        paper.frameIdx = paper.target.frameIdx;
        paper.mesh.position.copy(paper.target.position);
        paper.mesh.quaternion.copy(paper.target.quaternion);
        paper.mesh.scale.setScalar(paper.target.scale);
        syncBodyToMesh(paper);
        updatePaperFrame(paper, animData, paper.frameIdx);
        const done = paper.onUnfolded;
        paper.onUnfolded = null;
        done?.(openRect(paper));
      }
      return;
    }

    if (paper.state === "discarding") {
      paper.time += dt * ANIM_SPEED;
      const t = clamp01(paper.time / DISCARD_DURATION);
      const closeEase = easeOutCubic(t);
      const scale = lerp(paper.start.scale, CLOSED_SCALE, closeEase);
      paper.frameIdx = lerp(paper.start.frameIdx, maxFrame, closeEase);
      syncMeshToBody(paper, scale);
      updatePaperFrame(paper, animData, paper.frameIdx);
      if (t >= 1) {
        paper.state = "rolling";
        paper.time = 0;
        paper.frameIdx = maxFrame;
        updatePaperFrame(paper, animData, paper.frameIdx);
      }
      return;
    }

    if (paper.state === "grabbed") {
      const body = paper.body;
      const target = paper.grab.target;
      let vx = (target.x - body.position.x) * GRAB_STIFFNESS;
      let vy = (target.y - body.position.y) * GRAB_STIFFNESS;
      let vz = (target.z - body.position.z) * GRAB_STIFFNESS;
      const speed = Math.hypot(vx, vy, vz);
      if (speed > GRAB_MAX_SPEED) {
        const k = GRAB_MAX_SPEED / speed;
        vx *= k;
        vy *= k;
        vz *= k;
      }
      body.velocity.set(vx, vy, vz);
      syncMeshToBody(paper);
      return;
    }

    if (paper.state === "rolling") {
      paper.time += dt;
      const grounded = isOnGround(paper.body);
      if (grounded) applyRollingResistance(paper.body, dt);
      syncMeshToBody(paper);
      const speed = paper.body.velocity.lengthSquared() + paper.body.angularVelocity.lengthSquared() * 0.02;
      paper.throw.settleTimer = grounded && speed < ROLL_SETTLE_SPEED ? paper.throw.settleTimer + dt : 0;
      if (paper.throw.settleTimer > 0.35) finishRollingPaper(paper, maxFrame);
      return;
    }

    if (paper.state === "closed") {
      if (isOnGround(paper.body)) applyRollingResistance(paper.body, dt);
      syncMeshToBody(paper);
    }
  }

  // Screen rectangle (CSS px, relative to the container) of the open sheet,
  // from its projected bounding box: the reading layer is laid over it.
  function openRect(paper) {
    paper.mesh.updateMatrixWorld(true);
    const box = flatBox;
    const { w, h } = size();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      _project.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      _project.applyMatrix4(paper.mesh.matrixWorld).project(camera);
      const x = ((_project.x + 1) / 2) * w;
      const y = ((1 - _project.y) / 2) * h;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  }

  function onResize() {
    const { w, h } = size();
    applyCamera();
    measureFog();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    if (activePaper && activePaper.state === "open") {
      const pose = computeOpenPose();
      activePaper.mesh.position.copy(pose.position);
      activePaper.mesh.quaternion.copy(pose.quaternion);
      activePaper.mesh.scale.setScalar(pose.scale);
      return openRect(activePaper);
    }
    return null;
  }

  renderer.setAnimationLoop(tick);

  loadVATData(options.vatBase)
    .then((data) => {
      if (disposed) return;
      animData = data;
      flatSize.width = animData.flat.width;
      flatSize.depth = animData.flat.depth;
      for (const index of animData.indices) {
        flatBox.expandByPoint(
          _project.fromArray(animData.positions, (OPEN_FRAME * animData.vertexCount + index) * 3),
        );
      }
      crumpleCenter.fromArray(animData.crumple.center);
      collisionRadius = animData.crumple.radius * CLOSED_SCALE;
      restCenterY = FLOOR_VISUAL_Y + collisionRadius * 1.08;
      restMeshY = restCenterY - crumpleCenter.y * CLOSED_SCALE;
      floorBody.position.y = restCenterY - collisionRadius;
      syncPapers();
      for (const fn of pendingThrows.splice(0)) fn();
      options.onReady();
    })
    .catch((err) => {
      if (!disposed) options.onError(err instanceof Error ? err : new Error(String(err)));
    });

  const pendingThrows = [];

  return {
    setPapers(ids) {
      wantedIds = [...ids];
      syncPapers();
    },

    /** Unfolds the paper toward the camera; calls back with its screen rect once flat. */
    openPaper(id, onUnfolded) {
      const paper = papers.get(id);
      if (!paper || activePaper || !isGrabbable(paper)) {
        onUnfolded(null);
        return;
      }
      activePaper = paper;
      paper.mesh.castShadow = false;
      // The HTML reading sheet fades in over the flat mesh (260ms) and is cut
      // to a torn outline the rectangular mesh would show around, so the mesh
      // hides once covered and comes back for the crumple on close.
      paper.onUnfolded = (rect) => {
        onUnfolded(rect);
        later(() => {
          if (activePaper === paper) paper.mesh.visible = false;
        }, 300);
      };
      startOpen(paper);
    },

    /**
     * The open paper is gone (let go here, or by someone else while it was
     * being read): it fades where it is instead of crumpling back.
     */
    burnOpenPaper() {
      if (!activePaper) return;
      activePaper.onUnfolded = null;
      startFade(activePaper, true);
      activePaper = null;
    },

    /** Crumples the open paper back into the space. Nothing is deleted. */
    closePaper() {
      if (!activePaper) return;
      activePaper.onUnfolded = null;
      activePaper.mesh.visible = true;
      activePaper.mesh.castShadow = true;
      startDiscard(activePaper);
      activePaper = null;
    },

    /** The just-saved paper appears where the form was, crumples, and is thrown in. */
    throwCreatedPaper(id) {
      const run = () => {
        if (disposed || papers.get(id)) return;
        if (!wantedIds.includes(id)) wantedIds.push(id);
        const pose = computeOpenPose();
        const paper = spawnPaper(id, pose.position, false);
        setPaperBodyDynamic(paper, false);
        paper.mesh.position.copy(pose.position);
        paper.mesh.quaternion.copy(pose.quaternion);
        paper.mesh.scale.setScalar(pose.scale * 0.85);
        paper.frameIdx = OPEN_FRAME;
        updatePaperFrame(paper, animData, paper.frameIdx);
        paper.state = "open";
        startDiscard(paper);
      };
      if (animData) run();
      else pendingThrows.push(run);
    },

    resize: onResize,

    dispose() {
      disposed = true;
      for (const t of timeouts) clearTimeout(t);
      timeouts.clear();
      renderer.setAnimationLoop(null);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      for (const p of livePapers()) removePaper(p);
      papers.clear();
      floorGeometry.dispose();
      floorMat.dispose();
      wallGeometry.dispose();
      wallMat.dispose();
      paperMaterial3d.dispose();
      paperTexture.dispose();
      paperBump.dispose();
      scene.environment?.dispose();
      pmrem.dispose();
      ssaoPass.dispose();
      composer.dispose();
      dirLight.shadow.map?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
