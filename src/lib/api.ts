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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, body.code ?? "unknown", body.error ?? "Something went wrong.");
  return body as T;
}

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

export const getPaper = (id: string): Promise<OpenedPaper> => request(paperPath(id));

export const witnessPaper = (id: string, receipt: string): Promise<PaperState> =>
  request(paperPath(id, "/witness"), postJson({ read_receipt: receipt }));

export type Burned = { id: string; status: "destroyed"; revision: number; total: number };

// The op key is reused for a retry, so a lost reply gets the first outcome.
export const burnPaper = (id: string, receipt: string, opKey: string): Promise<Burned> =>
  request(paperPath(id, "/burn"), postJson({ read_receipt: receipt, op_key: opKey, confirmed: true }));

// A lost response can't tell "not saved" from "saved, reply dropped", so a
// network failure is retried with the same submission key: the server answers
// a repeat with the paper it already saved instead of saving it twice.
export type Created = { paper: { id: string; version: number; status: string }; total: number; revision: number };

export async function createPaper(content: string, mode: PaperMode, submissionKey: string): Promise<Created> {
  const send = (): Promise<Created> =>
    request("/api/papers", postJson({ content, mode, confirmed: true, submission_key: submissionKey }));
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (err instanceof ApiError || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}
