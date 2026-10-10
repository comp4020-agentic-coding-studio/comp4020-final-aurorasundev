export const MAX_CODE_POINTS = 2000;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(path, { credentials: "same-origin", ...init, ...(controller ? { signal: controller.signal } : {}) });
    const body = (await res.json().catch((err: unknown) => {
      if (res.ok || controller?.signal.aborted) throw err;
      return {};
    })) as { error?: string; code?: string };
    if (!res.ok) throw new ApiError(res.status, body.code ?? "unknown", body.error ?? "Something went wrong.");
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export type SafetyConfig = { provider: "openai" | "fixture" | null; reports: boolean };
export const getSafetyConfig = (): Promise<SafetyConfig> => request("/api/safety", undefined, 8000);

export const countCodePoints = (text: string): number => Array.from(text).length;

export const ensureSession = (): Promise<{ ok: true }> => request("/api/session", { method: "POST" });

export type PaperMode = "KEEP" | "RELEASE";

export type Viewer = { is_author: boolean; has_witnessed: boolean; can_burn: boolean };

// A paper's public facts plus this viewer's own state; the server never says
// who the author is, only whether it is you.
export type PaperState = { id: string; mode: "keep" | "release"; version: number; witness_count: number; viewer: Viewer };
export type OpenedPaper = PaperState & { content: string; read_receipt: string | null };

const paperPath = (id: string, action = ""): string => `/api/papers/${encodeURIComponent(id)}${action}`;
const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const getPaper = (id: string): Promise<OpenedPaper> => request(paperPath(id), undefined, 8000);

export const witnessPaper = (id: string, receipt: string): Promise<PaperState> =>
  request(paperPath(id, "/witness"), postJson({ read_receipt: receipt }));

export type Burned = {
  id: string;
  status: "destroyed";
  version: number;
  revision: number;
  total: number;
  op: string;
  destroyed_at: string;
  burn_duration_ms: number;
  effect_seed: string;
};

// The op key is reused for a retry, so a lost reply gets the first outcome.
export const burnPaper = (id: string, receipt: string, opKey: string): Promise<Burned> =>
  request(paperPath(id, "/burn"), postJson({ read_receipt: receipt, op_key: opKey, confirmed: true }), 8000);

// A lost response can't tell "not saved" from "saved, reply dropped", so a
// network failure is retried with the same submission key: the server answers
// a repeat with the paper it already saved instead of saving it twice.
export type Created = {
  paper: { id: string; version: number; status: string };
  total: number;
  revision: number;
  offer_return_key: boolean;
};

export async function createPaper(content: string, mode: PaperMode, submissionKey: string): Promise<Created> {
  const send = (): Promise<Created> =>
    request("/api/papers", postJson({ content, mode, confirmed: true, submission_key: submissionKey }), 15000);
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (err instanceof ApiError || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

// The raw key exists only in this reply; the server keeps a digest. The
// issuance id is not secret: it names which key this page showed.
export type Issued = { return_key: string; issuance_id: string };
export const issueReturnKey = (): Promise<Issued> => request("/api/identity/return-key", postJson({}));

export const markReturnKeySaved = (issuanceId: string): Promise<{ ok: true }> =>
  request("/api/identity/return-key/saved", postJson({ issuance_id: issuanceId }));

// Whether this browser has a key it could still save (an offer it missed).
export type KeyAvailability = "not_needed" | "available" | "saved";
export const identityState = (): Promise<{ return_key: KeyAvailability }> => request("/api/identity/state");

// A random handful of papers not already on screen, for exploring.
export type Sample = { papers: { id: string }[]; total: number; revision: number };
export function samplePapers(limit: number, exclude: string[]): Promise<Sample> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (exclude.length) query.set("exclude", exclude.slice(-32).join(","));
  return request(`/api/papers?${query}`);
}

export type ReportReason =
  | "threats_abuse"
  | "private_information"
  | "sexual_graphic"
  | "harmful_instructions"
  | "spam_scam"
  | "something_else";

export const MAX_REPORT_NOTE = 500;

// Retried with the same operation key, a lost reply gets the same receipt.
export const reportPaper = (
  id: string,
  receipt: string,
  reason: ReportReason,
  note: string,
  operationKey: string,
): Promise<{ report_id: string; status: "queued" }> =>
  request(
    paperPath(id, "/report"),
    postJson({ read_receipt: receipt, reason, ...(note.trim() ? { note } : {}), operation_key: operationKey }),
    8000,
  );

export const restoreIdentity = (key: string): Promise<{ ok: true }> =>
  request("/api/identity/restore", postJson({ return_key: key }));
