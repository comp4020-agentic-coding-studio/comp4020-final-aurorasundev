// Shared shapes for Release keepsakes. Nothing here holds a paper's words or
// drawing: a recipe is four enum values, and the public object is an
// allowlisted view of a generated image.

export const MOTIFS = ["vessel", "knot", "seed", "arch", "ribbon", "stone"] as const;
export const MATERIALS = ["paper", "clay", "glass", "charcoal"] as const;
export const PALETTES = ["ivory", "slate", "sage", "ochre"] as const;
export const GESTURES = ["held", "opening", "balanced", "scattered"] as const;

export type Recipe = {
  motif: (typeof MOTIFS)[number];
  material: (typeof MATERIALS)[number];
  palette: (typeof PALETTES)[number];
  gesture: (typeof GESTURES)[number];
};

export const JOB_STATES = [
  "PREPARE_QUEUED",
  "PREPARING",
  "PREPARED",
  "IMAGE_QUEUED",
  "GENERATING",
  "REVIEW_QUEUED",
  "REVIEWING",
  "PUBLISHED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "GENERATION_UNKNOWN",
] as const;
export type JobState = (typeof JOB_STATES)[number];

// States a burn moves straight to IMAGE_QUEUED; later ones are past it.
export const PREPARATION_STATES: readonly JobState[] = ["PREPARE_QUEUED", "PREPARING", "PREPARED"];

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
