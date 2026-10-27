import type { MusicScoreV1 } from "../../shared/music-score.ts";

// The Gallery's one player (music-design §6). One live AudioContext, one
// master gain, at most one sounding AudioBufferSourceNode, at most one kept
// PCM buffer and one offline render in flight. Nothing is created before an
// explicit Play; the context is created/resumed inside that click, before
// any await. Every async step checks an action token, so a reply or render
// for record A can never start sound after B is selected, and a late
// `onended` from A can't change B's controls. No AI or provider request is
// made here: a Play reads the published score and renders it locally.

export type SoundState =
  // no valid score, or music is off: the honest no-sound copy
  | { kind: "none" }
  | { kind: "unsupported" }
  | { kind: "ready" }
  | { kind: "rendering" }
  | { kind: "playing" }
  | { kind: "paused"; offset: number }
  | { kind: "ended" }
  | { kind: "failed"; reason: "error" | "reconnect" };

export type SoundSelection = { id: string; version: number; ready: boolean } | null;

type Synth = {
  parseMusicScore: (raw: unknown) => MusicScoreV1 | null;
  renderScore: (score: MusicScoreV1, Offline: typeof OfflineAudioContext) => Promise<AudioBuffer>;
};

export type GalleryAudioDeps = {
  fetchScore: (id: string, signal: AbortSignal) => Promise<{ artifact_id: string; artifact_version: number; score: unknown }>;
  // the synthesis module, loaded only after Play
  loadSynth: () => Promise<Synth>;
  onState: (state: SoundState) => void;
  // where Web Audio comes from (the window, or a test double)
  audio?: { AudioContext?: typeof AudioContext; OfflineAudioContext?: typeof OfflineAudioContext };
  // a missing score (404) means: no sound for this record
  isGone?: (err: unknown) => boolean;
};

export const DEFAULT_VOLUME = 0.35;
const FADE_S = 0.2;
const VOLUME_RAMP_S = 0.03;
const START_RAMP_S = 0.03;
const DURATION_S = 24;

type Source = { node: AudioBufferSourceNode; gain: GainNode; startedAt: number; offset: number };

export function createGalleryAudio(deps: GalleryAudioDeps) {
  const win = (deps.audio ?? (globalThis as unknown as GalleryAudioDeps["audio"])) ?? {};
  const Live = win.AudioContext ?? (win as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const Offline = win.OfflineAudioContext ?? (win as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const supported = typeof Live === "function" && typeof Offline === "function";

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let volume = DEFAULT_VOLUME;
  let selection: SoundSelection = null;
  let connected = true;
  let token = 0;
  let state: SoundState = { kind: "none" };
  let source: Source | null = null;
  let stopping: Promise<void> = Promise.resolve();
  let cache: { key: string; buffer: AudioBuffer } | null = null;
  // renders run one after another; a repeat for the same key shares one
  let renderChain: Promise<unknown> = Promise.resolve();
  const renders = new Map<string, Promise<AudioBuffer>>();
  let fetching: AbortController | null = null;
  let disposed = false;

  const set = (next: SoundState) => {
    state = next;
    deps.onState(next);
  };
  const resting = (): SoundState =>
    !selection?.ready ? { kind: "none" } : !supported ? { kind: "unsupported" } : !connected ? { kind: "failed", reason: "reconnect" } : { kind: "ready" };

  function elapsed(): number {
    if (source && ctx) return Math.min(DURATION_S, source.offset + Math.max(0, ctx.currentTime - source.startedAt));
    if (state.kind === "paused") return state.offset;
    if (state.kind === "ended") return DURATION_S;
    return 0;
  }

  // fades the sounding source out over 200 ms on the audio clock, then
  // releases it; the next source waits for that before it can sound
  function halt(fade = true): void {
    fetching?.abort();
    fetching = null;
    const s = source;
    source = null;
    if (!s || !ctx) return;
    s.node.onended = null;
    const t = ctx.currentTime;
    const end = fade ? t + FADE_S : t;
    try {
      s.gain.gain.cancelScheduledValues(t);
      s.gain.gain.setValueAtTime(s.gain.gain.value, t);
      s.gain.gain.linearRampToValueAtTime(0, end);
      s.node.stop(end);
    } catch {
      // already stopped
    }
    stopping = new Promise((resolve) =>
      setTimeout(
        () => {
          s.node.disconnect();
          s.gain.disconnect();
          resolve();
        },
        fade ? FADE_S * 1000 : 0,
      ),
    );
  }

  function ensureContext(): AudioContext {
    if (!ctx) {
      ctx = new Live!();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      // the browser suspended or interrupted it: show paused, wait for a click
      ctx.onstatechange = () => {
        if (ctx && ctx.state !== "running" && state.kind === "playing") {
          const at = elapsed();
          token++;
          halt(false);
          set({ kind: "paused", offset: at });
        }
      };
    }
    return ctx;
  }

  function render(key: string, score: MusicScoreV1, synth: Synth): Promise<AudioBuffer> {
    const existing = renders.get(key);
    if (existing) return existing;
    // an obsolete render can't be cancelled portably: finish and discard it first
    const run = renderChain.then(() => synth.renderScore(score, Offline!));
    renders.set(key, run);
    renderChain = run.catch(() => {});
    void run.finally(() => renders.delete(key)).catch(() => {});
    return run;
  }

  function start(buffer: AudioBuffer, offset: number): void {
    const c = ctx!;
    const node = c.createBufferSource();
    node.buffer = buffer;
    const gain = c.createGain();
    const t = c.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + START_RAMP_S);
    node.connect(gain).connect(master!);
    const s: Source = { node, gain, startedAt: t, offset };
    node.onended = () => {
      // only the current source may end the piece; no loop, no next record
      if (source !== s) return;
      source = null;
      node.disconnect();
      gain.disconnect();
      set({ kind: "ended" });
    };
    node.start(0, offset);
    source = s;
    set({ kind: "playing" });
  }

  return {
    supported,
    state: () => state,
    elapsed,
    volume: () => volume,

    // The record in front of the player. Anything different stops the sound
    // and drops the other record's buffer.
    select(next: SoundSelection): void {
      const same = next && selection && next.id === selection.id && next.version === selection.version && next.ready === selection.ready;
      if (same || (!next && !selection)) return;
      token++;
      halt();
      if (cache && (!next || !cache.key.startsWith(`${next.id}:${next.version}:`))) cache = null;
      selection = next;
      set(resting());
    },

    // a lost Gallery connection stops sound; coming back never resumes it
    setConnected(next: boolean): void {
      if (next === connected) return;
      connected = next;
      token++;
      halt();
      set(resting());
    },

    // Play, Resume and Play again. Must be called from the click itself.
    play(): void {
      if (disposed || !supported || !selection?.ready || !connected) return;
      if (state.kind === "playing" || state.kind === "rendering") return;
      const from = state.kind === "paused" ? state.offset : 0;
      // inside the gesture, before any await
      const c = ensureContext();
      if (c.state !== "running") void c.resume().catch(() => {});
      const mine = ++token;
      const sel = selection;
      const controller = new AbortController();
      fetching?.abort();
      fetching = controller;
      set({ kind: "rendering" });
      const stale = () => mine !== token || disposed;
      void (async () => {
        try {
          // revalidated on every Play: a hidden record or music switched off
          // answers 404 here
          const reply = await deps.fetchScore(sel.id, controller.signal);
          if (stale()) return;
          if (reply.artifact_id !== sel.id || reply.artifact_version !== sel.version) throw new Error("stale_score");
          const synth = await deps.loadSynth();
          if (stale()) return;
          const score = synth.parseMusicScore(reply.score);
          if (!score) throw new Error("score_invalid");
          const key = `${sel.id}:${sel.version}:${score.renderer_version}`;
          const buffer = cache?.key === key ? cache.buffer : await render(key, score, synth);
          if (stale()) return;
          cache = { key, buffer };
          await stopping;
          if (stale()) return;
          if (c.state !== "running") await c.resume();
          if (stale()) return;
          if (c.state !== "running") throw new Error("not_running");
          start(buffer, from);
        } catch (err) {
          if (stale()) return;
          set(deps.isGone?.(err) ? { kind: "none" } : { kind: "failed", reason: "error" });
        }
      })();
    },

    // fades out and keeps the offset at the end of the fade
    pause(): void {
      if (state.kind !== "playing") return;
      const at = Math.min(DURATION_S, elapsed() + FADE_S);
      token++;
      halt();
      set(at >= DURATION_S ? { kind: "ended" } : { kind: "paused", offset: at });
    },

    // closing, reporting, hiding, leaving the tab: stop and reset
    stop(): void {
      token++;
      halt();
      set(resting());
    },

    setVolume(v: number): void {
      volume = Math.min(1, Math.max(0, v));
      if (ctx && master) {
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(volume, t + VOLUME_RAMP_S);
      }
    },

    dispose(): void {
      disposed = true;
      token++;
      halt(false);
      cache = null;
      void ctx?.close().catch(() => {});
      ctx = null;
      master = null;
    },
  };
}

export type GalleryAudio = ReturnType<typeof createGalleryAudio>;
