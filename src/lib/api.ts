export const MAX_CODE_POINTS = 2000;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? "Something went wrong.");
  return body as T;
}

export const countCodePoints = (text: string): number => Array.from(text).length;

export const ensureSession = (): Promise<{ ok: true }> => request("/api/session", { method: "POST" });

export const listPapers = (): Promise<{ papers: { id: string }[]; total: number }> => request("/api/papers");

export const getPaper = (id: string): Promise<{ id: string; content: string }> =>
  request(`/api/papers/${encodeURIComponent(id)}`);

// A lost response can't tell "not saved" from "saved, reply dropped", so a
// network failure is retried with the same submission key: the server answers
// a repeat with the paper it already saved instead of saving it twice.
export async function createPaper(
  content: string,
  submissionKey: string,
): Promise<{ paper: { id: string }; total: number }> {
  const send = (): Promise<{ paper: { id: string }; total: number }> =>
    request("/api/papers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, submission_key: submissionKey }),
    });
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (err instanceof ApiError || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}
