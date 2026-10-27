import { mulberry32, RENDERER_VERSION, SCORE_DURATION_MS, type MusicScoreV1, type ScoreNote, type Timbre } from "../../shared/music-score.ts";

// the browser validates a served score again before rendering it
export { parseMusicScore } from "../../shared/music-score.ts";

// The record renderer, throwaway-synth-v1 (music-design §6): a validated
// score becomes one mono 44.1 kHz, 24-second buffer in an
// OfflineAudioContext. Bounded oscillator voices → preset envelope and
// low-pass → a restrained reverb whose noise impulse comes from the score's
// own seed → a final fade from 22 to 24 s. No samples, files or URLs; never
// Math.random(). Loaded only after a visitor presses Play.
//
// The presets are plain data so they can be read (and reproduced offline)
// without a browser. Changing how v1 sounds means a new renderer version.

export const SAMPLE_RATE = 44_100;
export const PEAK_LIMIT = 0.7;
const FADE_FROM_S = 22;
const VOICE_GAIN = 0.22;
const IMPULSE_S = 2.4;

export type Partial = { ratio: number; gain: number; type: OscillatorType; detuneCents?: number };
export type Preset = {
  partials: Partial[];
  attackS: number;
  // where the body has decayed to by the end of the note (fraction of peak),
  // before the final release; 1 holds the level like a pad
  sustain: number;
  releaseS: number;
  lowpassHz: number;
};

export const PRESETS: Record<Timbre, Preset> = {
  // felt-like synthetic keys: sine with a soft triangle overtone, a 10 ms
  // attack and a short decaying body
  felt_piano: {
    partials: [
      { ratio: 1, gain: 1, type: "sine" },
      { ratio: 2, gain: 0.22, type: "triangle" },
      { ratio: 3, gain: 0.06, type: "sine" },
    ],
    attackS: 0.01,
    sustain: 0.12,
    releaseS: 0.12,
    lowpassHz: 1_800,
  },
  // quiet glass tones: sine partials, a 20 ms attack and a long release
  soft_glass: {
    partials: [
      { ratio: 1, gain: 1, type: "sine" },
      { ratio: 2.76, gain: 0.12, type: "sine" },
      { ratio: 5.4, gain: 0.035, type: "sine" },
    ],
    attackS: 0.02,
    sustain: 0.3,
    releaseS: 0.6,
    lowpassHz: 3_500,
  },
  // a warm pad: two gently detuned oscillators with 250 ms smoothing
  warm_pad: {
    partials: [
      { ratio: 1, gain: 0.6, type: "triangle", detuneCents: -6 },
      { ratio: 1, gain: 0.6, type: "triangle", detuneCents: 6 },
    ],
    attackS: 0.25,
    sustain: 0.8,
    releaseS: 0.25,
    lowpassHz: 1_600,
  },
};

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

// The note's gain envelope as (time, level) points, relative to its start.
export function envelope(note: ScoreNote, preset: Preset): [number, number][] {
  const d = note.duration_ms / 1000;
  const peak = note.velocity * VOICE_GAIN;
  const attack = Math.min(preset.attackS, d / 3);
  const release = Math.min(preset.releaseS, d / 3);
  const bodyEnd = Math.max(attack, d - release);
  return [
    [0, 0],
    [attack, peak],
    [bodyEnd, peak * preset.sustain],
    [d, 0],
  ];
}

// The reverb's impulse: decaying noise from the score's seed, so the same
// score always gets the same room.
export function impulse(seed: string, sampleRate = SAMPLE_RATE): Float32Array {
  const rand = mulberry32(parseInt(seed, 16) ^ 0x5eed);
  const length = Math.round(IMPULSE_S * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = (rand() * 2 - 1) * (1 - i / length) ** 3;
  return data;
}

// Scales an over-loud render down to the peak limit; never boosts a quiet
// one. Refuses a non-finite or silent result.
export function limitPeak(data: Float32Array): void {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) throw new Error("render_not_finite");
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  if (peak < 1e-4) throw new Error("render_silent");
  if (peak > PEAK_LIMIT) {
    const k = PEAK_LIMIT / peak;
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export async function renderScore(score: MusicScoreV1, Offline: OfflineCtor): Promise<AudioBuffer> {
  if (score.renderer_version !== RENDERER_VERSION) throw new Error("renderer_unsupported");
  const preset = PRESETS[score.timbre];
  const ctx = new Offline(1, Math.round((SCORE_DURATION_MS / 1000) * SAMPLE_RATE), SAMPLE_RATE);

  // master: low-pass → final fade → destination; reverb beside the dry path
  const fade = ctx.createGain();
  fade.gain.setValueAtTime(1, 0);
  fade.gain.setValueAtTime(1, FADE_FROM_S);
  fade.gain.linearRampToValueAtTime(0, SCORE_DURATION_MS / 1000);
  fade.connect(ctx.destination);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = preset.lowpassHz;
  lowpass.Q.value = 0.5;
  const dry = ctx.createGain();
  dry.gain.value = 1 - score.reverb_mix;
  const wet = ctx.createGain();
  wet.gain.value = score.reverb_mix;
  const convolver = ctx.createConvolver();
  const ir = ctx.createBuffer(1, Math.round(IMPULSE_S * SAMPLE_RATE), SAMPLE_RATE);
  ir.getChannelData(0).set(impulse(score.seed));
  convolver.buffer = ir;
  lowpass.connect(dry).connect(fade);
  lowpass.connect(convolver).connect(wet).connect(fade);

  // one voice per note (at most six sound at once, by the score's contract)
  for (const note of score.notes) {
    const start = note.at_ms / 1000;
    const end = start + note.duration_ms / 1000;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, 0);
    for (const [t, level] of envelope(note, preset)) amp.gain.linearRampToValueAtTime(level, start + t);
    amp.connect(lowpass);
    for (const p of preset.partials) {
      const osc = ctx.createOscillator();
      osc.type = p.type;
      osc.frequency.value = midiToHz(note.midi) * p.ratio;
      if (p.detuneCents) osc.detune.value = p.detuneCents;
      const g = ctx.createGain();
      g.gain.value = p.gain;
      osc.connect(g).connect(amp);
      osc.start(start);
      osc.stop(end + 0.01);
    }
  }

  const buffer = await ctx.startRendering();
  limitPeak(buffer.getChannelData(0));
  return buffer;
}
