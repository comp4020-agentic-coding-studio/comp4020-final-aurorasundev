import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gsap } from "gsap";
import { Observer } from "gsap/Observer";
import { mergeOrbitItems, nextFocusIndex, type OrbitItem } from "./orbit-items.ts";
import { advanceSpin, dampPhase, spinning, wheelItems, wheelSnap, SPIN_GAIN, SPIN_IDLE, SPIN_RESPONSE, WHEEL_QUIET_MS } from "./gallery-motion.ts";
import { closeTimeline, local, newChoreo, openTimeline, slideStages, stepTimeline, type SpinClock } from "./record-timeline.ts";
import { createSleeveKit, type SleeveMesh } from "./sleeve-kit.ts";
import { applyVinylSheen } from "./vinyl-sheen.ts";

// The Gallery's record exhibition (G01–G03): one charcoal record in the
// middle and the collection's square sleeves on a tilted orbit around it.
// Everything moves from one shared phase: input changes a target, one ticker
// damps toward it (the only damping), and a settled gesture reports a focused
// id once. Opening and closing a record are GSAP timelines over a few shared
// values (record-timeline.ts); every pose is a pure function of the phase and
// those values. Per-frame state stays here, never in React. Text is HTML; only
// the generated images and the fixed materials in /textures/gallery/ are drawn.
//
// It imports nothing from the room: no paper scene, furnace, fire or physics.

gsap.registerPlugin(Observer);

export type { OrbitItem };
export type OrbitCallbacks = {
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
  onLost: () => void;
  // an open (or a step inside one) has finished: the sleeve and record rest
  // exactly on the HTML frames, which can take over now
  onArrive: () => void;
  // a close has gone far enough for the browsing page to come back
  onHandBack: () => void;
  // the HTML half of an open, nested into the scene's timeline (optional)
  reveal?: () => gsap.core.Timeline | null;
  // the scene has decoded its textures, compiled and drawn its warm-up frames
  onReady?: () => void;
};
export type OrbitOptions = {
  // the page's entry is showing: the scene starts unseen and without input,
  // and the page's transition drives its entrance (setEntry()) instead
  held?: boolean;
};
export type GalleryOrbit = {
  setItems: (items: OrbitItem[]) => void;
  setOpen: (open: boolean) => void;
  focus: (id: string) => void;
  step: (dir: 1 | -1) => void;
  // whether wheel, drag and clicks reach the scene (off while p < 1)
  setInput: (enabled: boolean) => void;
  // the scene's entrance, 0..1, set by the page's transition while held
  setEntry: (value: number) => void;
  // nothing turning: no drag, no wheel gesture, the phase on its target
  atRest: () => boolean;
  dispose: () => void;
};

const TEX = "/textures/gallery/";
const TAU = Math.PI * 2;
const FRONT = -Math.PI / 2;
// vinyl-face.png: the record's edge and its label window, as fractions of the
// plate's half-width (measured from the file's alpha)
const FACE_EDGE = 0.945;
const FACE_WINDOW = 0.383;
const MAX_TEXTURES = 14;
// wider than a phone but this short: gallery.css's compact landscape layout
const COMPACT_H = 540;

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
  mesh: SleeveMesh;
  shadow: THREE.Mesh;
  shadowMat: THREE.MeshBasicMaterial;
  pose: Pose;
  // the pointer's hover lift, 0..1, eased by its own small tween
  lift: { v: number };
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

export function createGalleryOrbit(host: HTMLElement, frames: OrbitFrame, cb: OrbitCallbacks, opts: OrbitOptions = {}): GalleryOrbit {
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
  // load gating: every fixed material and the front images, then compile
  const loads: Promise<void>[] = [];
  const fixed = (name: string, color = true) => {
    let done = () => {};
    loads.push(new Promise<void>((r) => (done = r)));
    const t = loader.load(
      TEX + name,
      () => {
        dirty = 4;
        done();
      },
      undefined,
      () => done(),
    );
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
  const sheen = applyVinylSheen(faceMat, { inner: FACE_WINDOW, outer: FACE_EDGE });
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
  const sunDir = sun.position.clone().normalize();

  // --- sleeves and their images --------------------------------------------
  const textures = new Map<string, { tex: THREE.Texture; used: number; ready: boolean; settled: Promise<void> }>();
  let useClock = 0;
  function artFor(item: { id: string; url: string }): THREE.Texture | null {
    const known = textures.get(item.id);
    if (known) {
      known.used = ++useClock;
      return known.ready ? known.tex : null;
    }
    let settle = () => {};
    const entry = { tex: null as unknown as THREE.Texture, used: ++useClock, ready: false, settled: new Promise<void>((r) => (settle = r)) };
    entry.tex = loader.load(
      item.url,
      () => {
        entry.ready = true;
        dirty = 4;
        settle();
      },
      undefined,
      () => {
        // a hidden or missing image keeps the blank stock
        settle();
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

  const kit = createSleeveKit(stockTex, frameTex);
  const sleeves = new Map<string, Sleeve>();
  function makeSleeve(item: OrbitItem): Sleeve {
    const mesh = kit.make();
    mesh.body.userData.id = item.id;
    const shadowMat = new THREE.MeshBasicMaterial({ map: floorShadow, transparent: true, depthWrite: false, opacity: 0 });
    const shadow = new THREE.Mesh(unitPlane, shadowMat);
    shadow.renderOrder = -1;
    scene.add(mesh.group, shadow);
    mesh.group.visible = false;
    shadow.visible = false;
    return { id: item.id, url: item.image_url, mesh, shadow, shadowMat, pose: hiddenPose(), lift: { v: 0 } };
  }
  function dropSleeve(s: Sleeve) {
    gsap.killTweensOf(s.lift);
    if (hovered === s) hovered = null;
    scene.remove(s.mesh.group, s.shadow);
    s.mesh.dispose();
    s.shadowMat.dispose();
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
      // a short landscape stage (gallery.css's matching media query) keeps
      // the same orbit with a flatter tilt and objects sized to its height,
      // so it still reads as an exhibition rather than a row of thumbnails
      const compact = h <= COMPACT_H;
      const tilt = compact ? -0.12 : -0.22;
      const discR = compact ? Math.min(bandH * 0.42, w * 0.13) : Math.min(bandH * 0.38, w * 0.165);
      const size = compact ? Math.min(bandH * 0.54, w * 0.15) : Math.min(bandH * 0.44, w * 0.18);
      const orbitRx = compact ? Math.min(w * 0.36, w / 2 - size * 0.7) : Math.min(w * 0.4, w / 2 - size * 0.62);
      L = {
        w,
        h,
        phone,
        cx: -w * 0.015,
        cy,
        rx: orbitRx,
        // the tilted ellipse's highest point plus a far sleeve's half height
        // stays inside the band, clear of the title
        ry: Math.min(bandH * 0.24, Math.sqrt(Math.max(0, (bandH / 2 - size * 0.32) ** 2 - (orbitRx * Math.sin(-tilt)) ** 2)) / Math.cos(tilt)),
        tilt,
        depth: 420,
        size,
        disc: { x: -w * 0.015, y: cy, z: 0, size: discR, rx: compact ? 0.38 : 0.5, ry: -0.42, rz: 0, vis: 1, fade: 1 },
        // compact: the record tucks behind the sleeve, as the HTML one does
        discDetail: rec ? still(rec, compact ? -2 : 2, rec.size / 2) : { x: -w * 0.28, y: cy, z: 2, size: h * 0.29, rx: 0, ry: 0, rz: 0, vis: 1, fade: 1 },
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

  // --- the shared phase and the choreography -------------------------------
  let items: OrbitItem[] = [];
  let pending: OrbitItem[] | null = null;
  let phase = 0;
  let target = 0;
  let reported: string | null = null;
  let dragging = false;
  let dragStart = 0;
  // the whole item a wheel gesture began on, while it is under way
  let wheelStart: number | null = null;
  let dirty = 4;
  let open = false;
  // the page's own entrance, separate from opening a record
  const intro = { entry: 0 };
  // off while the page's entry shows (p < 1)
  let inputOn = !opts.held;
  // the values the open/close timelines drive; poses are pure functions of them
  const c = newChoreo();
  const spinClock: SpinClock = { angle: 0, boost: 0 };
  let tl: gsap.core.Timeline | null = null;
  // a finished open or step waits for the orbit to settle on its record
  // before the HTML takes over, so the hand-over is never early
  let arriveDue = false;
  // the HTML half of an open (text, then the title letter by letter), nested
  // in the scene's timeline so the two can never drift apart
  let revealTl: gsap.core.Timeline | null = null;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let idleRate = still?.matches ? 0 : SPIN_IDLE;
  const onStill = () => {
    idleRate = still?.matches ? 0 : SPIN_IDLE;
    dirty = 4;
  };
  still?.addEventListener?.("change", onStill);

  const count = () => items.length;
  const focusIndex = () => (count() ? mod(Math.round(target), count()) : -1);

  // Applies a list now. A surviving focus keeps its id, and a removed one
  // hands over to the nearest survivor. Mid-drag (removals only) the record
  // under the pointer stays under it and the gesture carries on from there.
  function applyItems(next: OrbitItem[]) {
    const prev = items;
    const prevIndex = focusIndex();
    const offset = phase - Math.round(target);
    const fraction = target - Math.round(target);
    items = next;
    const keep = new Set(next.map((i) => i.id));
    for (const [id, s] of sleeves) {
      if (!keep.has(id)) {
        dropSleeve(s);
        sleeves.delete(id);
      }
    }
    // a removed record's image leaves the GPU too, and the label lets it go
    for (const [id, t] of textures) {
      if (keep.has(id)) continue;
      if (labelMat.map === t.tex) {
        labelMat.map = stockTex;
        labelMat.needsUpdate = true;
      }
      t.tex.dispose();
      textures.delete(id);
    }
    for (const item of next) if (!sleeves.has(item.id)) sleeves.set(item.id, makeSleeve(item));
    // the record in front was removed while it stood forward: its successor
    // does not leap into its place; the close that follows starts from here
    const lost = prevIndex >= 0 && !keep.has(prev[prevIndex].id);
    if (lost && c.hero > 0) {
      stopTimeline(false);
      c.hero = 0;
    }
    // a wheel gesture in progress restarts from wherever the list lands
    wheelStart = null;
    if (!next.length) {
      phase = target = 0;
    } else {
      const idx = nextFocusIndex(prev, prevIndex, next);
      if (dragging) {
        // the same whole-step shift for the gesture's start, so a phone
        // swipe still counts its steps from where it began
        dragStart += idx - Math.round(target);
        target = idx + fraction;
      } else target = idx;
      phase = idx + clamp(offset, -0.5, 0.5);
    }
    dirty = 4;
    // mid-drag only a removed focus is reported now; the rest when it settles
    settle(!dragging || !next.some((i) => i.id === reported));
  }

  // one focus report per settled position, never one per frame
  function settle(force = false) {
    if (!count()) {
      reported = null;
      return;
    }
    if (!force && (dragging || wheelStart !== null || Math.abs(target - phase) > 0.02)) return;
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

  // --- timelines: one at a time, each taking over from where the last left off
  function stopTimeline(keepText: boolean) {
    // a record that stays open keeps its text: an interrupted reveal finishes;
    // one that closes gives any split title back as it was
    if (revealTl) {
      if (keepText) revealTl.progress(1);
      (revealTl.data as { revert?: () => void } | undefined)?.revert?.();
    }
    revealTl = null;
    arriveDue = false;
    tl?.kill();
    tl = null;
  }
  function arriveWhenSettled() {
    arriveDue = true;
    dirty = Math.max(dirty, 1);
  }
  function play(next: gsap.core.Timeline) {
    tl = next;
    next.eventCallback("onUpdate", () => (dirty = Math.max(dirty, 1)));
    next.eventCallback("onComplete", () => {
      if (tl === next) tl = null;
      dirty = 4;
    });
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
      if (open || !inputOn || !count() || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (wheelStart === null) wheelStart = Math.round(target);
      target += wheelItems(e);
      dirty = 4;
      // snap once the wheel goes quiet, so a trackpad's glide is never cut off
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        const start = wheelStart;
        wheelStart = null;
        snap(start === null ? undefined : wheelSnap(start, target));
      }, WHEEL_QUIET_MS);
    },
    onPress: () => {
      if (open || !inputOn || !count()) return;
      dragStart = Math.round(target);
    },
    onDragStart: () => {
      if (open || !inputOn || !count()) return;
      dragging = true;
      setHover(null);
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
  function pick(x: number, y: number): THREE.Intersection | undefined {
    ndc.set((x / L.w) * 2 - 1, -(y / L.h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets: THREE.Object3D[] = [face, label];
    for (const s of sleeves.values()) if (s.mesh.group.visible && s.pose.vis > 0.3) targets.push(s.mesh.body);
    return raycaster.intersectObjects(targets, false)[0];
  }
  let down: { x: number; y: number; t: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    if (!d || open || !inputOn || !count()) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return;
    const hit = pick(e.clientX, e.clientY);
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

  // hover: on a desktop pointer the sleeve under it lifts a little
  let hovered: Sleeve | null = null;
  function setHover(next: Sleeve | null) {
    if (next === hovered) return;
    for (const [s, v] of [
      [hovered, 0],
      [next, 1],
    ] as const) {
      if (!s) continue;
      gsap.to(s.lift, { v, duration: v ? 0.32 : 0.45, ease: v ? "power2.out" : "power2.inOut", overwrite: true, onUpdate: () => (dirty = Math.max(dirty, 1)) });
    }
    hovered = next;
    host.style.cursor = next ? "pointer" : "";
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || L.phone || open || !inputOn || dragging || !count()) return setHover(null);
    const id = pick(e.clientX, e.clientY)?.object.userData.id as string | undefined;
    setHover(id ? (sleeves.get(id) ?? null) : null);
  };
  const onLeave = () => setHover(null);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerleave", onLeave);

  // --- per frame -----------------------------------------------------------
  const clock = new THREE.Clock();
  const place = (obj: THREE.Object3D, p: Pose) => {
    obj.position.set(p.x, p.y, p.z);
    obj.rotation.set(p.rx, p.ry, p.rz);
  };

  // where an item at ring offset s sits, given the choreography: the others
  // step aside one after another, the chosen one comes forward to the HTML
  // art frame, and a hovered one lifts
  function sleevePose(s: number, lift: number): Pose {
    const n = count();
    let p = n > 1 ? orbitPose(s) : hiddenPose();
    const focusWeight = clamp(1 - Math.abs(s), 0, 1);
    const aside = local(c.exit, Math.abs(s), c.order) * (1 - focusWeight);
    if (aside > 0 || c.hero > 0) {
      const out: Pose = {
        ...p,
        x: L.cx + (p.x - L.cx) * (1 + 0.85 * aside),
        y: L.cy + (p.y - L.cy) * (1 + 0.25 * aside),
        z: p.z - 90 * aside,
        size: p.size * (1 - 0.25 * aside),
        fade: 1 - 0.6 * aside,
      };
      p = blend(out, L.hero, c.hero * focusWeight);
    }
    if (lift > 0) {
      p.z += 36 * lift;
      p.y += 5 * lift;
      p.size *= 1 + 0.045 * lift;
    }
    const entry = intro.entry;
    p.size *= 0.6 + 0.4 * entry;
    p.y -= (1 - entry) * 30 * (1 + Math.abs(s));
    p.fade *= entry;
    return p;
  }

  // the record: in the middle, tucked into the chosen sleeve, then slid out
  // of it onto the HTML disc frame
  function discPoseFor(hp: Pose | null): Pose {
    let dp: Pose = { ...L.disc };
    if (hp && c.tuck > 0) {
      const tucked: Pose = { x: hp.x, y: hp.y, z: hp.z - 4, size: hp.size * 0.46, rx: hp.rx, ry: hp.ry, rz: hp.rz, vis: 1, fade: 1 };
      dp = blend(dp, tucked, c.tuck);
      if (c.slide > 0) {
        const { out, settle: rest } = slideStages(c.slide);
        const D = L.discDetail;
        // a record that rests in front of the sleeve first clears its edge,
        // so it never passes through the paper
        const front = D.z >= L.hero.z;
        const clearX = front ? Math.max(Math.min(D.x, L.hero.x - L.hero.size / 2 - D.size * 0.98), -L.w / 2 + D.size * 0.8) : D.x;
        const mid: Pose = { x: clearX, y: lerp(hp.y, D.y, 0.5), z: tucked.z, size: D.size, rx: 0, ry: 0, rz: 0, vis: 1, fade: 1 };
        dp = blend(blend(dp, mid, out), D, rest);
        dp.z = lerp(tucked.z, D.z, smooth(0, 0.15, rest));
      }
    }
    const entry = intro.entry;
    dp.y -= (1 - entry) * 40;
    return dp;
  }

  function frame() {
    if (document.hidden) return;
    if (warmFrames > 0) dirty = Math.max(dirty, 1);
    const dt = Math.min(clock.getDelta(), 0.05);
    const prev = phase;
    phase = dampPhase(phase, target, dt);
    let moving = phase !== prev;
    settle();
    if (arriveDue && open && phase === target) {
      arriveDue = false;
      cb.onArrive();
    }

    const n = count();
    const entry = intro.entry;
    const fi = n ? mod(Math.round(phase), n) : -1;

    // the sleeves; ranks give a back-to-front draw order
    const order: Sleeve[] = [];
    let heroPose = null as Pose | null;
    items.forEach((item, i) => {
      const sl = sleeves.get(item.id);
      if (!sl) return;
      const s = n > 1 ? ringDelta(i - phase, n) : 0;
      const cur = sleevePose(s, sl.lift.v);
      sl.pose = cur;
      if (i === fi) heroPose = cur;
      const g = sl.mesh.group;
      const shown = cur.vis > 0.015 && cur.fade > 0.01;
      g.visible = shown;
      sl.shadow.visible = shown;
      if (!shown) return;
      place(g, cur);
      g.scale.setScalar(cur.size);
      // only nearby sleeves fetch their image
      const tex = Math.abs(s) < 4.5 || c.hero > 0 ? artFor(sl) : null;
      const want = tex ?? stockTex;
      if (sl.mesh.artMat.map !== want) {
        sl.mesh.artMat.map = want;
        sl.mesh.artMat.needsUpdate = true;
      }
      sl.mesh.setOpacity(cur.fade);
      const sm = sl.shadowMat;
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
        sm.opacity = 0.2 * cur.fade * cur.vis * (1 - c.hero * 0.8);
      }
      order.push(sl);
    });

    // the record
    const dp = discPoseFor(heroPose);
    Object.assign(discPose, dp);
    place(disc, discPose);
    disc.scale.setScalar(discPose.size * (0.92 + 0.08 * entry));
    // its spin: a slow idle turn plus a boost from the orbit's motion, both
    // time-based; a timeline that lands it upright owns it while it runs
    const idle = idleRate * c.idle;
    if (!gsap.isTweening(spinClock)) {
      const phaseVelocity = dt > 0 ? (phase - prev) / dt : 0;
      Object.assign(spinClock, advanceSpin(spinClock, dt, { idle, phaseVelocity, gain: idleRate ? SPIN_GAIN : 0, response: SPIN_RESPONSE }));
    }
    spin.rotation.z = spinClock.angle + (1 - entry) * 0.8;
    // the phone's opened record is the art alone; the record goes into it
    const discFade = entry * (L.phone ? 1 - smooth(0.35, 0.95, c.tuck) : 1);
    for (const m of discMats) m.opacity = discFade;
    disc.visible = discFade > 0.01;
    if (disc.visible) sheen.update(spin, camera, sunDir, idle + spinClock.boost);
    discShadow.visible = !L.phone;
    discShadow.position.set(discPose.x + discPose.size * 0.1, discPose.y - discPose.size * 1.45, discPose.z - 200);
    discShadow.scale.set(discPose.size * 2.4, discPose.size * 0.42, 1);
    discShadowMat.opacity = 0.2 * entry * (1 - c.hero);
    const labelItem = fi >= 0 ? items[fi] : null;
    const labelTex = labelItem ? artFor({ id: labelItem.id, url: labelItem.image_url }) : null;
    if (labelMat.map !== (labelTex ?? stockTex)) {
      labelMat.map = labelTex ?? stockTex;
      labelMat.needsUpdate = true;
    }

    order.sort((a, b) => a.pose.z - b.pose.z);
    let rank = 1;
    let discRanked = false;
    for (const sl of order) {
      if (!discRanked && sl.pose.z > discPose.z) {
        disc.renderOrder = rank++;
        discRanked = true;
      }
      sl.mesh.group.renderOrder = rank++;
    }
    if (!discRanked) disc.renderOrder = rank;

    // render on demand: only while something moves, or the record turns
    const turning = disc.visible && spinning(spinClock, idle);
    if (moving || turning || dirty > 0 || tl !== null || gsap.isTweening(intro)) {
      renderer.render(scene, camera);
      if (dirty > 0) dirty--;
      if (warmFrames > 0 && --warmFrames === 0) cb.onReady?.();
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

  // --- load gating: textures decode, programs compile, three frames draw ---
  let warmFrames = 0;
  let disposed = false;
  let firstItems = () => {};
  const itemsArrived = new Promise<void>((r) => (firstItems = r));
  const capped = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
  void (async () => {
    await capped(Promise.all(loads), 6000);
    await itemsArrived;
    if (disposed) return;
    // the records nearest the front, which the entrance shows first
    const n = count();
    const near = n ? [0, 1, 2, n - 1, n - 2].filter((i, k, a) => i >= 0 && i < n && a.indexOf(i) === k) : [];
    for (const i of near) artFor({ id: items[i].id, url: items[i].image_url });
    await capped(Promise.all(near.map((i) => textures.get(items[i]?.id)?.settled)), 6000);
    if (disposed) return;
    renderer.compile(scene, camera);
    for (const t of [faceTex, grooveTex, stockTex, frameTex, floorShadow, dropShadow]) renderer.initTexture(t);
    for (const t of textures.values()) if (t.ready) renderer.initTexture(t.tex);
    warmFrames = 3;
  })();

  measure();
  renderer.setAnimationLoop(frame);
  // held: the page's transition drives the entrance (see setEntry())
  const introTween: gsap.core.Tween | null = opts.held ? null : gsap.to(intro, { entry: 1, duration: 0.65, ease: "power2.out", delay: 0.05 });
  if (opts.held) observer.disable();

  return {
    setItems(next) {
      if (next.length) firstItems();
      // a removal applies now, even under a pointer; arrivals and reordering
      // wait for the gesture to end, and only the latest list is queued
      const m = mergeOrbitItems(items, next, dragging);
      pending = m.queued;
      if (m.now !== items) applyItems(m.now);
    },
    setOpen(value) {
      if (open === value) return;
      open = value;
      stopTimeline(false);
      if (value) {
        observer.disable();
        clearTimeout(wheelTimer);
        wheelStart = null;
        setHover(null);
        snap();
        const next = openTimeline(c, spinClock, { phone: L.phone });
        const reveal = cb.reveal?.() ?? null;
        if (reveal) {
          // the text comes in as the record lands, the title last
          next.add(reveal, "land");
          revealTl = reveal;
        }
        // at the timeline's end the WebGL sleeve and record rest exactly on
        // the HTML frames, and the title has finished: hand over
        next.call(arriveWhenSettled, undefined, ">");
        play(next);
      } else {
        if (inputOn) observer.enable();
        const next = closeTimeline(c);
        next.call(() => cb.onHandBack(), undefined, 0.35);
        play(next);
      }
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
      if (!open) return;
      // inside an open record: the orbit carries the next sleeve forward and
      // the record turns once to rest upright, then the HTML takes over again
      stopTimeline(true);
      const next = stepTimeline(c, spinClock, { phone: L.phone });
      next.call(arriveWhenSettled, undefined, ">");
      play(next);
    },
    setInput(enabled) {
      if (inputOn === enabled) return;
      inputOn = enabled;
      if (enabled && !open) observer.enable();
      if (!enabled) {
        observer.disable();
        clearTimeout(wheelTimer);
        if (wheelStart !== null || dragging) {
          wheelStart = null;
          dragging = false;
          snap();
        }
        setHover(null);
      }
    },
    setEntry(value) {
      introTween?.kill();
      intro.entry = clamp(value, 0, 1);
      dirty = Math.max(dirty, 2);
    },
    atRest() {
      return !dragging && wheelStart === null && phase === target;
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      stopTimeline(false);
      introTween?.kill();
      gsap.killTweensOf(intro);
      gsap.killTweensOf(spinClock);
      clearTimeout(wheelTimer);
      observer.kill();
      resize.disconnect();
      still?.removeEventListener?.("change", onStill);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisible);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      for (const s of sleeves.values()) dropSleeve(s);
      sleeves.clear();
      kit.dispose();
      for (const t of textures.values()) t.tex.dispose();
      textures.clear();
      for (const m of [...discMats, discShadowMat]) m.dispose();
      for (const t of [faceTex, grooveTex, stockTex, frameTex, floorShadow, dropShadow]) t.dispose();
      for (const g of [unitPlane, unitCircle, rim.geometry]) g.dispose();
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
