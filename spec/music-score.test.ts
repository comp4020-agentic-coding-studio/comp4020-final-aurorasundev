import { describe, expect, it } from "vitest";
import {
  composeMusicScore,
  composeMusicScoreV1,
  MAX_NOTES,
  MAX_SCORE_BYTES,
  MAX_VOICES,
  NOTES_END_MS,
  parseMusicScore,
  type MusicScoreV1,
  type ScoreBrief,
} from "../shared/music-score.ts";
import { METAPHORS, MOTIONS, RELATIONS, SPACES, TIMBRES } from "../server/artifacts/types.ts";

// The record score composer (ADR 006, music-design §4): a pure, versioned,
// bounded translation of a brief and a seed into note events. These check
// the contract, not how a phrase happens to be built. The first blocks hold
// the frozen throwaway-score-v1 (shipped scores must never change); the v2
// block holds the current composer.

const base: ScoreBrief = {
  metaphor: "thread",
  relation: "connected",
  motion: "drifting",
  space: "open",
  music: { timbre: "felt_piano", pulse: "slow", density: "sparse", ending: "settled" },
};
const withMusic = (music: Partial<ScoreBrief["music"]>, rest: Partial<ScoreBrief> = {}): ScoreBrief => ({ ...base, ...rest, music: { ...base.music, ...music } });

// every brief the schema allows, with a few seeds
function* everyBrief(): Generator<ScoreBrief> {
  for (const metaphor of METAPHORS)
    for (const relation of RELATIONS)
      for (const motion of MOTIONS)
        for (const space of SPACES)
          for (const timbre of TIMBRES)
            for (const pulse of ["none", "slow"] as const)
              for (const density of ["sparse", "layered"] as const)
                for (const ending of ["open", "settled", "fading"] as const) yield { metaphor, relation, motion, space, music: { timbre, pulse, density, ending } };
}

const pitchClasses = (s: MusicScoreV1, root: number) => new Set(s.notes.map((n) => (((n.midi - root) % 12) + 12) % 12));
const maxOverlap = (s: MusicScoreV1) => Math.max(...s.notes.map((n) => s.notes.filter((m) => m.at_ms <= n.at_ms && m.at_ms + m.duration_ms > n.at_ms).length));

describe("v1 determinism", () => {
  it("the same brief and seed give the same score, every time", () => {
    const a = composeMusicScoreV1(base, "deadbeef");
    const b = composeMusicScoreV1(structuredClone(base), "deadbeef");
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("a frozen example stays exactly as composer v1 wrote it", () => {
    // if this changes, a shipped score would sound different: bump composer_version instead
    const s = composeMusicScoreV1(base, "deadbeef");
    expect(s.notes.slice(0, 3)).toEqual([
      { at_ms: 500, duration_ms: 1600, midi: 67, velocity: 0.5 },
      { at_ms: 1500, duration_ms: 1600, midi: 71, velocity: 0.42 },
      { at_ms: 2500, duration_ms: 1600, midi: 76, velocity: 0.39 },
    ]);
  });

  it("refuses a seed that isn't eight lowercase hex characters", () => {
    for (const seed of ["", "DEADBEEF", "deadbee", "deadbeef0", "xyzxyzxy"]) expect(() => composeMusicScoreV1(base, seed), seed).toThrow();
  });
});

describe("v1: the brief shapes the music", () => {
  it("timbre picks the preset; motion picks the tempo; space picks the reverb", () => {
    expect(composeMusicScoreV1(withMusic({ timbre: "soft_glass" }), "00000001").timbre).toBe("soft_glass");
    expect(composeMusicScoreV1(withMusic({ timbre: "warm_pad" }), "00000001").timbre).toBe("warm_pad");
    expect(composeMusicScoreV1(withMusic({ timbre: "bright_bell" }), "00000001").timbre).toBe("bright_bell");
    expect(composeMusicScoreV1(withMusic({}, { motion: "still" }), "00000001").tempo_bpm).toBe(48);
    expect(composeMusicScoreV1(withMusic({}, { motion: "unfolding" }), "00000001").tempo_bpm).toBe(88);
    expect(composeMusicScoreV1(withMusic({}, { motion: "settling" }), "00000001").tempo_bpm).toBe(60);
    expect(composeMusicScoreV1(withMusic({}, { space: "enclosed" }), "00000001").reverb_mix).toBe(0.06);
    expect(composeMusicScoreV1(withMusic({}, { space: "distant" }), "00000001").reverb_mix).toBe(0.18);
  });

  it("layered adds quiet low anchors below the melody; sparse keeps one line", () => {
    for (const seed of ["00000001", "a0b1c2d3", "ffffffff"]) {
      const sparse = composeMusicScoreV1(withMusic({ density: "sparse" }), seed);
      const layered = composeMusicScoreV1(withMusic({ density: "layered" }), seed);
      const low = (s: MusicScoreV1) => s.notes.filter((n) => n.midi < 60);
      expect(low(sparse)).toHaveLength(0);
      expect(low(layered).length).toBeGreaterThan(0);
      for (const n of low(layered)) expect(n.velocity).toBeLessThan(0.3);
      expect(maxOverlap(sparse)).toBeLessThan(maxOverlap(layered));
    }
  });

  it("a slow pulse accents and tightens the phrase; none floats wider", () => {
    const none = composeMusicScoreV1(withMusic({ pulse: "none" }), "12345678");
    const slow = composeMusicScoreV1(withMusic({ pulse: "slow" }), "12345678");
    expect(Math.max(...slow.notes.map((n) => n.velocity))).toBeGreaterThan(Math.max(...none.notes.map((n) => n.velocity)));
    expect(slow.notes.length).toBeGreaterThan(none.notes.length);
  });

  it("settled ends on the root near 20 s; open stops away from it; fading quietens the last third", () => {
    for (const seed of ["00000001", "a0b1c2d3", "ffffffff", "13572468"]) {
      const settled = composeMusicScoreV1(withMusic({ ending: "settled" }), seed);
      const last = settled.notes[settled.notes.length - 1];
      expect(last.at_ms).toBeGreaterThanOrEqual(19_000);
      expect(last.at_ms).toBeLessThanOrEqual(20_500);
      const root = last.midi - 12;
      expect([48, 50, 53, 55]).toContain(root);
      const open = composeMusicScoreV1(withMusic({ ending: "open" }), seed);
      const openLast = open.notes[open.notes.length - 1];
      expect(((openLast.midi - root) % 12 + 12) % 12, seed).not.toBe(0);
      const fading = composeMusicScoreV1(withMusic({ ending: "fading" }), seed);
      const late = fading.notes.filter((n) => n.at_ms > 17_000);
      const early = fading.notes.filter((n) => n.at_ms < 10_000);
      const mean = (xs: { velocity: number }[]) => xs.reduce((a, n) => a + n.velocity, 0) / xs.length;
      if (late.length) expect(mean(late)).toBeLessThan(mean(early));
    }
  });

  it("relation picks the scale: major, minor or suspended pentatonic", () => {
    const seed = "00000002";
    const major = composeMusicScoreV1(withMusic({}, { relation: "opening" }), seed);
    const minor = composeMusicScoreV1(withMusic({}, { relation: "separated" }), seed);
    const sus = composeMusicScoreV1(withMusic({}, { relation: "receding" }), seed);
    const root = major.notes[major.notes.length - 1].midi - 12;
    for (const pc of pitchClasses(major, root)) expect([0, 2, 4, 7, 9]).toContain(pc);
    for (const pc of pitchClasses(minor, root)) expect([0, 3, 5, 7, 10]).toContain(pc);
    for (const pc of pitchClasses(sus, root)) expect([0, 2, 5, 7, 10]).toContain(pc);
    // and under pressure the melody stays in a narrow register
    const pressed = composeMusicScoreV1(withMusic({}, { relation: "under_pressure", motion: "unfolding" }), seed);
    const melody = pressed.notes.filter((n) => n.midi >= 60).map((n) => n.midi);
    expect(Math.max(...melody) - Math.min(...melody)).toBeLessThanOrEqual(12);
  });

  it("different briefs give audibly different parameter sets", () => {
    const seed = "cafef00d";
    const variants = [
      base,
      withMusic({ timbre: "warm_pad", pulse: "none", density: "layered", ending: "fading" }, { metaphor: "stone", relation: "under_pressure", motion: "still", space: "enclosed" }),
      withMusic({ timbre: "soft_glass", ending: "open" }, { metaphor: "threshold", relation: "receding", motion: "unfolding", space: "distant" }),
    ].map((b) => composeMusicScoreV1(b, seed));
    const signature = (s: MusicScoreV1) => JSON.stringify([s.timbre, s.tempo_bpm, s.reverb_mix, s.ending, s.notes.map((n) => n.midi)]);
    expect(new Set(variants.map(signature)).size).toBe(3);
  });

  it("the seed varies a piece only within its brief", () => {
    const a = composeMusicScoreV1(base, "00000001");
    const b = composeMusicScoreV1(base, "89abcdef");
    expect([a.timbre, a.tempo_bpm, a.reverb_mix, a.ending]).toEqual([b.timbre, b.tempo_bpm, b.reverb_mix, b.ending]);
    expect(JSON.stringify(a.notes)).not.toBe(JSON.stringify(b.notes));
  });
});

describe("v2: a short piece", () => {
  const seeds = ["00000001", "a0b1c2d3", "ffffffff", "1a2b3c4d"];
  // the lowest voice sounding at each onset, in time order
  const lowestLine = (s: MusicScoreV1) =>
    [...new Set(s.notes.map((n) => n.at_ms))].map((t) => Math.min(...s.notes.filter((n) => n.at_ms <= t && n.at_ms + n.duration_ms > t).map((n) => n.midi)));
  // the top note starting at each onset, in the melody's register
  const topLine = (s: MusicScoreV1) =>
    [...new Set(s.notes.map((n) => n.at_ms))].flatMap((t) => {
      const top = s.notes.filter((n) => n.at_ms === t).sort((a, b) => b.midi - a.midi)[0];
      return top.midi >= 62 ? [top] : [];
    });
  // the home note: the lowest note of a settled piece's final chord
  const home = (s: MusicScoreV1) => {
    const last = s.notes[s.notes.length - 1].at_ms;
    return Math.min(...s.notes.filter((n) => n.at_ms === last).map((n) => n.midi));
  };
  const motions = ["still", "drifting", "unfolding"] as const;

  it("is the current composer", () => {
    expect(composeMusicScore(base, "deadbeef").composer_version).toBe("throwaway-score-v2");
  });

  it("moves through chords: the lowest voice changes root at least four times", () => {
    for (const motion of motions)
      for (const seed of seeds) {
        const line = lowestLine(composeMusicScore(withMusic({}, { motion }), seed)).map((m) => m % 12);
        const changes = line.filter((pc, i) => i > 0 && pc !== line[i - 1]).length;
        expect(changes, `${motion} ${seed}`).toBeGreaterThanOrEqual(4);
      }
  });

  it("gives the melody varied note values, at least three distinct lengths", () => {
    for (const metaphor of METAPHORS)
      for (const motion of motions) {
        const s = composeMusicScore(withMusic({}, { metaphor, motion }), "1a2b3c4d");
        expect(new Set(topLine(s).map((n) => n.duration_ms)).size, `${metaphor} ${motion}`).toBeGreaterThanOrEqual(3);
      }
  });

  it("fills the piece at every tempo: the last note starts at 20 s or later", () => {
    const tempos = new Set<number>();
    for (const motion of MOTIONS)
      for (const ending of ["open", "settled", "fading"] as const)
        for (const seed of seeds) {
          const s = composeMusicScore(withMusic({ ending }, { motion }), seed);
          tempos.add(s.tempo_bpm);
          expect(s.notes[s.notes.length - 1].at_ms, `${motion} ${ending} ${seed}`).toBeGreaterThanOrEqual(20_000);
          for (const n of s.notes) expect(n.at_ms + n.duration_ms).toBeLessThanOrEqual(NOTES_END_MS);
        }
    expect([...tempos].sort()).toEqual([48, 60, 88]);
  });

  it("relation picks the mode: major, minor or lydian", () => {
    for (const seed of seeds) {
      const score = (relation: ScoreBrief["relation"]) => composeMusicScore(withMusic({}, { relation }), seed);
      const opening = score("opening");
      const separated = score("separated");
      const receding = score("receding");
      // the seed picks the key, the same key whatever the relation
      const root = home(opening);
      expect(home(separated) % 12).toBe(root % 12);
      const major = pitchClasses(opening, root);
      const minor = pitchClasses(separated, root);
      const lydian = pitchClasses(receding, root);
      for (const pc of major) expect([0, 2, 4, 5, 7, 9, 11]).toContain(pc);
      for (const pc of minor) expect([0, 2, 3, 5, 7, 8, 10]).toContain(pc);
      for (const pc of lydian) expect([0, 2, 4, 6, 7, 9, 11]).toContain(pc);
      expect(major.has(4) && !major.has(3)).toBe(true);
      expect(minor.has(3) && !minor.has(4)).toBe(true);
      expect(lydian.has(6)).toBe(true);
    }
  });

  it("pulse and density change the accompaniment", () => {
    for (const seed of seeds) {
      const quiet = (s: MusicScoreV1) => JSON.stringify(s.notes.filter((n) => n.velocity < 0.3).map((n) => [n.at_ms, n.midi]));
      const none = composeMusicScore(withMusic({ pulse: "none" }), seed);
      const slow = composeMusicScore(withMusic({ pulse: "slow" }), seed);
      expect(quiet(none)).not.toBe(quiet(slow));
      for (const pulse of ["none", "slow"] as const) {
        const sparse = composeMusicScore(withMusic({ pulse, density: "sparse" }), seed);
        const layered = composeMusicScore(withMusic({ pulse, density: "layered" }), seed);
        expect(layered.notes.length).toBeGreaterThan(sparse.notes.length);
        expect(maxOverlap(layered)).toBeGreaterThanOrEqual(maxOverlap(sparse));
      }
    }
  });

  it("the same brief and seed give the same score", () => {
    const a = composeMusicScore(base, "deadbeef");
    const b = composeMusicScore(structuredClone(base), "deadbeef");
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("different seeds change the notes, never the tempo, timbre, room or ending", () => {
    for (const brief of [base, withMusic({ timbre: "warm_pad", pulse: "none", ending: "fading" }, { motion: "still", space: "distant" })]) {
      const a = composeMusicScore(brief, "00000001");
      const b = composeMusicScore(brief, "89abcdef");
      expect([a.timbre, a.tempo_bpm, a.reverb_mix, a.ending]).toEqual([b.timbre, b.tempo_bpm, b.reverb_mix, b.ending]);
      expect(JSON.stringify(a.notes)).not.toBe(JSON.stringify(b.notes));
    }
  });

  it("refuses a seed that isn't eight lowercase hex characters", () => {
    for (const seed of ["", "DEADBEEF", "deadbee", "deadbeef0", "xyzxyzxy"]) expect(() => composeMusicScore(base, seed), seed).toThrow();
  });
});

describe("bounds", () => {
  it("every possible brief, with several seeds, makes a valid, bounded, versioned score with both composers", () => {
    let n = 0;
    const composers = [
      [composeMusicScoreV1, "throwaway-score-v1"],
      [composeMusicScore, "throwaway-score-v2"],
    ] as const;
    for (const brief of everyBrief()) {
      for (const seed of ["00000000", "7f3a9c01", "ffffffff"]) {
        for (const [compose, version] of composers) {
          const s = compose(brief, seed);
          expect(parseMusicScore(JSON.parse(JSON.stringify(s)))).not.toBeNull();
          expect(s).toMatchObject({ schema_version: 1, composer_version: version, renderer_version: "throwaway-synth-v1", duration_ms: 24000, seed });
          expect(s.notes.length).toBeGreaterThanOrEqual(1);
          expect(s.notes.length).toBeLessThanOrEqual(MAX_NOTES);
          expect(new TextEncoder().encode(JSON.stringify(s)).length).toBeLessThanOrEqual(MAX_SCORE_BYTES);
          expect(maxOverlap(s)).toBeLessThanOrEqual(MAX_VOICES);
          for (const note of s.notes) expect(note.at_ms + note.duration_ms).toBeLessThanOrEqual(NOTES_END_MS);
          n++;
        }
      }
    }
    expect(n).toBe(2 * 51_840);
    // 103,680 scores (51,840 per composer): several seconds locally, slower
    // on a shared CI runner
  }, 60_000);
});

describe("validation", () => {
  const good = () => JSON.parse(JSON.stringify(composeMusicScore(base, "deadbeef"))) as Record<string, unknown> & { notes: Record<string, unknown>[] };

  it("accepts a v2 and a v1 score, and rejects an unknown composer version", () => {
    expect(parseMusicScore(JSON.parse(JSON.stringify(composeMusicScore(base, "deadbeef"))))).not.toBeNull();
    expect(parseMusicScore(JSON.parse(JSON.stringify(composeMusicScoreV1(base, "deadbeef"))))).not.toBeNull();
    for (const composer_version of ["throwaway-score-v9", "throwaway-score-v0", "", null])
      expect(parseMusicScore({ ...good(), composer_version }), String(composer_version)).toBeNull();
  });

  it("accepts a composed score and nothing with an extra, missing or unknown field", () => {
    expect(parseMusicScore(good())).not.toBeNull();
    const cases: ((s: ReturnType<typeof good>) => void)[] = [
      (s) => (s.url = "https://example.com/a.mp3"),
      (s) => delete s.seed,
      (s) => (s.schema_version = 2),
      (s) => (s.composer_version = "throwaway-score-v9"),
      (s) => (s.renderer_version = "other"),
      (s) => (s.timbre = "violin"),
      (s) => (s.tempo_bpm = 61),
      (s) => (s.reverb_mix = 0.5),
      (s) => (s.duration_ms = 30000),
      (s) => (s.seed = "DEADBEEF"),
      (s) => (s.notes = []),
      (s) => (s.notes = Array.from({ length: 97 }, (_, i) => ({ at_ms: i * 200, duration_ms: 150, midi: 60, velocity: 0.3 }))),
      (s) => (s.notes[0].lyric = "la"),
      (s) => (s.notes[0].velocity = Number.NaN),
      (s) => (s.notes[0].velocity = 0.9),
      (s) => (s.notes[0].midi = 90),
      (s) => (s.notes[0].at_ms = -1),
      (s) => (s.notes[0].at_ms = 0.5),
      (s) => (s.notes[0].duration_ms = 100),
      (s) => (s.notes[s.notes.length - 1].at_ms = 21_000),
      (s) => s.notes.reverse(),
      (s) => s.notes.splice(1, 0, { ...s.notes[0] }),
      (s) => (s.notes = Array.from({ length: 7 }, (_, i) => ({ at_ms: 0, duration_ms: 1000, midi: 60 + i, velocity: 0.3 }))),
    ];
    for (const [i, mutate] of cases.entries()) {
      const s = good();
      mutate(s);
      expect(parseMusicScore(s), `case ${i}`).toBeNull();
    }
    for (const raw of [null, "score", 42, [], { ...good(), notes: "x" }]) expect(parseMusicScore(raw)).toBeNull();
  });
});
