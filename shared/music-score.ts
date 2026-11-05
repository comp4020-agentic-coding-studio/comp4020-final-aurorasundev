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
// The brief chooses everything that carries meaning: `relation` the key and
// chord progression, `metaphor` the theme's shape, `motion` the tempo and how
// the piece develops, `music.pulse`/`density` the accompaniment, `space` the
// room, `music.ending` how it closes. The seed only picks the key's root,
// small rhythmic variants and the B section's variation. The same limits as
// v1 hold: at most 96 notes, six voices, the same ranges and length.

// diatonic scales, seven steps; chords are built in thirds on a step
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
} as const;
type ModeName = keyof typeof MODES;

// per relation: the mode and two four-chord progressions (scale steps of the
// chord roots), for the A and B sections
const HARMONY: Record<ScoreBrief["relation"], { mode: ModeName; a: readonly number[]; b: readonly number[] }> = {
  // I–V–vi–IV, then vi–IV–I–V: open, arriving
  opening: { mode: "major", a: [0, 4, 5, 3], b: [5, 3, 0, 4] },
  // I–vi–IV–V, then IV–V–iii–vi: held together
  connected: { mode: "major", a: [0, 5, 3, 4], b: [3, 4, 2, 5] },
  // i–VI–III–VII, then iv–i–VI–V: apart, but moving
  separated: { mode: "minor", a: [0, 5, 2, 6], b: [3, 0, 5, 4] },
  // i–iv–VII–III, dorian's raised sixth lifting the pressure
  under_pressure: { mode: "dorian", a: [0, 3, 6, 2], b: [3, 6, 0, 4] },
  // I–II–I–V in lydian: floating, never quite landing
  receding: { mode: "lydian", a: [0, 1, 0, 4], b: [1, 5, 1, 4] },
};

// the theme's shape per metaphor: scale steps relative to the chord root and
// durations in eighth notes (four beats a bar, eight eighths)
const THEMES: Record<ScoreBrief["metaphor"], { steps: readonly number[]; eighths: readonly number[] }> = {
  thread: { steps: [4, 2, 4, 5, 4, 2], eighths: [2, 1, 1, 2, 1, 1] },
  vessel: { steps: [0, 4, 2, 4, 7, 4], eighths: [3, 1, 2, 1, 1, 0] },
  threshold: { steps: [0, 2, 4, 7, 6, 4], eighths: [1, 1, 2, 2, 1, 1] },
  path: { steps: [2, 4, 5, 4, 2, 0], eighths: [1, 1, 1, 1, 2, 2] },
  seed: { steps: [0, 0, 2, 4, 7, 4], eighths: [1, 1, 1, 1, 3, 1] },
  stone: { steps: [4, 4, 2, 0, 2, 4], eighths: [2, 2, 1, 1, 1, 1] },
};

const KEYS = [48, 50, 52, 53, 55, 57] as const;

function stepToMidi(base: number, mode: readonly number[], step: number): number {
  const octave = Math.floor(step / mode.length);
  const i = step - octave * mode.length;
  return base + 12 * octave + mode[i];
}

// Composes the score for one brief and seed with throwaway-score-v2. Same
// brief, seed and composer version give the same events, always.
export function composeMusicScore(brief: ScoreBrief, seed: string): MusicScoreV1 {
  if (!SEED.test(seed)) throw new Error("bad_seed");
  const rand = mulberry32(parseInt(seed, 16));
  const pick = <T>(values: readonly T[]): T => values[Math.floor(rand() * values.length)];

  const tempo = TEMPO_FOR[brief.motion];
  const beat = 60_000 / tempo;
  const eighth = beat / 2;
  // a slow piece changes chord every two beats, so the harmony keeps moving;
  // a faster one every four
  const beatsPerChord = tempo <= 60 ? 2 : 4;
  const bar = beat * beatsPerChord;
  const harmony = HARMONY[brief.relation];
  const mode = MODES[harmony.mode];
  const key = pick(KEYS);
  const timbre = brief.music.timbre;
  const layered = brief.music.density === "layered";
  const pulsed = brief.music.pulse === "slow";
  const ending = brief.music.ending;
  const theme = THEMES[brief.metaphor];
  const pressure = brief.relation === "under_pressure";

  // how many chord spans fit before the tail, and how they are split into
  // sections; the piece then runs to the tail at every tempo
  const start = 400;
  const bars = Math.max(5, Math.floor((NOTES_END_MS - start) / bar));
  const intro = bars >= 7 ? 1 : 0;
  const coda = 1;
  const body = bars - intro - coda;
  const aBars = Math.ceil(body / 3);
  const bBars = Math.max(1, Math.floor(body / 3));
  const a2Bars = body - aBars - bBars;
  type Section = "intro" | "a" | "b" | "a2" | "coda";
  const plan: Section[] = [
    ...Array<Section>(intro).fill("intro"),
    ...Array<Section>(aBars).fill("a"),
    ...Array<Section>(bBars).fill("b"),
    ...Array<Section>(a2Bars).fill("a2"),
    "coda",
  ];

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
    if (ending === "fading" && a > NOTES_END_MS * 0.6) v *= 1 - 0.5 * ((a - NOTES_END_MS * 0.6) / (NOTES_END_MS * 0.4));
    notes.push({ at_ms: a, duration_ms: d, midi, velocity: round2(clamp(v, VELOCITY_RANGE[0], VELOCITY_RANGE[1])) });
    return true;
  };

  // the voices sit in three registers: bass, accompaniment, melody
  const bassBase = key;
  const midBase = key + 12;
  const melodyBase = key + 12;
  const melodyLength = (eighths: number) => Math.min(NOTE_DURATION_RANGE[1], eighths * eighth * (timbre === "warm_pad" ? 1.15 : 0.95));
  // the B section's variation: the theme inverted, or moved up a step
  const bVariation = pick(["invert", "lift"] as const);

  plan.forEach((section, i) => {
    const t0 = start + i * bar;
    const barInSection = plan.slice(0, i).filter((s) => s === section).length;
    const progression = section === "b" ? harmony.b : harmony.a;
    const root = section === "coda" ? 0 : progression[barInSection % progression.length];
    // a phrase-long swell: louder towards the middle of each section
    const swell = section === "coda" || section === "intro" ? 0 : Math.sin((Math.PI * (barInSection + 0.5)) / Math.max(1, section === "b" ? bBars : section === "a" ? aBars : a2Bars)) * 0.08;
    const lift = brief.motion === "unfolding" && (section === "a2" || section === "b") ? 0.06 : 0;

    // bass: the chord root, held across the bar (a fifth below for colour in B)
    const bassDur = Math.min(NOTE_DURATION_RANGE[1], bar * 0.95);
    add(t0, bassDur, stepToMidi(bassBase, mode, root), 0.34 + swell);

    // accompaniment: the chord's third and fifth, as a pulse or broken chord
    const third = stepToMidi(midBase, mode, root + 2);
    const fifth = stepToMidi(midBase, mode, root + 4);
    if (pulsed) {
      // a light chord stab on each off-beat of the span (beats two and four)
      for (let b = 1; b < beatsPerChord; b += 2) {
        add(t0 + b * beat, beat * 0.8, third, 0.24 + swell);
        if (layered) add(t0 + b * beat, beat * 0.8, fifth, 0.22 + swell);
      }
    } else {
      // a broken chord rising through the bar
      const pattern = layered ? [third, fifth, third + 12, fifth] : [third, fifth];
      pattern.forEach((m, k) => add(t0 + (k * bar) / pattern.length, Math.min(NOTE_DURATION_RANGE[1], (bar / pattern.length) * 1.6), m, 0.22 + swell));
    }

    if (section === "intro") return;

    // melody: the theme over this chord, varied by section
    if (section === "coda") {
      // close: settled lands on the home note, open on the second step
      // above it, fading lets the last chord ring with a quiet high note
      const last = ending === "settled" ? 7 : ending === "open" ? 8 : 11;
      add(t0, Math.min(NOTE_DURATION_RANGE[1], bar * 0.9), stepToMidi(melodyBase, mode, last), 0.42);
      if (ending === "settled") add(t0, Math.min(NOTE_DURATION_RANGE[1], bar * 0.9), stepToMidi(midBase, mode, 4), 0.26);
      return;
    }
    // a two-beat span carries one half of the theme, alternating; a
    // four-beat span the whole of it
    const second = beatsPerChord === 2 && barInSection % 2 === 1;
    const cut = (xs: readonly number[]) => (beatsPerChord === 2 ? (second ? xs.slice(3) : xs.slice(0, 3)) : [...xs]);
    const eighths = cut(theme.eighths);
    // every other span the seed may swap the rhythm's first two values
    if (barInSection % 2 === 1 && eighths.length > 1 && rand() < 0.5) [eighths[0], eighths[1]] = [eighths[1], eighths[0]];
    const steps = cut(theme.steps).map((s) => {
      let step = s;
      if (section === "b") step = bVariation === "invert" ? 7 - s : s + 1;
      if (pressure) step = Math.min(step, 5);
      return root + step;
    });
    let t = t0;
    steps.forEach((step, k) => {
      const len = eighths[k];
      if (len === 0 || t >= t0 + bar - eighth / 2) return;
      // the first note of a span carries it
      const accent = t === t0 ? 0.08 : 0;
      add(t, melodyLength(len), stepToMidi(melodyBase, mode, step), 0.46 + accent + swell + lift + (rand() - 0.5) * 0.06);
      t += len * eighth;
    });
  });

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
