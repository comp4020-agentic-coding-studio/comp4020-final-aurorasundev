import * as THREE from "three";

// The Gallery's entry mist (design 2026-10-19 §2): one full-screen fragment
// shader of domain-warped fbm, drifting slowly as soft off-white and
// grey-blue tufts over a pale ground. A 128² ping-pong flow field takes the
// pointer's velocity (not its position) as splats and keeps 0.94 of itself
// per 60 Hz frame, and the mist samples through it, so a passing hand parts
// and curls the mist and it closes again over about two seconds.
//
// Its own module with init/dispose; per-frame state stays here, never in
// React. No text is ever drawn here. DPR is capped at 1 (mist is soft); it
// renders only while shown and the tab is visible, and reduced motion gets
// one still frame with no flow. It imports nothing from the room.

export type Mist = {
  // tuft strength: 1 on the entry, ~0.42 behind the exhibition (≈0.25 alpha)
  level: { value: number };
  // the page moved the level (e.g. from a GSAP tween): draw it
  touch: () => void;
  // behind the exhibition: no drift, no pointer, one held frame
  setBackground: (behind: boolean) => void;
  dispose: () => void;
};

export const MIST_ENTRY = 1;
export const MIST_BEHIND = 0.42;
const FLOW = 128;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
const KEEP = 0.94;

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// the flow field: advect itself a little (so it curls), decay, add a splat
const flowFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uPoint;
uniform vec2 uFrom;
uniform vec2 uForce;
uniform float uRadius;
uniform float uAspect;
uniform float uKeep;
uniform float uFloor;
uniform float uBias;
vec2 dec(vec4 t) { return (t.xy - uBias) * (1.0 + 2.0 * uBias); }
vec4 enc(vec2 v) { return vec4(v / (1.0 + 2.0 * uBias) + uBias, 0.0, 1.0); }
void main() {
  vec2 v0 = dec(texture2D(uPrev, vUv));
  vec2 v = dec(texture2D(uPrev, vUv - v0 * 0.012));
  v *= uKeep;
  v = sign(v) * max(abs(v) - uFloor, 0.0);
  // a splat along the pointer's path since the last frame, so a fast hand
  // leaves a wake rather than a row of dots
  vec2 a = vec2(uFrom.x * uAspect, uFrom.y);
  vec2 b = vec2(uPoint.x * uAspect, uPoint.y);
  vec2 x = vec2(vUv.x * uAspect, vUv.y);
  vec2 ab = b - a;
  float h = clamp(dot(x - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  vec2 d = x - a - ab * h;
  v += uForce * exp(-dot(d, d) / uRadius);
  v = clamp(v, -1.0, 1.0);
  gl_FragColor = enc(v);
}
`;

const mistFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uFlow;
uniform float uTime;
uniform float uLevel;
uniform float uAspect;
uniform float uBias;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = r * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}
void main() {
  vec2 flow = (texture2D(uFlow, vUv).xy - uBias) * (1.0 + 2.0 * uBias);
  vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.1;
  // a hand parts and curls the mist: the flow shifts where it is sampled
  p -= flow * 1.4;
  float t = uTime;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.021)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.017, 0.0)));
  vec2 r = vec2(fbm(p + 3.2 * q + vec2(1.7, 9.2) + t * 0.026), fbm(p + 3.2 * q + vec2(8.3, 2.8) - t * 0.019));
  float f = fbm(p + 2.6 * r + flow * 0.8);
  // pale ground: a cool grey-blue air above, lighter towards the floor
  vec3 ground = mix(vec3(0.835, 0.855, 0.851), vec3(0.733, 0.776, 0.776), smoothstep(0.0, 1.0, vUv.y));
  // tufts: translucent, about 0.35–0.6 alpha at full level
  float tuft = smoothstep(0.42, 0.78, f);
  float alpha = tuft * mix(0.35, 0.6, smoothstep(0.5, 0.9, f)) * uLevel;
  // where the hand passed the mist thins as it parts, then closes again
  alpha *= 1.0 - 0.55 * smoothstep(0.05, 0.6, length(flow));
  vec3 offWhite = vec3(0.957, 0.953, 0.937);
  vec3 greyBlue = vec3(0.63, 0.69, 0.71);
  vec3 tint = mix(offWhite, greyBlue, smoothstep(0.35, 0.75, r.x) * 0.7);
  vec3 col = mix(ground, tint, alpha);
  // a whisper of grain so the gradient never bands
  col += (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function canDrawMist(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function createMist(host: HTMLElement, opts: { still: boolean; onLost?: () => void }): Mist {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power" });
  renderer.setPixelRatio(1);
  renderer.autoClear = false;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.className = "mist-canvas";
  host.appendChild(canvas);

  // half floats keep a smooth decay; plain bytes need a bias and a small
  // floor so the field cannot stall a hair above zero
  const caps = renderer.capabilities;
  const ext = renderer.extensions;
  const half = caps.isWebGL2 ? ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float") : ext.has("OES_texture_half_float") && ext.has("EXT_color_buffer_half_float");
  const bias = half ? 0 : 0.5;
  const floor = half ? 0.0004 : 2 / 255;
  const target = () =>
    new THREE.WebGLRenderTarget(FLOW, FLOW, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  let read = target();
  let write = target();

  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const flowMat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: flowFrag,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uPrev: { value: read.texture },
      uPoint: { value: new THREE.Vector2(0.5, 0.5) },
      uFrom: { value: new THREE.Vector2(0.5, 0.5) },
      uForce: { value: new THREE.Vector2() },
      uRadius: { value: 0.0035 },
      uAspect: { value: 1 },
      uKeep: { value: KEEP },
      uFloor: { value: floor },
      uBias: { value: bias },
    },
  });
  const mistMat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: mistFrag,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uFlow: { value: read.texture },
      uTime: { value: 0 },
      uLevel: { value: MIST_ENTRY },
      uAspect: { value: 1 },
      uBias: { value: bias },
    },
  });
  const flowScene = new THREE.Scene();
  flowScene.add(new THREE.Mesh(tri, flowMat));
  const mistScene = new THREE.Scene();
  const quad = new THREE.Mesh(tri, mistMat);
  quad.frustumCulled = false;
  flowScene.children[0].frustumCulled = false;
  mistScene.add(quad);

  // clear both flow targets to "no flow"
  const clearFlow = () => {
    renderer.setClearColor(new THREE.Color(bias, bias, 0), 1);
    for (const t of [read, write]) {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(null);
  };
  clearFlow();

  const level = { value: MIST_ENTRY };
  let w = 1;
  let h = 1;
  function measure() {
    w = Math.max(1, window.innerWidth);
    h = Math.max(1, window.innerHeight);
    renderer.setSize(w, h, false);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    mistMat.uniforms.uAspect.value = w / h;
    flowMat.uniforms.uAspect.value = w / h;
    dirty = true;
  }

  // --- pointer: velocity splats, gathered between frames ------------------
  let last: { x: number; y: number; t: number } | null = null;
  const force = new THREE.Vector2();
  const point = new THREE.Vector2(0.5, 0.5);
  const from = new THREE.Vector2(0.5, 0.5);
  let fresh = true;
  const onMove = (e: PointerEvent) => {
    if (!live()) return;
    const now = e.timeStamp || performance.now();
    const x = e.clientX / w;
    const y = 1 - e.clientY / h;
    if (last) {
      const dt = Math.max(8, now - last.t) / 1000;
      // screen fractions per second, softly limited
      const vx = (x - last.x) / dt;
      const vy = (y - last.y) / dt;
      const k = 0.6;
      force.x = clamp1(force.x + Math.tanh(vx * k));
      force.y = clamp1(force.y + Math.tanh(vy * k));
      if (fresh) from.set(last.x, last.y);
      fresh = false;
      point.set(x, y);
      wake();
    }
    last = { x, y, t: now };
  };
  const onEnd = () => {
    last = null;
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", onEnd, { passive: true });
  window.addEventListener("pointercancel", onEnd, { passive: true });
  window.addEventListener("pointerleave", onEnd, { passive: true });

  // --- frames ---------------------------------------------------------------
  let raf = 0;
  let dirty = true;
  let behind = false;
  let time = Math.random() * 40;
  let lastFrame = performance.now();

  // drifting and taking the pointer only while the entry shows; behind the
  // exhibition it holds one thinned frame and stops drawing
  const live = () => !opts.still && !behind;

  function step(now: number) {
    raf = 0;
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (live()) {
      time += dt;
      flowMat.uniforms.uPrev.value = read.texture;
      flowMat.uniforms.uKeep.value = Math.pow(KEEP, dt * 60);
      flowMat.uniforms.uForce.value.copy(force);
      flowMat.uniforms.uPoint.value.copy(point);
      flowMat.uniforms.uFrom.value.copy(fresh ? point : from);
      fresh = true;
      renderer.setRenderTarget(write);
      renderer.render(flowScene, cam);
      renderer.setRenderTarget(null);
      [read, write] = [write, read];
      force.set(0, 0);
    } else if (!dirty) return;
    mistMat.uniforms.uFlow.value = read.texture;
    mistMat.uniforms.uTime.value = time;
    mistMat.uniforms.uLevel.value = level.value;
    renderer.render(mistScene, cam);
    dirty = false;
    if (live()) raf = requestAnimationFrame(step);
  }
  let disposed = false;
  function wake() {
    if (!raf && !disposed && !document.hidden) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(step);
    }
  }

  const onVisible = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else {
      dirty = true;
      wake();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  const onResize = () => {
    measure();
    wake();
  };
  window.addEventListener("resize", onResize);
  const onLost = (e: Event) => {
    e.preventDefault();
    opts.onLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  measure();
  wake();

  return {
    level,
    touch() {
      dirty = true;
      wake();
    },
    setBackground(next) {
      if (behind === next) return;
      behind = next;
      last = null;
      force.set(0, 0);
      dirty = true;
      wake();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("pointerleave", onEnd);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisible);
      canvas.removeEventListener("webglcontextlost", onLost);
      read.dispose();
      write.dispose();
      tri.dispose();
      flowMat.dispose();
      mistMat.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
