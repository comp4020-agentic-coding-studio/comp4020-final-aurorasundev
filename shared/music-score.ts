// A record's score: the bounded, versioned translation of one released
// note's creative brief into a short instrumental (ADR 006). Shared by the
// server, which composes and stores it once when an inspected image is
// published, and the browser, which validates it again before synthesizing
// it with Web Audio. Pure and browser-safe: no server, file or network import.
//
// The model chose the brief at ignition; this composer chooses nothing about
// meaning. A program-generated seed varies root, rests, motif inversions and
// small velocity changes *after* the brief's choices. Do not change how a
// shipped version composes: a different algorithm is a new composer_version.

export const SCORE_SCHEMA_VERSION = 1;
// v1 (shipped 2026-10-27): one rising motif over a held root. Its stored
// scores are kept exactly and still play. v2 (2026-11-05): a short piece with
// a chord progression, bass, accompaniment and a melody in sections. New
// publications use v2; both are valid scores.
export const COMPOSER_VERSION = "throwaway-score-v2";
export const COMPOSER_VERSIONS = ["throwaway-score-v1", "throwaway-score-v2"] as const;
export const RENDERER_VERSION = "throwaway-synth-v1";
export const SCORE_DURATION_MS = 24_000;
// every event ends by here, leaving the last two seconds for the tail and fade
export const NOTES_END_MS = 22_000;
export const MAX_NOTES = 96;
export const MAX_VOICES = 6;
export const MAX_SCORE_BYTES = 16 * 1024;
export const MIDI_RANGE = [48, 84] as const;
export const VELOCITY_RANGE = [0.12, 0.78] as const;
export const NOTE_DURATION_RANGE = [120, 2_400] as const;

const TEMPOS = [48, 60, 72, 88] as const;
const TIMBRES = ["felt_piano", "soft_glass", "warm_pad", "bright_bell"] as const;
const SCORE_ENDINGS = ["open", "settled", "fading"] as const;
const REVERB_MIXES = [0.06, 0.12, 0.18] as const;

export type Timbre = (typeof TIMBRES)[number];

export type ScoreNote = {
  at_ms: number;
  // includes the voice's release
  duration_ms: number;
  midi: number;
  velocity: number;
};

export type MusicScoreV1 = {
  schema_version: 1;
  composer_version: (typeof COMPOSER_VERSIONS)[number];
  renderer_version: "throwaway-synth-v1";
  // exactly eight lowercase hexadecimal characters
  seed: string;
  duration_ms: 24000;
  tempo_bpm: (typeof TEMPOS)[number];
  timbre: Timbre;
  ending: (typeof SCORE_ENDINGS)[number];
  reverb_mix: (typeof REVERB_MIXES)[number];
  notes: ScoreNote[];
};

// The part of a validated CreativeBriefV2 the composer reads. Structural, so
// the server's own brief type fits it without this module importing it.
export type ScoreBrief = {
  metaphor: "thread" | "vessel" | "threshold" | "path" | "seed" | "stone";
  relation: "separated" | "connected" | "under_pressure" | "opening" | "receding";
  motion: "still" | "unfolding" | "drifting" | "settling";
  space: "enclosed" | "open" | "distant";
  music: {
    timbre: Timbre;
    pulse: "none" | "slow";
    density: "sparse" | "layered";
    ending: "open" | "settled" | "fading";
  };
};

export const SEED = /^[0-9a-f]{8}$/;

// Mulberry32, frozen: the composer's only source of variation.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the translation table (music-design.md §4) ------------------------------

// scale semitones; degrees continue into the next octave
const SCALES = {
  major: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
  suspended: [0, 2, 5, 7, 10],
} as const;
const SCALE_FOR: Record<ScoreBrief["relation"], keyof typeof SCALES> = {
  connected: "major",
  opening: "major",
  separated: "minor",
  under_pressure: "minor",
  receding: "suspended",
};
// scale-degree motifs, not quoted melodies
const MOTIFS: Record<ScoreBrief["metaphor"], readonly number[]> = {
  thread: [0, 2, 4, 2],
  vessel: [0, 4, 2, 0],
  threshold: [0, 2, 4, 6],
  path: [0, 2, 4, 2, 0],
  seed: [0, 2, 4, 6, 4],
  stone: [0, 0, 2, 0],
};
const TEMPO_FOR: Record<ScoreBrief["motion"], MusicScoreV1["tempo_bpm"]> = {
  still: 48,
  unfolding: 88,
  drifting: 60,
  settling: 60,
};
const REVERB_FOR: Record<ScoreBrief["space"], MusicScoreV1["reverb_mix"]> = {
  enclosed: 0.06,
  open: 0.12,
  distant: 0.18,
};
const ROOTS = [48, 50, 53, 55] as const;
// how long one melodic voice sounds, release included, in beats (capped)
const NOTE_BEATS: Record<Timbre, number> = { felt_piano: 1.6, soft_glass: 2.4, warm_pad: 2.2, bright_bell: 1.8 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

function degreeToMidi(base: number, scale: readonly number[], degree: number): number {
  const octave = Math.floor(degree / scale.length);
  const step = degree - octave * scale.length;
  return base + 12 * octave + scale[step];
}

// throwaway-score-v1, frozen: kept so a v1 score can be reproduced from its
// brief and seed, and so its tests prove shipped scores never change. Same
// brief, seed and composer version give the same events, always.
export function composeMusicScoreV1(brief: ScoreBrief, seed: string): MusicScoreV1 {
  if (!SEED.test(seed)) throw new Error("bad_seed");
  const rand = mulberry32(parseInt(seed, 16));
  const pick = <T>(values: readonly T[]): T => values[Math.floor(rand() * values.length)];

  const tempo = TEMPO_FOR[brief.motion];
  const beat = 60_000 / tempo;
  const half = beat / 2;
  const scale = SCALES[SCALE_FOR[brief.relation]];
  const pressure = brief.relation === "under_pressure";
  const motif = MOTIFS[brief.metaphor].map((d) => (pressure ? Math.min(d, 4) : d));
  const motifTop = Math.max(...motif);
  const root = pick(ROOTS);
  // the melody sits an octave above the root; anchors sit at the root
  const melodyBase = root + 12;
  const timbre = brief.music.timbre;
  const melodyLength = Math.round(Math.min(NOTE_DURATION_RANGE[1], beat * NOTE_BEATS[timbre]));
  const layered = brief.music.density === "layered";
  const slow = brief.music.pulse === "slow";
  const ending = brief.music.ending;
  // within a phrase: a steady beat when there is a pulse, a floating
  // one-and-a-half beats when there is none
  const noteStep = slow ? beat : beat * 1.5;
  // between phrases, in beats: 2 or 4 without a pulse, 1 or 2 with one;
  // separated phrases always keep the longer rest
  const restChoices = slow ? [1, 2] : [2, 4];
  // where the melody stops so the ending has room
  const melodyEnd = ending === "settled" ? 18_500 : ending === "open" ? 19_500 : 21_000;
  const finalThird = (NOTES_END_MS * 2) / 3;

  const notes: ScoreNote[] = [];
  const fits = (at: number, duration: number, midi: number): boolean => {
    if (notes.length >= MAX_NOTES) return false;
    if (at < 0 || duration < NOTE_DURATION_RANGE[0] || at + duration > NOTES_END_MS) return false;
    if (midi < MIDI_RANGE[0] || midi > MIDI_RANGE[1]) return false;
    if (notes.some((n) => n.at_ms === at && n.midi === midi)) return false;
    // at every onset the new voice would cover, at most six sound together
    const onsets = [at, ...notes.filter((n) => n.at_ms > at && n.at_ms < at + duration).map((n) => n.at_ms)];
    return onsets.every((p) => notes.filter((n) => n.at_ms <= p && n.at_ms + n.duration_ms > p).length < MAX_VOICES);
  };
  const add = (at: number, duration: number, midi: number, velocity: number): boolean => {
    const a = Math.round(at);
    const d = Math.round(clamp(duration, NOTE_DURATION_RANGE[0], NOTE_DURATION_RANGE[1]));
    if (!fits(a, d, midi)) return false;
    let v = velocity;
    // fading: the final third quietens, without forcing a resolution
    if (ending === "fading" && a > finalThird) v *= 1 - 0.55 * ((a - finalThird) / (NOTES_END_MS - finalThird));
    notes.push({ at_ms: a, duration_ms: d, midi, velocity: round2(clamp(v, VELOCITY_RANGE[0], VELOCITY_RANGE[1])) });
    return true;
  };

  let t = half;
  let phrase = 0;
  let lastDegree = 0;
  while (t < melodyEnd && notes.length < MAX_NOTES) {
    // drifting alternates a phrase with a rest of half a phrase
    if (brief.motion === "drifting" && phrase % 2 === 1) {
      t += Math.round((motif.length * noteStep) / 2 / half) * half;
      phrase++;
      continue;
    }
    // the seed may mirror a phrase, never the first
    const inverted = phrase > 0 && rand() < 0.35;
    // unfolding gently extends the register, one degree a phrase
    const lift = brief.motion === "unfolding" ? Math.min(phrase, pressure ? 0 : 3) : 0;
    if (layered) {
      const anchorDegree = pick([0, 0, 2]);
      add(t, Math.min(NOTE_DURATION_RANGE[1], beat * 3), degreeToMidi(root, scale, anchorDegree), 0.2 + rand() * 0.04);
    }
    for (let i = 0; i < motif.length; i++) {
      const at = t + i * noteStep;
      if (at >= melodyEnd) break;
      // settling thins the final third
      if (brief.motion === "settling" && at > finalThird && i % 2 === 1) continue;
      const degree = (inverted ? motifTop - motif[i] : motif[i]) + lift;
      const accent = slow && i === 0 ? 0.12 : 0;
      if (add(at, melodyLength, degreeToMidi(melodyBase, scale, degree), 0.4 + accent + (rand() - 0.5) * 0.08)) lastDegree = degree;
    }
    const phraseEnd = t + motif.length * noteStep;
    const rest = brief.relation === "separated" ? Math.max(...restChoices) : pick(restChoices);
    // still repeats its motif closely; rests land on half-beat boundaries
    t = Math.ceil(phraseEnd / half) * half + rest * beat * (brief.motion === "still" ? 0.75 : 1);
    t = Math.round(t / half) * half;
    phrase++;
  }

  if (ending === "settled") {
    // a final root near twenty seconds
    const at = Math.round(19_600 / half) * half;
    const duration = Math.min(NOTES_END_MS - Math.round(at), 2_000);
    add(at, duration, melodyBase, 0.36);
    if (layered) add(at, duration, root, 0.22);
  } else if (ending === "open") {
    // stop away from the root: a second or fourth degree left hanging
    const degree = lastDegree % scale.length === 1 ? 3 : pick([1, 3]);
    const start = Math.min(Math.max(t, 19_800), NOTES_END_MS - melodyLength);
    add(Math.floor(start / half) * half, melodyLength, degreeToMidi(melodyBase, scale, degree), 0.32);
  }

  notes.sort((a, b) => a.at_ms - b.at_ms || a.midi - b.midi || a.duration_ms - b.duration_ms);
  const score: MusicScoreV1 = {
    schema_version: 1,
    composer_version: "throwaway-score-v1",
    renderer_version: RENDERER_VERSION,
    seed,
    duration_ms: SCORE_DURATION_MS,
    tempo_bpm: tempo,
    timbre,
    ending,
    reverb_mix: REVERB_FOR[brief.space],
    notes,
  };
  // the composer is held to the same contract as anything read back
  const checked = parseMusicScore(score);
  if (!checked) throw new Error("score_invalid");
  return checked;
}

// --- throwaway-score-v2: a short piece -------------------------------------
//
// The brief chooses everything that carries meaning: `relation` the mode, the
// chord progressions and the cadence, `metaphor` the theme's shape and
// rhythm, `motion` the tempo and how the theme returns, `music.pulse` and
// `density` the accompaniment, `space` the room, `music.ending` the last
// chord. The seed only picks the key, a few small rhythmic swaps and the B
// section's variation. The same limits as v1 hold: at most 96 notes, six
// voices, the same ranges and length.
//
// The form is laid out backwards from the final chord, which always lands at
// FINAL_MS, so the piece fills the time at every tempo: an optional intro
// (accompaniment only), A, B, A' (the theme returning), a cadence bar, and the
// final chord ringing into the tail.

// diatonic scales, seven steps; chords are built in thirds on a step
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
} as const;
type ModeName = keyof typeof MODES;

// per relation: the mode, two four-chord progressions (scale steps of the
// chord roots) for the A and B sections, the two chords of the cadence bar,
// and the chord an open ending stops on instead of home
const HARMONY: Record<
  ScoreBrief["relation"],
  { mode: ModeName; a: readonly number[]; b: readonly number[]; cadence: readonly [number, number]; open: number }
> = {
  // I–V–vi–IV, then vi–IV–I–V; IV–V home, or stopping on IV
  opening: { mode: "major", a: [0, 4, 5, 3], b: [5, 3, 0, 4], cadence: [3, 4], open: 3 },
  // I–vi–IV–V, then IV–V–iii–vi; ii–V home, or a deceptive vi
  connected: { mode: "major", a: [0, 5, 3, 4], b: [3, 4, 2, 5], cadence: [1, 4], open: 5 },
  // i–VI–III–VII, then iv–i–VI–v; VI–VII home, or stopping on VI
  separated: { mode: "minor", a: [0, 5, 2, 6], b: [3, 0, 5, 4], cadence: [5, 6], open: 5 },
  // i–iv–VII–III, dorian's raised sixth lifting the pressure; IV–VII home
  under_pressure: { mode: "dorian", a: [0, 3, 6, 2], b: [3, 6, 0, 4], cadence: [3, 6], open: 3 },
  // I–II–I–V in lydian: floating; II–V home, or left on II
  receding: { mode: "lydian", a: [0, 1, 0, 4], b: [1, 5, 1, 4], cadence: [1, 4], open: 1 },
};

// the theme per metaphor: one bar of scale steps (relative to the bar's first
// chord root) and their lengths in eighth notes, eight to a bar
const THEMES: Record<ScoreBrief["metaphor"], { steps: readonly number[]; eighths: readonly number[] }> = {
  // a dotted pull, then a turn back down
  thread: { steps: [4, 5, 4, 2, 1, 2], eighths: [3, 1, 1, 1, 1, 1] },
  // a wide shape held open: low, high, a step between
  vessel: { steps: [0, 4, 2, 4], eighths: [2, 3, 1, 2] },
  // climbing to a held note on the far side
  threshold: { steps: [0, 2, 4, 7], eighths: [1, 1, 2, 4] },
  // walking up and back
  path: { steps: [2, 4, 5, 4, 2], eighths: [2, 1, 1, 2, 2] },
  // a small repeated start that grows
  seed: { steps: [0, 0, 2, 4], eighths: [1, 1, 2, 4] },
  // a heavy note sinking
  stone: { steps: [4, 4, 2, 0], eighths: [3, 1, 2, 2] },
};

const KEYS = [48, 50, 52, 53, 55, 57] as const;
// the final chord's onset; it rings to NOTES_END_MS
const FINAL_MS = 20_600;
// the earliest the first event may start
const LEAD_MS = 200;

function stepToMidi(base: number, mode: readonly number[], step: number): number {
  const octave = Math.floor(step / mode.length);
  const i = step - octave * mode.length;
  return base + 12 * octave + mode[i];
}
const mod7 = (s: number) => ((s % 7) + 7) % 7;

// Composes the score for one brief and seed with throwaway-score-v2. Same
// brief, seed and composer version give the same events, always.
export function composeMusicScore(brief: ScoreBrief, seed: string): MusicScoreV1 {
  if (!SEED.test(seed)) throw new Error("bad_seed");
  const rand = mulberry32(parseInt(seed, 16));
  const pick = <T>(values: readonly T[]): T => values[Math.floor(rand() * values.length)];

  const tempo = TEMPO_FOR[brief.motion];
  const beat = 60_000 / tempo;
  const eighth = beat / 2;
  // a slow piece changes chord every two beats, so the harmony keeps moving
  const halfBarChords = tempo <= 60;
  const harmony = HARMONY[brief.relation];
  const mode = MODES[harmony.mode];
  const timbre = brief.music.timbre;
  const layered = brief.music.density === "layered";
  const pulsed = brief.music.pulse === "slow";
  const ending = brief.music.ending;
  const theme = THEMES[brief.metaphor];
  const pressure = brief.relation === "under_pressure";

  // the seed's choices, drawn in a fixed order
  const key = pick(KEYS);
  // B varies the theme: mirrored, or lifted a third
  const bVariation = pick(["invert", "lift"] as const);
  const swaps = [rand() < 0.5, rand() < 0.5, rand() < 0.5];

  // --- the form, counted back from the final chord ---------------------------
  const totalBeats = Math.floor((FINAL_MS - LEAD_MS) / beat);
  const barCount = Math.floor(totalBeats / 4);
  const spare = totalBeats - barCount * 4;
  const hasIntro = barCount >= 5;
  const body = barCount - (hasIntro ? 1 : 0) - 1;
  const bBars = body >= 5 ? 2 : 1;
  const a2Bars = 1;
  const aBars = body - bBars - a2Bars;
  type Section = "intro" | "a" | "b" | "a2" | "cadence";
  type Bar = { section: Section; index: number; of: number; t: number; beats: number; chords: number[] };
  const bars: Bar[] = [];
  let t = FINAL_MS - totalBeats * beat;
  const push = (section: Section, of: number) => {
    for (let index = 0; index < of; index++) {
      bars.push({ section, index, of, t, beats: 4, chords: [] });
      t += 4 * beat;
    }
  };
  // beats that don't make a whole bar are a rest before the first note
  t += spare * beat;
  if (hasIntro) push("intro", 1);
  push("a", aBars);
  push("b", bBars);
  push("a2", a2Bars);
  push("cadence", 1);
  for (const bar of bars) {
    const prog = bar.section === "b" ? harmony.b : harmony.a;
    if (bar.section === "intro") bar.chords = [0];
    else if (bar.section === "cadence") bar.chords = [...harmony.cadence];
    else if (halfBarChords || bar.of === 1) bar.chords = [prog[(2 * bar.index) % 4], prog[(2 * bar.index + 1) % 4]];
    else bar.chords = [prog[bar.index % 4]];
  }
  const finalRoot = ending === "open" ? harmony.open : 0;
  // chord spans: when each chord starts, how long it lasts, and its root
  type Span = { t: number; beats: number; root: number; bar: Bar };
  const spans: Span[] = bars.flatMap((bar) => {
    const beats = bar.beats / bar.chords.length;
    return bar.chords.map((root, i) => ({ t: bar.t + i * beats * beat, beats, root, bar }));
  });
  const chordAt = (at: number) => [...spans].reverse().find((s) => s.t <= at + 1)?.root ?? 0;

  const notes: ScoreNote[] = [];
  const fits = (at: number, duration: number, midi: number): boolean => {
    if (notes.length >= MAX_NOTES) return false;
    if (at < 0 || duration < NOTE_DURATION_RANGE[0] || at + duration > NOTES_END_MS) return false;
    if (midi < MIDI_RANGE[0] || midi > MIDI_RANGE[1]) return false;
    if (notes.some((n) => n.at_ms === at && n.midi === midi)) return false;
    const onsets = [at, ...notes.filter((n) => n.at_ms > at && n.at_ms < at + duration).map((n) => n.at_ms)];
    return onsets.every((p) => notes.filter((n) => n.at_ms <= p && n.at_ms + n.duration_ms > p).length < MAX_VOICES);
  };
  const add = (at: number, duration: number, midi: number, velocity: number): boolean => {
    const a = Math.round(at);
    const d = Math.round(clamp(Math.min(duration, NOTES_END_MS - a), NOTE_DURATION_RANGE[0], NOTE_DURATION_RANGE[1]));
    if (!fits(a, d, midi)) return false;
    let v = velocity;
    // fading: the last part of the piece quietens towards the final chord
    if (ending === "fading" && a > NOTES_END_MS * 0.6) v *= 1 - 0.45 * ((a - NOTES_END_MS * 0.6) / (NOTES_END_MS * 0.4));
    notes.push({ at_ms: a, duration_ms: d, midi, velocity: round2(clamp(v, VELOCITY_RANGE[0], VELOCITY_RANGE[1])) });
    return true;
  };
  // a gentle arc over the whole piece, loudest in B
  const arc = (at: number) => 0.06 * Math.sin((Math.PI * at) / FINAL_MS);

  // --- registers -------------------------------------------------------------
  // bass in the bottom octave; accompaniment just above the bass; melody above
  const bassMidi = (step: number) => {
    let m = stepToMidi(key, mode, mod7(step));
    while (m > 59) m -= 12;
    return m;
  };
  const above = (floor: number, step: number) => {
    let m = stepToMidi(key, mode, mod7(step));
    while (m <= floor) m += 12;
    return m;
  };
  const melodyBase = key + 12;
  const [lo, hi] = pressure ? [62, 74] : [62, 81];
  const melodyMidi = (step: number) => stepToMidi(melodyBase, mode, step);
  const inRange = (step: number) => melodyMidi(step) >= lo && melodyMidi(step) <= hi;
  // the nearest step to `near` whose scale degree is one of `degrees`
  const nearest = (near: number, degrees: number[], avoid: number[] = []) => {
    let best = near;
    let bestDistance = Infinity;
    for (let s = near - 7; s <= near + 7; s++) {
      if (!degrees.includes(mod7(s)) || avoid.includes(s) || !inRange(s)) continue;
      const d = Math.abs(s - near);
      if (d < bestDistance) [best, bestDistance] = [s, d];
    }
    return best;
  };
  const chordTones = (root: number) => [mod7(root), mod7(root + 2), mod7(root + 4)];

  // --- melody ----------------------------------------------------------------
  type Tone = { at: number; eighths: number; step: number; strong: boolean };
  const melody: Tone[] = [];
  let prev = 4; // start near the fifth above the melody's base
  let firstA: Tone[] = [];
  const legato = timbre === "warm_pad" ? 1.1 : timbre === "soft_glass" ? 1 : 0.92;

  // place one bar's raw steps in the octave that keeps it in range, near the
  // previous note and near the middle of the melody's register
  const centre = 9;
  const place = (raw: number[]) => {
    let best = 0;
    let bestScore = Infinity;
    const mean = raw.reduce((x, y) => x + y, 0) / raw.length;
    for (let k = -14; k <= 14; k += 7) {
      const out = raw.filter((s) => !inRange(s + k)).length;
      const score = out * 100 + Math.abs(raw[0] + k - prev) + Math.abs(mean + k - centre);
      if (score < bestScore) [best, bestScore] = [k, score];
    }
    return raw.map((s) => s + best);
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.section === "intro" || bar.section === "cadence") continue;
    const root = bar.chords[0];
    let eighths = [...theme.eighths];
    let steps = theme.steps.map((s) => {
      if (bar.section !== "b") return s;
      return bVariation === "invert" ? 7 - s : s + 2;
    });
    // small rhythmic swaps chosen by the seed: in B's first bar, and in a
    // second A bar
    const swapAt = bar.section === "b" && bar.index === 0 ? 0 : bar.section === "a" && bar.index === 1 ? 1 : -1;
    if (swapAt >= 0 && swaps[swapAt] && eighths[0] !== eighths[1]) [eighths[0], eighths[1]] = [eighths[1], eighths[0]];
    // the last bar of a section that has more than one ends its phrase on a
    // held note: the theme's opening, then a long tone on the chord
    const answer = bar.of > 1 && bar.index === bar.of - 1;
    if (answer) {
      let sum = 0;
      let keep = 0;
      while (keep < eighths.length && sum + eighths[keep] <= 4) sum += eighths[keep++];
      if (keep === 0) keep = 1;
      steps = steps.slice(0, keep);
      eighths = eighths.slice(0, keep);
      eighths.push(8 - eighths.reduce((x, y) => x + y, 0));
      steps.push(Number.NaN); // filled once the head is placed
    }
    // A' brings the theme back as A first stated it; how depends on motion
    let placed: number[];
    if (bar.section === "a2" && firstA.length) {
      eighths = firstA.map((n) => n.eighths);
      placed = firstA.map((n) => n.step);
      // unfolding: an octave higher, if the register allows
      if (brief.motion === "unfolding" && placed.every((s) => inRange(s + 7))) placed = placed.map((s) => s + 7);
      // drifting: the rhythm loosened by the seed
      if (brief.motion === "drifting" && swaps[2] && eighths[0] !== eighths[1]) [eighths[0], eighths[1]] = [eighths[1], eighths[0]];
      // settling: only the theme's opening, then a long tone on the chord
      if (brief.motion === "settling") {
        let sum = 0;
        let keep = 0;
        while (keep < eighths.length && sum + eighths[keep] <= 4) sum += eighths[keep++];
        keep = Math.max(1, keep);
        eighths = [...eighths.slice(0, keep), 8 - eighths.slice(0, keep).reduce((x, y) => x + y, 0)];
        placed = [...placed.slice(0, keep), Number.NaN];
      }
    } else {
      const head = steps.filter((s) => !Number.isNaN(s)).map((s) => s + root);
      placed = place(head);
      if (answer) placed.push(Number.NaN);
    }
    // lay the bar out; long notes land on a chord tone of the chord under them
    const tones: Tone[] = [];
    let at = bar.t;
    eighths.forEach((len, k) => {
      const under = chordAt(at);
      let step = placed[k];
      if (Number.isNaN(step)) step = nearest(prev, chordTones(under));
      else if (len >= 2 && !chordTones(under).includes(mod7(step))) {
        const r = mod7(step - under);
        step += r === 6 ? 1 : -1;
      }
      if (!inRange(step)) step = nearest(step, [mod7(step)]);
      tones.push({ at, eighths: len, step, strong: Math.round((at - bar.t) / eighth) % 4 === 0 });
      prev = step;
      at += len * eighth;
    });
    if (bar.section === "a" && bar.index === 0) firstA = tones.map((n) => ({ ...n }));
    // a held phrase end leaves its last eighth for a pickup into the next
    // section, a step below where that section starts
    const next = bars[i + 1];
    if (answer && next && (next.section === "b" || next.section === "a2")) {
      const held = tones[tones.length - 1];
      if (held.eighths >= 3) {
        held.eighths -= 1;
        tones.push({ at: held.at + held.eighths * eighth, eighths: 1, step: Number.NaN, strong: false });
      }
    }
    melody.push(...tones);
  }
  // pickups take the step below the next note (or above, if that repeats)
  melody.forEach((n, k) => {
    if (!Number.isNaN(n.step)) return;
    const after = melody[k + 1]?.step ?? prev;
    const before = melody[k - 1]?.step ?? after;
    n.step = after - 1 === before ? after + 1 : after - 1;
  });

  // the cadence: a tone of the first chord, a passing note, a tone of the
  // second, then the final note on the last chord
  // each moves to the nearest fitting step, so the line falls gently home
  const cadenceBar = bars[bars.length - 1];
  const finalDegrees = ending === "settled" ? [0] : ending === "fading" ? [2] : [mod7(finalRoot + 1)];
  const first = nearest(prev, chordTones(harmony.cadence[0]));
  const third = nearest(first - 1, chordTones(harmony.cadence[1]), [first]);
  const finalStep = nearest(third - 1, finalDegrees);
  const toward = first > third ? 1 : -1;
  const passing = Math.abs(first - third) >= 2 ? third + toward : third - toward;
  melody.push(
    { at: cadenceBar.t, eighths: 3, step: first, strong: true },
    { at: cadenceBar.t + 3 * eighth, eighths: 1, step: passing, strong: false },
    { at: cadenceBar.t + 4 * eighth, eighths: 4, step: third, strong: true },
  );

  // --- bass: each chord's root, and its fifth on the bar's third beat ---------
  for (const span of spans) {
    const portions = Math.max(1, Math.round(span.beats / 2));
    const portionBeats = span.beats / portions;
    for (let p = 0; p < portions; p++) {
      const step = p % 2 === 0 ? span.root : span.root + 4;
      const at = span.t + p * portionBeats * beat;
      add(at, portionBeats * beat * 0.95, bassMidi(step), (p === 0 ? 0.36 : 0.3) + arc(at));
    }
  }

  // --- melody into notes ------------------------------------------------------
  for (const n of melody) {
    const section = bars.find((b) => b.t <= n.at + 1 && n.at < b.t + b.beats * beat - 1)?.section;
    const lift = section === "b" ? 0.04 : section === "a2" && brief.motion === "unfolding" ? 0.06 : section === "cadence" ? -0.03 : 0;
    const shape = (n.strong ? 0.05 : -0.02) + (n.eighths >= 4 ? -0.03 : 0);
    const quiet = section === "a2" && brief.motion === "still" ? -0.05 : 0;
    add(n.at, n.eighths * eighth * legato, melodyMidi(n.step), 0.44 + lift + shape + quiet + arc(n.at));
  }

  // --- the final chord, ringing into the tail -----------------------------------
  const finalBass = bassMidi(finalRoot);
  const finalLevel = ending === "settled" ? 0.4 : ending === "open" ? 0.36 : 0.3;
  add(FINAL_MS, NOTES_END_MS - FINAL_MS, melodyMidi(finalStep), finalLevel);
  add(FINAL_MS, NOTES_END_MS - FINAL_MS, finalBass, finalLevel - 0.06);
  add(FINAL_MS, NOTES_END_MS - FINAL_MS, above(finalBass + 2, finalRoot + 2), finalLevel - 0.12);
  add(FINAL_MS, NOTES_END_MS - FINAL_MS, above(finalBass + 6, finalRoot + 4), finalLevel - 0.12);

  // --- accompaniment ------------------------------------------------------------
  for (const span of spans) {
    const bass = bassMidi(span.root);
    const third = above(bass + 2, span.root + 2);
    const fifth = above(bass + 6, span.root + 4);
    const barBeat = (at: number) => Math.round((at - span.bar.t) / beat);
    if (pulsed) {
      // a light, short chord on the bar's second and fourth beats
      for (let b = 0; b < span.beats; b++) {
        const at = span.t + b * beat;
        if (barBeat(at) % 2 !== 1) continue;
        add(at, beat * 0.7, third, 0.22 + arc(at));
        if (layered) add(at, beat * 0.7, fifth, 0.2 + arc(at));
      }
    } else {
      // a broken chord after each bass note, rising and left to ring
      const portions = Math.max(1, Math.round(span.beats / 2));
      const portionBeats = span.beats / portions;
      const pattern = layered ? [third, fifth, third + 12] : [third, fifth];
      for (let p = 0; p < portions; p++) {
        const p0 = span.t + p * portionBeats * beat;
        pattern.forEach((m, k) => {
          const at = p0 + (k + 1) * (portionBeats / (pattern.length + 1)) * beat;
          add(at, p0 + portionBeats * beat - at, m, 0.2 - k * 0.01 + arc(at));
        });
      }
    }
  }

  // --- a quiet countermelody --------------------------------------------------
  // layered with a pulse leaves room for one more voice: in B and A', a slow
  // line moving to the nearest tone of each chord
  if (layered && pulsed) {
    let counter = above(bassMidi(0) + 8, 2);
    for (const span of spans) {
      if (span.bar.section !== "b" && span.bar.section !== "a2") continue;
      const candidates = chordTones(span.root).flatMap((d) => [-12, 0, 12].map((o) => above(bassMidi(span.root) + 6, d) + o));
      counter = candidates.filter((m) => m >= 55 && m <= 72).sort((x, y) => Math.abs(x - counter) - Math.abs(y - counter) || x - y)[0] ?? counter;
      add(span.t + eighth, span.beats * beat - eighth, counter, 0.2 + arc(span.t));
    }
  }

  notes.sort((a, b) => a.at_ms - b.at_ms || a.midi - b.midi || a.duration_ms - b.duration_ms);
  const score: MusicScoreV1 = {
    schema_version: 1,
    composer_version: COMPOSER_VERSION,
    renderer_version: RENDERER_VERSION,
    seed,
    duration_ms: SCORE_DURATION_MS,
    tempo_bpm: tempo,
    timbre,
    ending,
    reverb_mix: REVERB_FOR[brief.space],
    notes,
  };
  const checked = parseMusicScore(score);
  if (!checked) throw new Error("score_invalid");
  return checked;
}

// --- validation -------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: string[]) => {
  const own = Object.keys(v).sort();
  return own.length === keys.length && [...keys].sort().every((k, i) => own[i] === k);
};
const SCORE_KEYS = ["schema_version", "composer_version", "renderer_version", "seed", "duration_ms", "tempo_bpm", "timbre", "ending", "reverb_mix", "notes"];
const NOTE_KEYS = ["at_ms", "duration_ms", "midi", "velocity"];

// The strict reading of a stored or served score: exact keys, known versions
// and values, integer times, sorted unique events within every limit. Anything
// else is null, and a null score never sounds.
export function parseMusicScore(raw: unknown): MusicScoreV1 | null {
  if (!isRecord(raw) || !keysAre(raw, SCORE_KEYS)) return null;
  if (
    raw.schema_version !== SCORE_SCHEMA_VERSION ||
    !(COMPOSER_VERSIONS as readonly unknown[]).includes(raw.composer_version) ||
    raw.renderer_version !== RENDERER_VERSION ||
    typeof raw.seed !== "string" ||
    !SEED.test(raw.seed) ||
    raw.duration_ms !== SCORE_DURATION_MS ||
    !(TEMPOS as readonly unknown[]).includes(raw.tempo_bpm) ||
    !(TIMBRES as readonly unknown[]).includes(raw.timbre) ||
    !(SCORE_ENDINGS as readonly unknown[]).includes(raw.ending) ||
    !(REVERB_MIXES as readonly unknown[]).includes(raw.reverb_mix) ||
    !Array.isArray(raw.notes) ||
    raw.notes.length < 1 ||
    raw.notes.length > MAX_NOTES
  ) {
    return null;
  }
  let prev: ScoreNote | null = null;
  const notes = raw.notes as unknown[];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (!isRecord(n) || !keysAre(n, NOTE_KEYS)) return null;
    const { at_ms, duration_ms, midi, velocity } = n;
    if (
      !Number.isInteger(at_ms) ||
      !Number.isInteger(duration_ms) ||
      !Number.isInteger(midi) ||
      typeof velocity !== "number" ||
      !Number.isFinite(velocity)
    ) {
      return null;
    }
    const note = n as ScoreNote;
    if (
      note.at_ms < 0 ||
      note.duration_ms < NOTE_DURATION_RANGE[0] ||
      note.duration_ms > NOTE_DURATION_RANGE[1] ||
      note.at_ms + note.duration_ms > NOTES_END_MS ||
      note.midi < MIDI_RANGE[0] ||
      note.midi > MIDI_RANGE[1] ||
      note.velocity < VELOCITY_RANGE[0] ||
      note.velocity > VELOCITY_RANGE[1]
    ) {
      return null;
    }
    if (prev) {
      const order = prev.at_ms - note.at_ms || prev.midi - note.midi || prev.duration_ms - note.duration_ms;
      if (order >= 0) return null; // unsorted or duplicate
    }
    // voices still sounding when this one starts
    let sounding = 1;
    for (let j = 0; j < i; j++) {
      const m = notes[j] as ScoreNote;
      if (m.at_ms + m.duration_ms > note.at_ms) sounding++;
    }
    if (sounding > MAX_VOICES) return null;
    prev = note;
  }
  if (new TextEncoder().encode(JSON.stringify(raw)).length > MAX_SCORE_BYTES) return null;
  return raw as MusicScoreV1;
}

// The public, allowlisted descriptor that travels with a record. Absent means
// a legacy, image-only record.
export type PublicMusic = { status: "unavailable" } | { status: "ready"; score_version: 1; duration_ms: 24000 };
