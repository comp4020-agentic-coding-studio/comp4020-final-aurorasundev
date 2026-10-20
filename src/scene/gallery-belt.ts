import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gsap } from "gsap";
import { Observer } from "gsap/Observer";
import { beltCards, beltPoint, cardFrame, cardPlacement, CAMERA_HALF, DISC_YAW, dissolveAt, FACE_EDGE, FACE_WINDOW, fitBelt, globeAngle, GLOBE_OPEN, halfOf, LABEL_OF_DISC, ringSize, RING_DESKTOP, swipeTarget, type Fit } from "./belt-layout.ts";
import { createBeltGlobe } from "./belt-globe.ts";
import { mergeOrbitItems, nextFocusIndex, type OrbitItem } from "./orbit-items.ts";
import { advanceSpin, dampPhase, spinning, tumbleAt, wheelItems, wheelSnap, SPIN_GAIN, SPIN_IDLE, SPIN_RESPONSE, WHEEL_QUIET_MS } from "./gallery-motion.ts";
import { cardRitual, closeTimeline, newChoreo, newSwap, openTimeline, pruneSwap, retarget, shiftSwap, discSlide, stepTimeline, type SpinClock } from "./record-timeline.ts";
import { createSleeveKit, FRAME_PLATE, SLEEVE_FRONT, type SleeveMesh } from "./sleeve-kit.ts";
import { applyVinylSheen } from "./vinyl-sheen.ts";
import { createCardParticles } from "./card-particles.ts";
import { driftSign, fastTurn, GATHER_SECONDS, hideStart, HIDE_SECONDS, IMAGE_FADE_SECONDS, imageShown, meshAlpha, particleAlpha, planExit, planParticles, rimPulse, rimU, zoneMode, type Candidate, type ExitSlot, type Mode, type Render } from "./particles-plan.ts";

// The Gallery's record exhibition as a belt round a globe (design 2026-10-19
// §4): an orthographic view of a flattened sphere drawn in graphite thread
// that counter-rotates against a belt of square sleeves on its equator, with
// the charcoal record in front of the globe at the centre. Back to front: the
// globe's lines, the belt's far half (dimmed, fading toward the back), the
// record, the belt's near half (passing across the record's lower edge).
//
// Everything moves from one shared phase, as in the orbit before it: input
// changes a target, one ticker damps toward it (the only damping), and a
// settled gesture reports a focused id once. Card m sits at azimuth
// (m - phase)·step and shows record m mod n of the 48-record window, so
// turning on wraps through the whole window; a card changes record only at
// the very back. Opening and closing are the record-timeline.ts timelines;
// every pose is a pure function of the phase and those values. Per-frame
// state stays here, never in React. Text is HTML; only the generated images
// and the fixed materials in /textures/gallery/ are drawn.
//
// Particles (step ③): each card carries `dissolve` (0 solid .. 1 fully
// dispersed). Where the band rounds the globe's sides (belt-layout.ts
// dissolveZones) a slowly turning card breaks into grain that drifts back
// along the band, and a card coming round gathers from it; a fast turn, an
// exhausted budget or reduced motion uses the plain alpha fade instead
// (particles-plan.ts decides; card-particles.ts draws). A card shows its
// image only in front of the zone's peak, so a record that changed at the
// back first appears by gathering in the arriving zone. An operator hide
// leaves a ghost that breaks up in place.
//
// Opening a record (step ④, design §5) uses the same particle path: the other
// front-half cards break into grain one after another, nearest the focus
// first, drifting back along the band (particles-plan.ts planExit picks who
// gets a slot; the rest, and the far half's silhouettes, fade); the sleeve
// comes forward to the HTML art frame and the record slides out of it. A
// close gathers them back. An arrow inside an open record moves the hero
// frame to the next place (record-timeline.ts retarget): the outgoing sleeve
// breaks up in place in the frame while the incoming one gathers there, and
// the belt behind turns with everything else still dispersed. Every value is
// a function of the shared choreography, so any timeline can replace any
// other from where it stands.
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
  // an optional slow idle turn of the globe's meridians, radians per second
  // (0, the default, keeps every rest pose the same composition)
  drift?: number;
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
// The page lays out three HTML boxes the scene follows: the browsing band,
// and where the opened record's square art and disc sit (G02), so the WebGL
// objects arrive exactly where the HTML record takes over.
// `backdrop` (optional) is the opened record's mineral surface, an HTML layer
// behind the scene's canvas and above the stage plate: the open's timeline
// fades it in (record-timeline.ts `backdrop`) and the close fades it out.
export type OrbitFrame = { band: HTMLElement; art: HTMLElement; disc: HTMLElement; backdrop?: HTMLElement | null };

const TEX = "/textures/gallery/";
const MAX_TEXTURES = 14;
// the opened record's depth: in front of everything on the belt
const HERO_Z = 8;
// the record face's albedo scale (linear), against its texture's own charcoal
const VINYL_ALBEDO = 0.11;
// Tucked into the sleeve on a desktop, the record rests this far (of the
// sleeve's width) out toward where it will slide, so it shows half out of
// the sleeve, its label's edge peeking, while it turns once there
const TUCK_OUT = 0.44;

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

type Pose = { x: number; y: number; z: number; size: number; q: THREE.Quaternion; fade: number; tone: number };
const IDENTITY = new THREE.Quaternion();
function blend(a: Pose, b: Pose, t: number): Pose {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    size: lerp(a.size, b.size, t),
    q: a.q.clone().slerp(b.q, t),
    fade: lerp(a.fade, b.fade, t),
    tone: lerp(a.tone, b.tone, t),
  };
}

type Layout = Fit & {
  w: number;
  h: number;
  disc: Fit["disc"] & { q: THREE.Quaternion };
  hero: Pose;
  discDetail: Pose;
};

// One card of the ring: a pooled sleeve that shows whichever record its
// place on the belt holds now.
type Card = {
  slot: number;
  mesh: SleeveMesh;
  // the belt position it holds this frame (null: not on the ring)
  m: number | null;
  id: string | null;
  theta: number;
  pose: Pose | null;
  // 0 whole .. 1 gone: max of the dissolve zone, the open's ritual and a
  // caller's request; drawn as particles within the budget, else alpha
  dissolve: number;
  // the pointer's hover lift, 0..1, eased by its own small tween
  lift: { v: number };
  // each material's own colour, so the depth tone can dim it
  base: THREE.Color[];
  // where the dissolve came from this frame: the zone, and the open's ritual
  // (record-timeline.ts cardRitual: the exit, or the hero frame's swap)
  zone: number;
  // the part of `zone` from crossing the record's rim (in place, not along
  // the band)
  rim: number;
  ritual: number;
  ritualMode: Mode;
  // whether the ritual's dissolve may take a particle slot (planExit)
  ritualParticles: boolean;
  // it sits (partly) in the hero frame: its image shows wherever its place is
  framed: boolean;
  ritualWeight: number;
  // A caller's own dissolve (the re-gather in a hidden record's place): tween
  // `v` 0..1 with gsap and set `mode`. While `v` > 0 the card dissolves by
  // max(zone, ritual, v) and takes a particle slot ahead of zone cards. Null
  // when unused.
  request: { v: number; mode: Mode } | null;
  // the particle bookkeeping
  render: Render;
  mode: Mode;
  prevTheta: number;
  prevM: number | null;
  // the image's fade-in (a late decode fades in over blank stock)
  image: { tex: THREE.Texture | null; mix: number; waiting: boolean };
  seed: number;
  // its record was hidden while it showed: the next record in its place
  // gathers in
  gatherNext: boolean;
};

// A hidden record's last pose, breaking up in place; it holds its texture
// until it has fully dispersed.
type Ghost = {
  pose: Pose;
  tangent: THREE.Vector3;
  tex: THREE.Texture | null;
  // whether the ghost owns the texture (it left the LRU with the hide)
  owns: boolean;
  d: number;
  seed: number;
  rank: number;
};

export function createGalleryBelt(host: HTMLElement, frames: OrbitFrame, cb: OrbitCallbacks, opts: OrbitOptions = {}): GalleryOrbit {
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
  const sunDir = sun.position.clone().normalize();

  // Orthographic, as in the reference: the belt neither bulges nor steepens,
  // and the globe's ellipses stay exact. Half-height CAMERA_HALF world units.
  const camera = new THREE.OrthographicCamera(-CAMERA_HALF, CAMERA_HALF, CAMERA_HALF, -CAMERA_HALF, 0.1, 100);
  camera.position.set(0, 0, 40);

  // --- fixed materials, decoded once ---------------------------------------
  const loader = new THREE.TextureLoader();
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

  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const unitCircle = new THREE.CircleGeometry(1, 96);

  // --- the globe -----------------------------------------------------------
  const globe = createBeltGlobe();
  const globeRoot = new THREE.Group();
  globeRoot.add(globe.group);
  globe.group.traverse((o) => (o.renderOrder = -100));
  scene.add(globeRoot);

  // --- the record ----------------------------------------------------------
  const disc = new THREE.Group();
  const spin = new THREE.Group();
  disc.add(spin);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x161615, roughness: 0.7, envMapIntensity: 0.15, transparent: true });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.012, 128, 1, true), rimMat);
  rim.rotation.x = Math.PI / 2;
  const labelMat = new THREE.MeshBasicMaterial({ map: stockTex, transparent: true });
  const label = new THREE.Mesh(unitCircle, labelMat);
  label.scale.setScalar(LABEL_OF_DISC);
  label.position.z = -0.002;
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x22221f, transparent: true });
  const hole = new THREE.Mesh(unitCircle, holeMat);
  hole.scale.setScalar(0.03);
  hole.position.z = 0.001;
  // Deep matte charcoal (owner, 2026-10-19): the face plate's own charcoal
  // is about sRGB 85, and under the scene's hemisphere, sun and room
  // environment it read mid-grey. Its albedo is scaled down to a near-black
  // base (about #181817 lit), rougher and with little environment, so the
  // grooves stay dark and only the sheen's narrow band catches the light.
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex,
    color: new THREE.Color(VINYL_ALBEDO, VINYL_ALBEDO, VINYL_ALBEDO),
    bumpMap: grooveTex,
    bumpScale: 0.35,
    roughness: 0.82,
    metalness: 0,
    envMapIntensity: 0.04,
    transparent: true,
    alphaTest: 0.01,
  });
  const sheen = applyVinylSheen(faceMat, { inner: FACE_WINDOW, outer: FACE_EDGE });
  const face = new THREE.Mesh(unitPlane, faceMat);
  face.scale.setScalar(2 / FACE_EDGE);
  face.position.z = 0.003;
  spin.add(rim, label, hole, face);
  scene.add(disc);
  const discParts: THREE.Object3D[] = [rim, label, hole, face];
  const discMats: THREE.Material[] = [rimMat, labelMat, holeMat, faceMat];

  // --- images: a bounded LRU on the GPU --------------------------------------
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
      // a hidden or missing image keeps the blank stock
      () => settle(),
    );
    entry.tex.colorSpace = THREE.SRGBColorSpace;
    entry.tex.anisotropy = maxAniso;
    textures.set(item.id, entry);
    if (textures.size > MAX_TEXTURES) {
      // a texture still drawn (a card's image, possibly mid-dissolve, or a
      // hide's ghost) is never evicted while it shows
      const live = new Set<THREE.Texture>();
      for (const card of cards) if (card.image.tex) live.add(card.image.tex);
      for (const g of ghosts) if (g.tex) live.add(g.tex);
      let oldest: string | null = null;
      for (const [id, t] of textures) if (!live.has(t.tex) && (!oldest || t.used < textures.get(oldest)!.used)) oldest = id;
      if (oldest && oldest !== item.id) {
        textures.get(oldest)!.tex.dispose();
        textures.delete(oldest);
      }
    }
    return null;
  }

  // --- the ring's pooled cards -------------------------------------------------
  const kit = createSleeveKit(stockTex, frameTex);
  const cards: Card[] = [];
  for (let slot = 0; slot < RING_DESKTOP; slot++) {
    const mesh = kit.make();
    mesh.body.userData.slot = slot;
    mesh.group.visible = false;
    scene.add(mesh.group);
    const base = mesh.mats.map((m) => (m as THREE.MeshStandardMaterial).color.clone());
    cards.push({
      slot,
      mesh,
      m: null,
      id: null,
      theta: 0,
      pose: null,
      dissolve: 0,
      lift: { v: 0 },
      base,
      zone: 0,
      rim: 0,
      ritual: 0,
      ritualMode: "leave",
      ritualParticles: false,
      framed: false,
      ritualWeight: 0,
      request: null,
      render: "mesh",
      mode: "leave",
      prevTheta: 0,
      prevM: null,
      image: { tex: null, mix: 1, waiting: false },
      seed: (slot * 0.618034) % 1,
      gatherNext: false,
    });
  }

  // --- the shared particle system and the hides' ghosts --------------------
  // the sleeve's paper, for the grain outside the image
  const paper = new THREE.Color(0xe6dccb);
  const grain = createCardParticles(scene, stockTex, paper);
  const ghosts: Ghost[] = [];
  let ghostSeed = 0;
  let fast = false;
  const inParticles = new Set<string>();
  const cardKey = (card: Card) => `c${card.m}`;
  // A per-card dissolve outside the ritual (a newcomer gathering in a hidden
  // record's place). Tweens the card's own dissolve to `to` (1 dispersed, 0
  // solid) with the given drift mode; the frame loop draws it as particles
  // within the budget (alpha under reduced motion or past the budget).
  // Returns the tween; the request clears itself at 0.
  function dissolveCard(card: Card, to: number, mode: Mode, vars: gsap.TweenVars = {}): gsap.core.Tween {
    const req = card.request ?? (card.request = { v: 0, mode });
    req.mode = mode;
    return gsap.to(req, {
      v: to,
      duration: 0.7,
      ease: to > req.v ? "power1.in" : "power2.out",
      overwrite: true,
      ...vars,
      onUpdate: () => (dirty = Math.max(dirty, 1)),
      onComplete: () => {
        if (req.v <= 0 && card.request === req) card.request = null;
        dirty = Math.max(dirty, 2);
      },
    });
  }
  const ghostKey = (i: number) => `g${i}`;

  // --- layout from the viewport and the HTML frames ------------------------
  let L: Layout;
  function measure() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, w <= 600 ? 1.25 : 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
    const aspect = w / h;
    camera.left = -CAMERA_HALF * aspect;
    camera.right = CAMERA_HALF * aspect;
    camera.top = CAMERA_HALF;
    camera.bottom = -CAMERA_HALF;
    camera.updateProjectionMatrix();
    globe.setResolution(w, h, dpr);

    const r = band.getBoundingClientRect();
    const fit = fitBelt({ w, h, bandTop: r.height > 0 ? r.top : h * 0.16, bandH: r.height > 0 ? r.height : h * 0.66 });
    const k = fit.k;
    const toY = (cssY: number) => (h / 2 - cssY) * k;
    const box = (el: HTMLElement) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 ? { x: (b.left + b.width / 2 - w / 2) * k, y: toY(b.top + b.height / 2), size: b.width * k } : null;
    };
    const art = box(frames.art);
    const rec = box(frames.disc);
    const still = (x: number, y: number, z: number, size: number): Pose => ({ x, y, z, size, q: IDENTITY.clone(), fade: 1, tone: 1 });
    L = {
      ...fit,
      w,
      h,
      disc: { ...fit.disc, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-fit.disc.tilt, fit.phone ? 0 : -DISC_YAW, 0)) },
      hero: art ? still(art.x, art.y, HERO_Z, art.size) : still(0, fit.cy, HERO_Z, fit.card * fit.S * 1.4),
      // compact: the record tucks behind the sleeve, as the HTML one does
      discDetail: rec ? still(rec.x, rec.y, HERO_Z + (fit.compact ? -0.05 : 0.05), rec.size / 2) : still(-w * k * 0.28, fit.cy, HERO_Z + 0.05, h * k * 0.29),
    };
    globeRoot.position.set(L.cx, L.cy, 0);
    globeRoot.scale.setScalar(L.S);
    globe.setScale(L.S);
    grain.setScreen(L.k, dpr, L.phone);
    dirty = 4;
  }

  // --- the shared phase and the choreography -------------------------------
  let items: OrbitItem[] = [];
  let pending: OrbitItem[] | null = null;
  let phase = 0;
  let target = 0;
  let reported: string | null = null;
  let dragging = false;
  let dragStart = 0;
  let dragDx = 0;
  // the whole item a wheel gesture began on, while it is under way
  let wheelStart: number | null = null;
  let dirty = 4;
  let open = false;
  const intro = { entry: 0 };
  let inputOn = !opts.held;
  const c = newChoreo();
  // the hero frame: the belt place whose sleeve comes forward on an open, and
  // the sleeves swapping in it on a step (record-timeline.ts)
  const swap = newSwap();
  let heroM = 0;
  // the open's exit order and particle slots, per ring size and device
  let exits: Map<number, ExitSlot> = new Map();
  let exitsFor = "";
  // the timeline playing is a close: the ritual's cards gather back
  let closing = false;
  const spinClock: SpinClock = { angle: 0, boost: 0 };
  let tl: gsap.core.Timeline | null = null;
  let arriveDue = false;
  let revealTl: gsap.core.Timeline | null = null;
  // the globe stops counter-rotating while a record is open: it holds the
  // angle of the record that opened and catches up again as it closes
  let heldGlobe = 0;
  let drift = 0;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let idleRate = still?.matches ? 0 : SPIN_IDLE;
  let driftRate = still?.matches ? 0 : (opts.drift ?? 0);
  const onStill = () => {
    idleRate = still?.matches ? 0 : SPIN_IDLE;
    driftRate = still?.matches ? 0 : (opts.drift ?? 0);
    dirty = 4;
  };
  still?.addEventListener?.("change", onStill);
  const reduced = () => !!still?.matches;
  // the record's tumble clock (held under reduced motion)
  let tumbleT = 0;
  const tumbleQ = new THREE.Quaternion();
  const tumbleE = new THREE.Euler();
  let backdropShown = -1;

  // the band's direction toward the back at θ, in world space
  const tangentAt = (theta: number, out: THREE.Vector3) => {
    const h = 1e-3;
    const a = beltPoint(theta - h);
    const b = beltPoint(theta + h);
    return out.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize().multiplyScalar(driftSign(theta));
  };

  const count = () => items.length;
  const ring = () => ringSize(L.phone, count());
  const focusIndex = () => (count() ? mod(Math.round(target), count()) : -1);

  function applyItems(next: OrbitItem[]) {
    const prev = items;
    const prevIndex = focusIndex();
    const offset = phase - Math.round(target);
    const fraction = target - Math.round(target);
    items = next;
    const keep = new Set(next.map((i) => i.id));
    // a removed record's card breaks up where it is, at once, holding its
    // texture until it has dispersed (reduced motion: it simply leaves)
    const held = new Set<THREE.Texture>();
    for (const card of cards) {
      if (!card.id || keep.has(card.id) || !card.pose) continue;
      const shown = card.mesh.group.visible || card.render === "particles";
      if (!shown || reduced()) continue;
      const tex = card.image.tex;
      if (tex) held.add(tex);
      ghosts.push({
        pose: { ...card.pose, q: card.pose.q.clone(), fade: card.pose.fade * (card.render === "alpha" ? 1 - card.dissolve : 1) },
        tangent: tangentAt(card.theta, new THREE.Vector3()),
        tex,
        owns: false,
        d: hideStart(card.render === "particles" ? card.dissolve : 0),
        seed: (ghostSeed++ * 0.377) % 1,
        rank: 0,
      });
    }
    for (const [id, t] of textures) {
      if (keep.has(id)) continue;
      if (labelMat.map === t.tex) {
        labelMat.map = stockTex;
        labelMat.needsUpdate = true;
      }
      for (const card of cards) {
        if (card.mesh.artMat.map === t.tex) {
          card.mesh.artMat.map = stockTex;
          card.mesh.artMat.needsUpdate = true;
        }
      }
      textures.delete(id);
      const ghost = ghosts.find((g) => g.tex === t.tex);
      if (ghost && held.has(t.tex)) ghost.owns = true;
      else t.tex.dispose();
    }
    // a removed record's card leaves at once, wherever it is (its ghost,
    // above, carries on in its place)
    for (const card of cards) {
      if (card.id && !keep.has(card.id)) {
        // its place is kept (prevM), so whichever record shifts into it
        // gathers in place over the ghost; until then the mesh is hidden
        card.id = null;
        card.m = null;
        card.render = "mesh";
        card.image.tex = null;
        card.mesh.group.visible = false;
        card.gatherNext = !reduced();
        if (hovered === card) setHover(null);
      }
    }
    const lost = prevIndex >= 0 && !keep.has(prev[prevIndex].id);
    if (lost && c.hero > 0) {
      // the open record was hidden: its ghost breaks up in the hero frame,
      // and whichever record shifts into its place gathers in on the belt
      // with the close the page now asks for (no sleeve is left half-swapped)
      const wasClosing = closing;
      stopTimeline(false);
      c.hero = 0;
      swap.outgoing.length = 0;
      swap.incoming.v = reduced() ? 0 : 1;
      // hidden mid-close: the page is not going to ask again, so the close
      // carries on from here and still hands back once everything gathers
      if (wasClosing && !open) startClose();
    }
    wheelStart = null;
    const fromPlace = Math.round(target);
    if (!next.length) {
      phase = target = 0;
      heroM = 0;
      swap.outgoing.length = 0;
    } else {
      const idx = nextFocusIndex(prev, prevIndex, next);
      // every belt place moves by the same whole step, the hero frame's too
      heroM += idx - fromPlace;
      shiftSwap(swap, idx - fromPlace);
      if (dragging) {
        dragStart += idx - Math.round(target);
        target = idx + fraction;
      } else target = idx;
      phase = idx + clamp(offset, -0.5, 0.5);
    }
    // the globe's angle is a function of the phase; a whole-step jump here
    // lands on the same composition (globeSpin is snapped)
    dirty = 4;
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

  function stopTimeline(keepText: boolean) {
    if (revealTl) {
      if (keepText) revealTl.progress(1);
      (revealTl.data as { revert?: () => void } | undefined)?.revert?.();
    }
    revealTl = null;
    arriveDue = false;
    tl?.kill();
    tl = null;
    closing = false;
  }
  // the hero frame moves to belt place `m` (record-timeline.ts retarget); the
  // incoming sleeve gathers from wherever its own exit has it now
  function moveHero(m: number): number {
    return retarget(swap, c, heroM, m, cardRitual(m, heroM, c, swap, exits, closing).dissolve);
  }
  // the close; its hand back is its last beat, once every card has gathered
  function startClose() {
    const next = closeTimeline(c, swap, () => {
      if (tl === next) cb.onHandBack();
    });
    play(next, true);
  }
  function arriveWhenSettled() {
    arriveDue = true;
    dirty = Math.max(dirty, 1);
  }
  // Play one ritual timeline. Only the current one may finish anything: a
  // killed or replaced timeline never calls back, so a stale arrival or hand
  // back cannot reach the page.
  function play(next: gsap.core.Timeline, isClose = false) {
    tl = next;
    closing = isClose;
    next.eventCallback("onUpdate", () => (dirty = Math.max(dirty, 1)));
    next.eventCallback("onComplete", () => {
      if (tl === next) {
        tl = null;
        closing = false;
      }
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
      if (open || !inputOn || !count() || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (wheelStart === null) wheelStart = Math.round(target);
      target += wheelItems(e);
      dirty = 4;
      // snap once the wheel goes quiet, so a trackpad's glide is never cut
      // off; a hard flick may cross several cards, with no cap
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
      dragDx = 0;
    },
    onDragStart: () => {
      if (open || !inputOn || !count()) return;
      dragging = true;
      setHover(null);
    },
    onDrag: (self) => {
      if (!dragging) return;
      dragDx += self.deltaX;
      target -= self.deltaX / pxPerItem();
      dirty = 4;
    },
    onDragEnd: (self) => {
      if (!dragging) return;
      dragging = false;
      if (L.phone) {
        // a swipe ignores how far it went: exactly one step from where it began
        snap(swipeTarget(dragStart, dragDx, self.velocityX));
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

  // a click (not a drag) opens the record, or turns a card to the front
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickable = (card: Card) => card.m !== null && card.mesh.group.visible && card.pose !== null && halfOf(card.theta) === "front" && card.pose.fade * (1 - card.dissolve) > 0.5;
  function pick(x: number, y: number): THREE.Intersection | undefined {
    ndc.set((x / L.w) * 2 - 1, -(y / L.h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets: THREE.Object3D[] = [];
    for (const card of cards) if (pickable(card)) targets.push(card.mesh.body);
    if (disc.visible) targets.push(face, label);
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
    const slot = hit.object.userData.slot as number | undefined;
    const front = Math.round(target);
    const card = slot === undefined ? null : cards[slot];
    // the record, or the card in front: open it
    if (!card || card.m === front) {
      if (Math.abs(target - phase) < 0.3) cb.onOpen(items[focusIndex()].id);
      return;
    }
    if (card.m !== null) snap(card.m);
  };
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointerup", onUp);

  // hover: on a desktop pointer a front-half card lifts a little
  let hovered: Card | null = null;
  function setHover(next: Card | null) {
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
    const hit = pick(e.clientX, e.clientY);
    const slot = hit?.object.userData.slot as number | undefined;
    setHover(slot === undefined ? null : cards[slot]);
    if (slot === undefined && hit) host.style.cursor = "pointer";
  };
  const onLeave = () => setHover(null);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerleave", onLeave);

  // --- poses -----------------------------------------------------------------
  const basis = new THREE.Matrix4();
  const vRight = new THREE.Vector3();
  const vUp = new THREE.Vector3();
  const vFace = new THREE.Vector3();

  // where the card at azimuth θ sits on the belt: on the curve, facing out
  // along the surface (the far half turns its face to us, through the globe),
  // smaller and dimmer with depth since an orthographic view has no falloff;
  // the far half a faint silhouette near the globe's sides (cardPlacement)
  function beltPose(theta: number): Pose {
    const f = cardFrame(theta);
    const facing = Math.cos(theta) >= 0 ? 1 : -1;
    vUp.set(f.up.x, f.up.y, f.up.z);
    vFace.set(f.out.x * facing, f.out.y * facing, f.out.z * facing);
    vRight.crossVectors(vUp, vFace);
    basis.makeBasis(vRight, vUp, vFace);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    const at = cardPlacement(theta, L.phone);
    return {
      x: L.cx + f.p.x * L.S,
      y: L.cy + f.p.y * L.S,
      z: f.p.z * L.S,
      size: L.card * L.S * at.scale,
      q,
      fade: at.fade,
      tone: at.tone,
    };
  }

  // the card at belt place m, given the choreography: the others break up
  // one after another (record-timeline.ts cardRitual), the hero frame's
  // sleeve comes forward to the HTML art frame (and, on a step, swaps there
  // in place), a hovered one lifts, and the page's entrance gathers them
  // from the front
  function cardPose(card: Card, s: number, m: number): Pose {
    let p = beltPose(card.theta);
    const rit = cardRitual(m, heroM, c, swap, exits, closing);
    card.zone = dissolveAt(card.theta, L.phone);
    // crossing the record's rim: a brief in-place pulse, only while browsing
    // at rest from any open (revision two; particles-plan.ts rimPulse)
    const browsing = !open && c.hero <= 0.001 && c.exit <= 0.001 && c.tuck <= 0.001 && intro.entry >= 0.999 && !reduced();
    card.rim = rimPulse(rimU(card.theta, L), card.theta, browsing);
    card.zone = Math.max(card.zone, card.rim);
    if (rit.heroW > 0) {
      // in the frame, the belt's zone no longer applies
      p = blend(p, L.hero, rit.heroW);
      card.zone *= 1 - rit.heroW;
    }
    card.ritual = rit.dissolve;
    card.ritualMode = rit.mode;
    card.ritualParticles = rit.particles;
    card.framed = rit.heroW > 0;
    card.ritualWeight = rit.weight;
    card.dissolve = Math.max(card.zone, rit.dissolve, card.request?.v ?? 0);
    const lift = card.lift.v;
    if (lift > 0) {
      p.y += 0.05 * p.size * lift;
      p.z += 0.2 * lift;
      p.size *= 1 + 0.045 * lift;
    }
    // the entrance: the cards gather one by one from the front outward
    const g = smooth(0.35 + 0.05 * Math.min(Math.abs(s), 5), 0.75 + 0.05 * Math.min(Math.abs(s), 5), intro.entry);
    p.size *= 0.85 + 0.15 * g;
    p.fade *= g;
    return p;
  }

  // the record: at the centre, tucked into the chosen sleeve, then slid out
  // of it onto the HTML disc frame
  function discPoseFor(hp: Pose | null): Pose {
    let dp: Pose = { x: L.disc.x, y: L.disc.y, z: 0, size: L.disc.r, q: L.disc.q.clone(), fade: 1, tone: 1 };
    if (hp && c.tuck > 0) {
      // half out of the sleeve on the side it will slide toward (a phone's
      // stays wholly inside, and fades)
      const out = L.phone ? 0 : Math.sign(L.discDetail.x - L.hero.x || -1) * TUCK_OUT * hp.size;
      const tucked: Pose = { x: hp.x + out, y: hp.y, z: hp.z - 0.05, size: hp.size * 0.46, q: hp.q.clone(), fade: 1, tone: 1 };
      dp = blend(dp, tucked, c.tuck);
      if (c.slide > 0) {
        // out past the sleeve's edge behind it, then in front of it and back
        // over the edge to the HTML disc frame (record-timeline.ts discSlide)
        const D = L.discDetail;
        const restInFront = D.z >= L.hero.z;
        const sp = discSlide(c.slide, {
          tucked: { x: tucked.x, y: tucked.y, r: tucked.size },
          rest: { x: D.x, y: D.y, r: D.size },
          sleeve: { x: hp.x, y: hp.y, half: (hp.size * FRAME_PLATE) / 2 },
          restInFront,
          screenEdge: Math.sign(D.x - hp.x || -1) * ((L.w * L.k) / 2),
        });
        // in front: past the sleeve's front face and paper frame, so the
        // depth test agrees with the draw order
        const frontZ = hp.z + hp.size * SLEEVE_FRONT + 0.02;
        dp = { x: sp.x, y: sp.y, z: sp.inFront ? Math.max(frontZ, D.z) : restInFront ? tucked.z : lerp(tucked.z, D.z, sp.settle), size: sp.r, q: hp.q.clone().slerp(IDENTITY, sp.turn), fade: 1, tone: 1 };
      }
    }
    // the entrance: the record rises from the centre and tilts to rest
    const e = smooth(0.15, 0.7, intro.entry);
    dp.y -= (1 - e) * 0.35 * L.disc.r;
    if (e < 1) dp.q = IDENTITY.clone().slerp(dp.q, e);
    return dp;
  }

  const vTan = new THREE.Vector3();
  const vPos = new THREE.Vector3();
  const frontnessOf = (theta: number) => (Math.cos(theta) + 1) / 2;
  function drawGrain(p: Pose, tangent: THREE.Vector3, dissolve: number, mode: Mode, alpha: number, image: THREE.Texture | null, imageMix: number, renderOrder: number, seed: number) {
    grain.draw({
      position: vPos.set(p.x, p.y, p.z),
      quaternion: p.q,
      size: p.size,
      dissolve,
      mode,
      tangent,
      alpha,
      tone: p.tone,
      image,
      imageMix,
      renderOrder,
      seed,
    });
  }

  function tint(card: Card, tone: number) {
    card.mesh.mats.forEach((m, i) => {
      (m as THREE.MeshStandardMaterial).color.copy(card.base[i]).multiplyScalar(tone);
    });
  }

  // --- per frame -----------------------------------------------------------
  const clock = new THREE.Clock();
  function frame() {
    if (document.hidden) return;
    if (warmFrames > 0) dirty = Math.max(dirty, 1);
    const dt = Math.min(clock.getDelta(), 0.05);
    const prev = phase;
    phase = dampPhase(phase, target, dt);
    const moving = phase !== prev;
    settle();
    if (arriveDue && open && phase === target) {
      arriveDue = false;
      cb.onArrive();
    }

    const n = count();
    const R = ring();
    const entry = intro.entry;
    const fi = n ? mod(Math.round(phase), n) : -1;

    // the globe: counter-rotates against the belt, held while a record is
    // open, and draws in from the poles on the page's entrance
    const live = R ? globeAngle(phase, R) : 0;
    if (driftRate) drift += driftRate * dt * (1 - c.hero);
    globe.spin.rotation.y = lerp(live, heldGlobe, c.hero) + drift;
    globe.setDraw(smooth(0, 0.5, entry));
    globe.setOpacity(lerp(1, GLOBE_OPEN, c.hero));

    // the open's exit order for this ring (recomputed only when it changes)
    const ef = `${R}:${L.phone}`;
    if (ef !== exitsFor) {
      exits = planExit(R, L.phone);
      exitsFor = ef;
    }
    // with nothing of an open showing, the hero frame follows the focus
    pruneSwap(swap);
    if (!open && c.hero <= 0.001 && c.exit <= 0.001 && c.tuck <= 0.001 && swap.incoming.v <= 0.001 && !swap.outgoing.length) heroM = Math.round(target);

    // the ring's cards
    const placed = n ? beltCards(phase, R, n) : [];
    // a fast turn draws the zones as the plain alpha fade (with hysteresis)
    fast = fastTurn(dt > 0 ? (phase - prev) / dt : 0, fast);
    const used = new Set<number>();
    const order: Card[] = [];
    const cands: Candidate[] = [];
    let heroPose: Pose | null = null;
    for (const bc of placed) {
      const card = cards[mod(bc.m, R)];
      used.add(card.slot);
      const item = items[bc.index];
      if (card.prevM !== bc.m || card.id !== item.id) {
        // A different record in the same place while it showed (a hide or a
        // retirement shifted the list): it gathers in place from grain, so
        // the hidden record's dispersal reads and the newcomer never pops in.
        // Once per change, never per frame; reduced motion just swaps.
        if (card.prevM === bc.m && ((card.id !== null && card.mesh.group.visible) || card.gatherNext) && !reduced()) {
          const req = card.request ?? (card.request = { v: 0, mode: "inplace" });
          req.v = 1;
          dissolveCard(card, 0, "inplace", { duration: GATHER_SECONDS, delay: 0.25, ease: "power2.out" });
        }
        card.gatherNext = false;
        // a new place (or a new record in it): no motion history, no image yet
        card.prevTheta = bc.theta;
        card.image.tex = null;
        card.image.mix = 1;
        card.image.waiting = false;
        card.render = "mesh";
      }
      card.m = bc.m;
      card.id = item.id;
      card.theta = bc.theta;
      // whichever source dissolves the card most sets how its grain moves
      const reqV = card.request?.v ?? 0;
      card.mode =
        card.ritual > 0 && card.ritual >= Math.max(card.zone, reqV)
          ? card.ritualMode
          : reqV > 0
            ? card.request!.mode
            : card.rim > 0 && card.rim >= card.zone
              ? "inplace"
              : zoneMode(bc.theta, card.prevTheta, card.mode === "inplace" ? "leave" : card.mode);
      const s = bc.m - phase;
      const p = cardPose(card, s, bc.m);
      card.pose = p;
      if (bc.m === heroM) heroPose = p;
      // every card on the ring keeps its image warm (ring ≤ 10 of the 14), but
      // shows it only in front of the zone's peak: a record that changed at
      // the back first shows its image while it gathers in the arriving zone
      const art = artFor({ id: item.id, url: item.image_url });
      const visibleArt = imageShown(bc.theta, L.phone) || card.framed;
      const tex = visibleArt ? art : null;
      if (tex !== card.image.tex) {
        // an image that decoded late, while the card is plainly on screen,
        // fades in over the blank stock it gathered into; otherwise
        // (dispersed, or out of sight) it is simply there
        const solid = p.fade * (1 - card.dissolve);
        card.image.mix = tex && card.image.waiting && solid > 0.05 ? 0 : 1;
        card.image.tex = tex;
      }
      card.image.waiting = !art && visibleArt;
      if (card.image.mix < 1) {
        card.image.mix = Math.min(1, card.image.mix + dt / IMAGE_FADE_SECONDS);
        dirty = Math.max(dirty, 1);
      }
      card.prevTheta = bc.theta;
      card.prevM = bc.m;
      // The ritual's exit takes a particle slot only where planExit gave it
      // one (the nearest front-half cards); the rest fade. The zones, the
      // hero frame's swap and a caller's request are particle candidates.
      const req = card.request?.v ?? 0;
      const byRitual = card.ritual > 0.001 && card.ritual >= Math.max(card.zone, req);
      const fades = byRitual && !card.ritualParticles;
      if (p.fade > 0.01 && card.dissolve > 0.001 && !fades) {
        const asked = byRitual || (req > 0 && req >= card.zone);
        cands.push({ key: cardKey(card), dissolve: card.dissolve, kind: asked ? "request" : "zone", weight: byRitual ? card.ritualWeight : frontnessOf(card.theta) });
      }
      card.render = fades ? "alpha" : "mesh";
    }
    for (const card of cards) {
      if (used.has(card.slot)) continue;
      card.m = null;
      card.prevM = null;
      card.id = null;
      card.pose = null;
      card.image.tex = null;
      card.render = "mesh";
      card.mesh.group.visible = false;
    }
    // the hides' ghosts break up where they were
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const g = ghosts[i];
      g.d = Math.min(1, g.d + dt / HIDE_SECONDS);
      if (g.d >= 1) {
        if (g.owns && g.tex) g.tex.dispose();
        ghosts.splice(i, 1);
      }
    }
    ghosts.forEach((g, i) => cands.push({ key: ghostKey(i), dissolve: g.d, kind: "hide", weight: 1 }));
    if (ghosts.length) dirty = Math.max(dirty, 1);
    const plan = planParticles(cands, { phone: L.phone, reduced: reduced(), fast, previous: inParticles });
    inParticles.clear();
    for (const [k, r] of plan) if (r === "particles") inParticles.add(k);

    for (const bc of placed) {
      const card = cards[mod(bc.m, R)];
      const p = card.pose!;
      if (card.render !== "alpha") card.render = plan.get(cardKey(card)) ?? (card.dissolve > 0.001 ? "alpha" : "mesh");
      const alpha = p.fade * meshAlpha(card.dissolve, card.render);
      const g = card.mesh.group;
      g.visible = alpha > 0.01;
      if (g.visible) {
        g.position.set(p.x, p.y, p.z);
        g.quaternion.copy(p.q);
        g.scale.setScalar(p.size);
        const tex = card.image.tex ?? stockTex;
        if (card.mesh.artMat.map !== tex) {
          card.mesh.artMat.map = tex;
          card.mesh.artMat.needsUpdate = true;
        }
        card.mesh.setOpacity(alpha);
        // a late image fades in over the face's blank stock beneath it
        card.mesh.artMat.opacity = alpha * (card.image.tex ? card.image.mix : 1);
        tint(card, p.tone);
      }
      if (g.visible || card.render === "particles") order.push(card);
    }
    // the record
    // (a run of arrows can carry the hero place off the ring for a moment:
    // the record stays with the frame)
    const dp = discPoseFor(heroPose ?? (c.hero > 0 ? L.hero : null));
    disc.position.set(dp.x, dp.y, dp.z);
    disc.quaternion.copy(dp.q);
    // the slow 3D tumble over the rest pose, blended out over the tuck (and
    // in again on close) and grown in with the entrance; none under reduced
    // motion
    const tumbleW = reduced() ? 0 : c.tumble * smooth(0.3, 1, entry);
    if (!reduced()) tumbleT += dt;
    if (tumbleW > 0.0005) {
      const tb = tumbleAt(tumbleT, tumbleW);
      disc.quaternion.multiply(tumbleQ.setFromEuler(tumbleE.set(tb.x, tb.y, tb.z)));
    }
    disc.scale.setScalar(dp.size);
    // the opened record's mineral surface, by the open's own value
    const bd = frames.backdrop;
    if (bd && Math.abs(c.backdrop - backdropShown) > 0.002) {
      backdropShown = c.backdrop;
      bd.style.opacity = c.backdrop < 0.002 ? "0" : String(Math.min(1, c.backdrop));
      bd.style.visibility = c.backdrop < 0.002 ? "hidden" : "visible";
    }
    const idle = idleRate * c.idle;
    if (!gsap.isTweening(spinClock)) {
      const phaseVelocity = dt > 0 ? (phase - prev) / dt : 0;
      Object.assign(spinClock, advanceSpin(spinClock, dt, { idle, phaseVelocity, gain: idleRate ? SPIN_GAIN : 0, response: SPIN_RESPONSE }));
    }
    spin.rotation.z = spinClock.angle + (1 - entry) * 0.8;
    // the phone's opened record is the art alone; the record goes into it
    const discFade = smooth(0.15, 0.6, entry) * (L.phone ? 1 - smooth(0.35, 0.95, c.tuck) : 1);
    for (const m of discMats) m.opacity = discFade;
    disc.visible = discFade > 0.01;
    if (disc.visible) sheen.update(spin, camera, sunDir, idle + spinClock.boost);
    const labelItem = fi >= 0 ? items[fi] : null;
    const labelTex = labelItem ? artFor({ id: labelItem.id, url: labelItem.image_url }) : null;
    if (labelMat.map !== (labelTex ?? stockTex)) {
      labelMat.map = labelTex ?? stockTex;
      labelMat.needsUpdate = true;
    }

    // back to front: the far half, the record, the near half (the grain
    // takes its card's place in the order; a ghost its own)
    type Drawn = { z: number; card?: Card; ghost?: number };
    const drawn: Drawn[] = order.map((card) => ({ z: card.pose!.z, card }));
    ghosts.forEach((g, i) => plan.get(ghostKey(i)) === "particles" && drawn.push({ z: g.pose.z, ghost: i }));
    drawn.sort((a, b) => a.z - b.z);
    let rank = 1;
    let discRanked = false;
    const rankDisc = () => {
      for (const o of discParts) o.renderOrder = rank++;
      discRanked = true;
    };
    grain.begin();
    grain.setTime(clock.elapsedTime);
    for (const d of drawn) {
      if (!discRanked && d.z > dp.z) rankDisc();
      if (d.card) {
        const card = d.card;
        const p = card.pose!;
        card.mesh.group.renderOrder = rank;
        card.mesh.body.renderOrder = rank++;
        card.mesh.art.renderOrder = rank++;
        card.mesh.frame.renderOrder = rank++;
        if (card.render === "particles") {
          drawGrain(p, tangentAt(card.theta, vTan), card.dissolve, card.mode, p.fade * particleAlpha(card.dissolve), card.image.tex, card.image.mix, rank++, card.seed);
        }
      } else {
        const g = ghosts[d.ghost!];
        drawGrain(g.pose, g.tangent, g.d, "inplace", g.pose.fade * particleAlpha(g.d), g.tex, 1, rank++, g.seed);
      }
    }
    grain.end();
    if (!discRanked) rankDisc();

    // render on demand: only while something moves, or the record turns
    const turning = disc.visible && (spinning(spinClock, idle) || tumbleW > 0.0005);
    if (moving || turning || driftRate !== 0 || dirty > 0 || tl !== null || gsap.isTweening(intro)) {
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
    // every card and the record visible for one compile (the held entrance
    // keeps them hidden), so no program waits for its first draw
    const shown = [...cards.map((c) => c.mesh.group), disc].map((o) => [o, o.visible] as const);
    for (const [o] of shown) o.visible = true;
    grain.warm();
    renderer.compile(scene, camera);
    for (const [o, v] of shown) o.visible = v;
    grain.begin();
    grain.end();
    for (const t of [faceTex, grooveTex, stockTex, frameTex]) renderer.initTexture(t);
    for (const t of textures.values()) if (t.ready) renderer.initTexture(t.tex);
    warmFrames = 3;
  })();

  measure();
  renderer.setAnimationLoop(frame);
  const introTween: gsap.core.Tween | null = opts.held ? null : gsap.to(intro, { entry: 1, duration: 0.9, ease: "power2.out", delay: 0.05 });
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
        // the globe holds the open record's rest pose (lerped in by `hero`)
        heldGlobe = ring() ? globeAngle(Math.round(target), ring()) : 0;
        // the focused place takes the hero frame (reopened mid-close on a
        // different place, the returning sleeve swaps out in the frame)
        heroM = moveHero(Math.round(target));
        const next = openTimeline(c, spinClock, { phone: L.phone }, swap);
        const reveal = cb.reveal?.() ?? null;
        if (reveal) {
          next.add(reveal, "land");
          revealTl = reveal;
        }
        next.call(() => tl === next && arriveWhenSettled(), undefined, next.duration());
        play(next);
      } else {
        if (inputOn) observer.enable();
        startClose();
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
      // inside an open record: the belt turns behind it by one card with the
      // others still dispersed, the outgoing sleeve breaks up in place in
      // the hero frame while the incoming one gathers there, and the record
      // turns once to rest upright
      stopTimeline(true);
      heroM = moveHero(Math.round(target));
      const next = stepTimeline(c, spinClock, { phone: L.phone }, swap);
      next.call(() => tl === next && arriveWhenSettled(), undefined, next.duration());
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
      gsap.killTweensOf(c);
      gsap.killTweensOf(swap.incoming);
      gsap.killTweensOf(swap.outgoing);
      swap.outgoing.length = 0;
      for (const card of cards) {
        gsap.killTweensOf(card.lift);
        if (card.request) gsap.killTweensOf(card.request);
      }
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
      for (const card of cards) card.mesh.dispose();
      kit.dispose();
      grain.dispose();
      for (const g of ghosts) if (g.owns && g.tex) g.tex.dispose();
      ghosts.length = 0;
      globe.dispose();
      for (const t of textures.values()) t.tex.dispose();
      textures.clear();
      for (const m of discMats) m.dispose();
      for (const t of [faceTex, grooveTex, stockTex, frameTex]) t.dispose();
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
