import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gsap } from "gsap";
import { Observer } from "gsap/Observer";

// The Gallery's record exhibition (G01–G03): one charcoal record in the
// middle and the collection's square sleeves on a tilted orbit around it.
// Everything moves from one shared phase: input changes a target, one ticker
// damps toward it, and a settled gesture reports a focused id once. Per-frame
// state stays here, never in React. Text is HTML; only the generated images
// and the fixed materials in /textures/gallery/ are drawn.
//
// It imports nothing from the room: no paper scene, furnace, fire or physics.

gsap.registerPlugin(Observer);

export type OrbitItem = { id: string; image_url: string };
export type OrbitCallbacks = {
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
  onLost: () => void;
};
export type GalleryOrbit = {
  setItems: (items: OrbitItem[]) => void;
  setOpen: (open: boolean) => void;
  focus: (id: string) => void;
  step: (dir: 1 | -1) => void;
  dispose: () => void;
};

const TEX = "/textures/gallery/";
const TAU = Math.PI * 2;
const FRONT = -Math.PI / 2;
// vinyl-face.png: the record's edge and its label window, as fractions of the
// plate's half-width (measured from the file's alpha)
const FACE_EDGE = 0.945;
const FACE_WINDOW = 0.383;
// sleeve-frame.png: opaque border from 3.5% to 9.8% of the plate
const FRAME_PLATE = 1.076;
const ART_INSET = 0.87;
const MAX_TEXTURES = 14;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mod = (n: number, m: number) => ((n % m) + m) % m;
// signed ring distance in (-m/2, m/2]
const ringDelta = (n: number, m: number) => {
  const d = mod(n, m);
  return d > m / 2 ? d - m : d;
};
// piecewise-linear through (xs, ys) on |s|, sign restored
function along(s: number, xs: number[], ys: number[]): number {
  const a = Math.abs(s);
  let y = ys[ys.length - 1];
  for (let k = 1; k < xs.length; k++) {
    if (a <= xs[k]) {
      y = lerp(ys[k - 1], ys[k], (a - xs[k - 1]) / (xs[k] - xs[k - 1]));
      break;
    }
  }
  return Math.sign(s) * y;
}

type Pose = { x: number; y: number; z: number; size: number; rx: number; ry: number; rz: number; vis: number; fade: number };
type Layout = {
  w: number;
  h: number;
  phone: boolean;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  tilt: number;
  depth: number;
  size: number;
  disc: Pose;
  discDetail: Pose;
  hero: Pose;
  shadowDrop: number;
};

type Sleeve = {
  id: string;
  url: string;
  group: THREE.Group;
  stock: THREE.Mesh;
  art: THREE.Mesh;
  frame: THREE.Mesh;
  shadow: THREE.Mesh;
  mats: THREE.Material[];
  artMat: THREE.MeshBasicMaterial;
  pose: Pose;
  placed: boolean;
};

const hiddenPose = (): Pose => ({ x: 0, y: 0, z: -80, size: 1, rx: 0, ry: 0, rz: 0, vis: 0, fade: 1 });

function shadowTexture(square: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  if (square) {
    g.filter = "blur(10px)";
    g.fillStyle = "rgba(40,44,44,1)";
    g.fillRect(26, 26, 76, 76);
  } else {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(40,44,44,0.9)");
    grad.addColorStop(0.55, "rgba(40,44,44,0.35)");
    grad.addColorStop(1, "rgba(40,44,44,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The page lays out three HTML boxes the scene follows: the browsing band,
// and where the opened record's square art and disc sit (G02), so the WebGL
// objects arrive exactly where the HTML record takes over.
export type OrbitFrame = { band: HTMLElement; art: HTMLElement; disc: HTMLElement };

export function createGalleryOrbit(host: HTMLElement, frames: OrbitFrame, cb: OrbitCallbacks): GalleryOrbit {
  const band = frames.band;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment(renderer);
  const envTarget = pmrem.fromScene(room, 0.04);
  scene.environment = envTarget.texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xf6f5f0, 0x8d9695, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-0.55, 0.8, 0.7);
  scene.add(sun);

  // A long lens: CSS pixels map one-to-one at z = 0, with just enough
  // perspective for the sleeves to read as objects in depth.
  const FOV = 18;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);

  // --- fixed materials, decoded once ---------------------------------------
  const loader = new THREE.TextureLoader();
  const fixed = (name: string, color = true) => {
    const t = loader.load(TEX + name, () => (dirty = 4));
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };
  const faceTex = fixed("vinyl-face.png");
  const grooveTex = fixed("vinyl-grooves-height.png", false);
  const stockTex = fixed("paper-stock.jpg");
  const frameTex = fixed("sleeve-frame.png");
  const floorShadow = shadowTexture(false);
  const dropShadow = shadowTexture(true);

  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const unitBox = new THREE.BoxGeometry(1, 1, 0.012);
  const unitCircle = new THREE.CircleGeometry(1, 96);

  // --- the record ----------------------------------------------------------
  const disc = new THREE.Group();
  const spin = new THREE.Group();
  disc.add(spin);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1b, roughness: 0.5, transparent: true });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.012, 128, 1, true), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.renderOrder = 0;
  const labelMat = new THREE.MeshBasicMaterial({ map: stockTex, transparent: true });
  const label = new THREE.Mesh(unitCircle, labelMat);
  label.scale.setScalar((FACE_WINDOW / FACE_EDGE) * 1.03);
  label.position.z = -0.002;
  label.renderOrder = 1;
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x22221f, transparent: true });
  const hole = new THREE.Mesh(unitCircle, holeMat);
  hole.scale.setScalar(0.03);
  hole.position.z = 0.001;
  hole.renderOrder = 2;
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex,
    bumpMap: grooveTex,
    bumpScale: 0.6,
    roughness: 0.42,
    metalness: 0,
    envMapIntensity: 0.55,
    transparent: true,
    alphaTest: 0.01,
  });
  const face = new THREE.Mesh(unitPlane, faceMat);
  face.scale.setScalar(2 / FACE_EDGE);
  face.position.z = 0.003;
  face.renderOrder = 3;
  spin.add(rim, label, hole, face);
  const discShadowMat = new THREE.MeshBasicMaterial({ map: floorShadow, transparent: true, depthWrite: false, opacity: 0.2 });
  const discShadow = new THREE.Mesh(unitPlane, discShadowMat);
  discShadow.renderOrder = -1;
  scene.add(disc, discShadow);
  const discMats: THREE.Material[] = [rimMat, labelMat, holeMat, faceMat];
  const discPose: Pose = hiddenPose();
  let discPlaced = false;

  // --- sleeves and their images --------------------------------------------
  const textures = new Map<string, { tex: THREE.Texture; used: number; ready: boolean }>();
  let useClock = 0;
  function artFor(item: { id: string; url: string }): THREE.Texture | null {
    const known = textures.get(item.id);
    if (known) {
      known.used = ++useClock;
      return known.ready ? known.tex : null;
    }
    const entry = { tex: null as unknown as THREE.Texture, used: ++useClock, ready: false };
    entry.tex = loader.load(
      item.url,
      () => {
        entry.ready = true;
        dirty = 4;
      },
      undefined,
      () => {
        // a hidden or missing image keeps the blank stock
      },
    );
    entry.tex.colorSpace = THREE.SRGBColorSpace;
    entry.tex.anisotropy = maxAniso;
    textures.set(item.id, entry);
    // bounded GPU memory: retire the least recently wanted image
    if (textures.size > MAX_TEXTURES) {
      let oldest: string | null = null;
      for (const [id, t] of textures) if (!oldest || t.used < textures.get(oldest)!.used) oldest = id;
      if (oldest && oldest !== item.id) {
        textures.get(oldest)!.tex.dispose();
        textures.delete(oldest);
      }
    }
    return null;
  }

  const sleeves = new Map<string, Sleeve>();
  function makeSleeve(item: OrbitItem): Sleeve {
    const group = new THREE.Group();
    const stockMat = new THREE.MeshStandardMaterial({ map: stockTex, roughness: 0.95, envMapIntensity: 0.25, transparent: true });
    const artMat = new THREE.MeshBasicMaterial({ map: stockTex, transparent: true });
    const frameMat = new THREE.MeshStandardMaterial({
      map: frameTex,
      roughness: 0.95,
      envMapIntensity: 0.25,
      transparent: true,
      alphaTest: 0.01,
      depthWrite: false,
    });
    const shadowMat = new THREE.MeshBasicMaterial({ map: floorShadow, transparent: true, depthWrite: false, opacity: 0 });
    const stock = new THREE.Mesh(unitBox, stockMat);
    stock.renderOrder = 0;
    stock.userData.id = item.id;
    const art = new THREE.Mesh(unitPlane, artMat);
    art.scale.setScalar(ART_INSET);
    art.position.z = 0.0075;
    art.renderOrder = 1;
    const frame = new THREE.Mesh(unitPlane, frameMat);
    frame.scale.setScalar(FRAME_PLATE);
    frame.position.z = 0.008;
    frame.renderOrder = 2;
    group.add(stock, art, frame);
    const shadow = new THREE.Mesh(unitPlane, shadowMat);
    shadow.renderOrder = -1;
    scene.add(group, shadow);
    group.visible = false;
    shadow.visible = false;
    return {
      id: item.id,
      url: item.image_url,
      group,
      stock,
      art,
      frame,
      shadow,
      mats: [stockMat, artMat, frameMat, shadowMat],
      artMat,
      pose: hiddenPose(),
      placed: false,
    };
  }
  function dropSleeve(s: Sleeve) {
    scene.remove(s.group, s.shadow);
    for (const m of s.mats) m.dispose();
  }

  // --- layout from the viewport and the HTML stage band ---------------------
  let L: Layout;
  function measure() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w <= 600 ? 1.25 : 1.5));
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.position.set(0, 0, dist);
    camera.near = dist / 10;
    camera.far = dist * 4;
    camera.updateProjectionMatrix();

    const r = band.getBoundingClientRect();
    const bandTop = r.height > 0 ? r.top : h * 0.22;
    const bandH = r.height > 0 ? r.height : h * 0.62;
    // world y is up from the viewport's centre; CSS y is down from the top
    const toY = (cssY: number) => h / 2 - cssY;
    const phone = w <= 600;
    const cy = toY(bandTop + bandH / 2);
    const box = (el: HTMLElement) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 ? { x: b.left + b.width / 2 - w / 2, y: toY(b.top + b.height / 2), size: b.width } : null;
    };
    const art = box(frames.art);
    const rec = box(frames.disc);
    const still = (b: { x: number; y: number; size: number }, z: number, size = b.size): Pose => ({ x: b.x, y: b.y, z, size, rx: 0, ry: 0, rz: 0, vis: 1, fade: 1 });
    if (phone) {
      const size = Math.min(w * 0.4, bandH * 0.36);
      const discR = Math.min(w * 0.34, bandH * 0.29);
      L = {
        w,
        h,
        phone,
        cx: 0,
        cy,
        rx: Math.min(w * 0.27, w / 2 - size * 0.4) * Math.SQRT2,
        ry: Math.min(bandH * 0.3, bandH / 2 - size * 0.45) * Math.SQRT2,
        tilt: 0,
        depth: 60,
        size,
        disc: { x: 0, y: cy, z: 40, size: discR, rx: 0, ry: 0, rz: 0, vis: 1, fade: 1 },
        discDetail: rec ? still(rec, 1, rec.size / 2) : { x: 0, y: cy, z: 1, size: discR, rx: 0, ry: 0, rz: 0, vis: 1, fade: 1 },
        hero: art ? still(art, 0) : { x: 0, y: cy, z: 0, size: w - 40, rx: 0, ry: 0, rz: 0, vis: 1, fade: 1 },
        shadowDrop: 0.04,
      };
    } else {
      const discR = Math.min(bandH * 0.38, w * 0.165);
      const size = Math.min(bandH * 0.44, w * 0.18);
      L = {
        w,
        h,
        phone,
        cx: -w * 0.015,
        cy,
        rx: Math.min(w * 0.4, w / 2 - size * 0.62),
        ry: bandH * 0.24,
        tilt: -0.22,
        depth: 420,
        size,
        disc: { x: -w * 0.015, y: cy, z: 0, size: discR, rx: 0.5, ry: -0.42, rz: 0, vis: 1, fade: 1 },
        discDetail: rec ? still(rec, 2, rec.size / 2) : { x: -w * 0.28, y: cy, z: 2, size: h * 0.29, rx: 0, ry: 0, rz: 0, vis: 1, fade: 1 },
        hero: art ? still(art, 0) : { x: 0, y: cy, z: 0, size: h * 0.6, rx: 0, ry: 0, rz: 0, vis: 1, fade: 1 },
        shadowDrop: 0.66,
      };
    }
    dirty = 4;
  }

  // where the item s places from the front sits on the orbit
  function orbitPose(s: number): Pose {
    const a = Math.abs(s);
    const theta = L.phone ? along(s, [0, 1, 2, 3], [0, Math.PI / 4, (3 * Math.PI) / 4, Math.PI]) : along(s, [0, 1, 2, 3, 4], [0, 0.62, 1.3, 2.05, Math.PI]);
    const vis = smooth(0.08, 0.9, a) * (1 - (L.phone ? smooth(2.15, 2.85, a) : smooth(3.2, 3.9, a)));
    const angle = FRONT + theta;
    const ex = L.rx * Math.cos(angle);
    const ey = L.ry * Math.sin(angle);
    const c = Math.cos(L.tilt);
    const sn = Math.sin(L.tilt);
    const near = (1 - Math.sin(angle)) / 2;
    const ox = ex * c - ey * sn;
    const oy = ex * sn + ey * c;
    // an item leaving the orbit slides behind the record, into it
    const reach = 0.25 + 0.75 * vis;
    if (L.phone) {
      return {
        x: L.cx + ox * reach,
        y: L.cy + oy * reach,
        z: lerp(-120, -20 - (1 - near) * L.depth, vis),
        size: L.size * (0.35 + 0.65 * vis),
        rx: 0,
        ry: 0,
        rz: -0.05 * Math.sin(2 * angle) * vis,
        vis,
        fade: 1,
      };
    }
    return {
      x: L.cx + ox * reach,
      y: L.cy + oy * reach,
      z: lerp(-160, (near - 0.45) * L.depth, vis),
      size: L.size * (0.56 + 0.44 * near) * (0.35 + 0.65 * vis),
      rx: -0.18 + 0.12 * Math.sin(angle),
      ry: Math.cos(angle) * 0.34,
      rz: -0.06 * Math.cos(angle),
      vis,
      fade: 1,
    };
  }

  function blend(a: Pose, b: Pose, t: number): Pose {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      z: lerp(a.z, b.z, t),
      size: lerp(a.size, b.size, t),
      rx: lerp(a.rx, b.rx, t),
      ry: lerp(a.ry, b.ry, t),
      rz: lerp(a.rz, b.rz, t),
      vis: lerp(a.vis, b.vis, t),
      fade: lerp(a.fade, b.fade, t),
    };
  }

  // --- the shared phase ----------------------------------------------------
  let items: OrbitItem[] = [];
  let pending: OrbitItem[] | null = null;
  let phase = 0;
  let target = 0;
  let reported: string | null = null;
  let dragging = false;
  let dragStart = 0;
  let dirty = 4;
  const fx = { detail: 0, entry: 0 };
  let open = false;

  const count = () => items.length;
  const focusIndex = () => (count() ? mod(Math.round(target), count()) : -1);

  function applyItems(next: OrbitItem[]) {
    const prevFocus = count() ? items[focusIndex()]?.id : null;
    const prevIndex = focusIndex();
    const offset = phase - Math.round(target);
    items = next;
    const keep = new Set(next.map((i) => i.id));
    for (const [id, s] of sleeves) {
      if (!keep.has(id)) {
        dropSleeve(s);
        sleeves.delete(id);
      }
    }
    for (const item of next) if (!sleeves.has(item.id)) sleeves.set(item.id, makeSleeve(item));
    if (!next.length) {
      phase = target = 0;
    } else {
      let idx = prevFocus ? next.findIndex((i) => i.id === prevFocus) : -1;
      // a removed focus hands over to the nearest remaining item
      if (idx < 0) idx = clamp(prevIndex < 0 ? 0 : prevIndex, 0, next.length - 1);
      target = idx;
      phase = idx + clamp(offset, -0.5, 0.5);
    }
    dirty = 4;
    settle(true);
  }

  // one focus report per settled position, never one per frame
  function settle(force = false) {
    if (!count()) {
      reported = null;
      return;
    }
    if (!force && (dragging || Math.abs(target - phase) > 0.02)) return;
    const id = items[focusIndex()].id;
    if (id !== reported) {
      reported = id;
      cb.onFocus(id);
    }
  }

  function snap(to?: number) {
    target = to ?? Math.round(target);
    dirty = 4;
  }

  // --- input: wheel, drag and swipe on the stage only ------------------------
  let wheelTimer = 0;
  const pxPerItem = () => (L.phone ? 150 : 280);
  const observer = Observer.create({
    target: host,
    type: "wheel,touch,pointer",
    tolerance: 4,
    dragMinimum: 4,
    lockAxis: true,
    onWheel: (self) => {
      const e = self.event as WheelEvent;
      // pinch-zoom and modified wheels belong to the browser
      if (open || !count() || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1;
      const d = clamp((Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit, -120, 120);
      target += d / 320;
      dirty = 4;
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => snap(), 140);
    },
    onPress: () => {
      if (open || !count()) return;
      dragStart = Math.round(target);
    },
    onDragStart: () => {
      if (open || !count()) return;
      dragging = true;
    },
    onDrag: (self) => {
      if (!dragging) return;
      target -= self.deltaX / pxPerItem();
      dirty = 4;
    },
    onDragEnd: (self) => {
      if (!dragging) return;
      dragging = false;
      if (L.phone) {
        // a short swipe is one deliberate step from where it began
        const moved = target - dragStart;
        const fling = -self.velocityX / 900;
        const steps = Math.abs(moved + fling) < 0.12 ? 0 : clamp(Math.round(moved + fling) || Math.sign(moved + fling), -2, 2);
        snap(dragStart + steps);
      } else {
        snap(clamp(Math.round(target - self.velocityX / pxPerItem() / 6), dragStart - 3, dragStart + 3));
      }
      if (pending) {
        const next = pending;
        pending = null;
        applyItems(next);
      }
    },
  });

  // a click (not a drag) opens the record, or turns a sleeve to the front
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number; t: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    if (!d || open || !count()) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return;
    ndc.set((e.clientX / L.w) * 2 - 1, -(e.clientY / L.h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets: THREE.Object3D[] = [face, label];
    for (const s of sleeves.values()) if (s.group.visible && s.pose.vis > 0.3) targets.push(s.stock);
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return;
    const id = hit.object.userData.id as string | undefined;
    const fi = focusIndex();
    if (!id) {
      if (Math.abs(target - phase) < 0.3) cb.onOpen(items[fi].id);
      return;
    }
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return;
    snap(Math.round(target) + Math.round(ringDelta(i - Math.round(target), count())));
  };
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointerup", onUp);

  // --- per frame -----------------------------------------------------------
  const clock = new THREE.Clock();
  const place = (obj: THREE.Object3D, p: Pose) => {
    obj.position.set(p.x, p.y, p.z);
    obj.rotation.set(p.rx, p.ry, p.rz);
  };

  function frame() {
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const prev = phase;
    phase += (target - phase) * (1 - Math.exp(-dt * 9));
    if (Math.abs(target - phase) < 1e-4) phase = target;
    let moving = Math.abs(phase - prev) > 1e-5;
    settle();

    const n = count();
    const detail = fx.detail;
    const entry = fx.entry;
    const k = 1 - Math.exp(-dt * 14);

    // the record
    const dp = blend(L.disc, L.discDetail, detail);
    dp.y -= (1 - entry) * 40;
    for (const key of Object.keys(dp) as (keyof Pose)[]) {
      const before = discPose[key];
      discPose[key] = discPlaced ? lerp(before, dp[key], k) : dp[key];
      if (Math.abs(discPose[key] - before) > 0.01) moving = true;
    }
    discPlaced = true;
    place(disc, discPose);
    disc.scale.setScalar(discPose.size * (0.92 + 0.08 * entry));
    spin.rotation.z = -phase * (TAU / 10) + (1 - entry) * 0.8;
    // the phone's opened record is the art alone; the disc steps aside
    const discFade = entry * (L.phone ? 1 - smooth(0.1, 0.6, detail) : 1);
    for (const m of discMats) m.opacity = discFade;
    disc.visible = discFade > 0.01;
    discShadow.visible = !L.phone;
    discShadow.position.set(discPose.x + discPose.size * 0.1, discPose.y - discPose.size * 1.45, discPose.z - 200);
    discShadow.scale.set(discPose.size * 2.4, discPose.size * 0.42, 1);
    discShadowMat.opacity = 0.2 * entry * (1 - detail);
    const fi = n ? mod(Math.round(phase), n) : -1;
    const labelItem = fi >= 0 ? items[fi] : null;
    const labelTex = labelItem ? artFor({ id: labelItem.id, url: labelItem.image_url }) : null;
    if (labelMat.map !== (labelTex ?? stockTex)) {
      labelMat.map = labelTex ?? stockTex;
      labelMat.needsUpdate = true;
    }

    // the sleeves; ranks give a back-to-front draw order
    const order: Sleeve[] = [];
    items.forEach((item, i) => {
      const sl = sleeves.get(item.id);
      if (!sl) return;
      const s = n > 1 ? ringDelta(i - phase, n) : 0;
      let p = n > 1 ? orbitPose(s) : hiddenPose();
      if (detail > 0) {
        // the orbit gives way to the margins; the focused sleeve comes forward
        const out: Pose = {
          ...p,
          x: L.cx + (p.x - L.cx) * (1 + 0.85 * detail),
          y: L.cy + (p.y - L.cy) * (1 + 0.25 * detail),
          size: p.size * (1 - 0.25 * detail),
          fade: 1 - 0.6 * detail,
        };
        // the focused sleeve comes forward to exactly where the HTML record
        // takes over, so the hand-over shows no seam
        const focusWeight = clamp(1 - Math.abs(s), 0, 1);
        p = blend(out, L.hero, detail * focusWeight);
      }
      p.size *= 0.6 + 0.4 * entry;
      p.y -= (1 - entry) * 30 * (1 + Math.abs(s));
      p.fade *= entry;
      const cur = sl.pose;
      if (!sl.placed) {
        Object.assign(cur, p);
        sl.placed = true;
      } else {
        for (const key of Object.keys(p) as (keyof Pose)[]) {
          const before = cur[key];
          cur[key] = lerp(before, p[key], k);
          if (Math.abs(cur[key] - before) > 0.01) moving = true;
        }
      }
      const shown = cur.vis > 0.015 && cur.fade > 0.01;
      sl.group.visible = shown;
      sl.shadow.visible = shown;
      if (!shown) return;
      place(sl.group, cur);
      sl.group.scale.setScalar(cur.size);
      // only nearby sleeves fetch their image
      const tex = Math.abs(s) < 4.5 || detail > 0 ? artFor(sl) : null;
      const want = tex ?? stockTex;
      if (sl.artMat.map !== want) {
        sl.artMat.map = want;
        sl.artMat.needsUpdate = true;
      }
      for (const m of sl.mats) m.opacity = cur.fade;
      const sm = sl.shadow.material as THREE.MeshBasicMaterial;
      if (L.phone) {
        sm.map = dropShadow;
        sl.shadow.position.set(cur.x + cur.size * 0.03, cur.y - cur.size * L.shadowDrop, cur.z - 4);
        sl.shadow.rotation.set(0, 0, cur.rz);
        sl.shadow.scale.set(cur.size * 1.55, cur.size * 1.55, 1);
        sm.opacity = 0.28 * cur.fade * cur.vis;
      } else {
        sm.map = floorShadow;
        sl.shadow.position.set(cur.x + cur.size * 0.06, cur.y - cur.size * L.shadowDrop, cur.z - 180);
        sl.shadow.rotation.set(0, 0, 0);
        sl.shadow.scale.set(cur.size * 1.25, cur.size * 0.22, 1);
        sm.opacity = 0.2 * cur.fade * cur.vis * (1 - detail * 0.8);
      }
      order.push(sl);
    });
    order.sort((a, b) => a.pose.z - b.pose.z);
    let rank = 1;
    let discRanked = false;
    for (const sl of order) {
      if (!discRanked && sl.pose.z > discPose.z) {
        disc.renderOrder = rank++;
        discRanked = true;
      }
      sl.group.renderOrder = rank++;
    }
    if (!discRanked) disc.renderOrder = rank;

    if (moving || dirty > 0 || gsap.isTweening(fx)) {
      renderer.render(scene, camera);
      if (dirty > 0) dirty--;
    }
  }

  const resize = new ResizeObserver(() => measure());
  resize.observe(host);
  resize.observe(band);
  resize.observe(frames.art);
  resize.observe(frames.disc);
  const onLost = (e: Event) => {
    e.preventDefault();
    cb.onLost();
  };
  renderer.domElement.addEventListener("webglcontextlost", onLost);
  const onVisible = () => {
    clock.getDelta();
    dirty = 4;
  };
  document.addEventListener("visibilitychange", onVisible);

  measure();
  renderer.setAnimationLoop(frame);
  gsap.to(fx, { entry: 1, duration: 0.65, ease: "power2.out", delay: 0.05 });

  return {
    setItems(next) {
      // never reorder the ring under a pointer: wait for the gesture to end
      if (dragging) pending = next;
      else applyItems(next);
    },
    setOpen(value) {
      if (open === value) return;
      open = value;
      if (value) {
        observer.disable();
        snap();
      } else observer.enable();
      gsap.to(fx, { detail: value ? 1 : 0, duration: 0.72, ease: "power3.inOut", overwrite: true });
      dirty = 4;
    },
    focus(id) {
      const i = items.findIndex((x) => x.id === id);
      if (i < 0 || i === focusIndex()) return;
      snap(Math.round(target) + Math.round(ringDelta(i - Math.round(target), count())));
    },
    step(dir) {
      if (!count()) return;
      snap(Math.round(target) + dir);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      gsap.killTweensOf(fx);
      clearTimeout(wheelTimer);
      observer.kill();
      resize.disconnect();
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
      document.removeEventListener("visibilitychange", onVisible);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      for (const s of sleeves.values()) dropSleeve(s);
      sleeves.clear();
      for (const t of textures.values()) t.tex.dispose();
      textures.clear();
      for (const m of [...discMats, discShadowMat]) m.dispose();
      for (const t of [faceTex, grooveTex, stockTex, frameTex, floorShadow, dropShadow]) t.dispose();
      for (const g of [unitPlane, unitBox, unitCircle, rim.geometry]) g.dispose();
      envTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

// Whether this browser can draw the exhibition at all.
export function canDrawOrbit(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
