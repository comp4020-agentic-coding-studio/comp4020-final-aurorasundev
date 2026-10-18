// Shared shapes for Release records. A job holds a constrained creative
// brief derived from its own burned note, never the note's words or drawing;
// the public object is an allowlisted view of the generated image.

export const METAPHORS = ["thread", "vessel", "threshold", "path", "seed", "stone"] as const;
export const RELATIONS = ["separated", "connected", "under_pressure", "opening", "receding"] as const;
export const MOTIONS = ["still", "unfolding", "drifting", "settling"] as const;
export const SPACES = ["enclosed", "open", "distant"] as const;
export const MATERIALS = ["paper_stone", "frosted_glass", "ink_fibre"] as const;
export const PALETTES = ["slate_ivory", "sage_charcoal", "cobalt_paper"] as const;
export const TIMBRES = ["felt_piano", "soft_glass", "warm_pad"] as const;
export const PULSES = ["none", "slow"] as const;
export const DENSITIES = ["sparse", "layered"] as const;
export const ENDINGS = ["open", "settled", "fading"] as const;

// What one note becomes. Every field is an enum chosen by the model after it
// read that note at ignition; nothing here is free text.
export type CreativeBriefV2 = {
  schema_version: 2;
  metaphor: (typeof METAPHORS)[number];
  relation: (typeof RELATIONS)[number];
  motion: (typeof MOTIONS)[number];
  space: (typeof SPACES)[number];
  material: (typeof MATERIALS)[number];
  palette: (typeof PALETTES)[number];
  music: {
    timbre: (typeof TIMBRES)[number];
    pulse: (typeof PULSES)[number];
    density: (typeof DENSITIES)[number];
    ending: (typeof ENDINGS)[number];
  };
};

// A job exists only for a fresh Release burn. It starts EXTRACTING (the note
// is held in memory for one request), then carries the brief alone.
export const JOB_STATES = [
  "EXTRACTING",
  "IMAGE_QUEUED",
  "GENERATING",
  "REVIEW_QUEUED",
  "REVIEWING",
  "PUBLISHED",
  "SOURCE_UNAVAILABLE",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "GENERATION_UNKNOWN",
] as const;
export type JobState = (typeof JOB_STATES)[number];

// image only for now; `audio` arrives with the music extension
export type PublicArtifact = {
  id: string;
  version: number;
  image_url: string;
  width: 1024;
  height: 1024;
  title: string;
  alt: string;
};

export type GalleryPage = {
  revision: number;
  items: PublicArtifact[];
  next_cursor: string | null;
  total: number;
};

export type GalleryChange =
  | { type: "artifact:published"; revision: number; total: number; artifact: PublicArtifact }
  | { type: "artifact:hidden"; revision: number; total: number; id: string; version: number };

export const ARTIFACT_REPORT_REASONS = [
  "threats_abuse",
  "private_information",
  "sexual_graphic",
  "harmful_instructions",
  "spam_scam",
  "something_else",
] as const;
export type ArtifactReportReason = (typeof ARTIFACT_REPORT_REASONS)[number];
