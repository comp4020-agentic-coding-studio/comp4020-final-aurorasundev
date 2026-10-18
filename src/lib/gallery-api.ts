import { ApiError } from "./api.ts";

// The public Gallery's HTTP calls. Type-only shapes mirror the server's
// allowlisted objects; nothing here imports server code.

export type PublicArtifact = {
  id: string;
  version: number;
  image_url: string;
  width: 1024;
  height: 1024;
  title: string;
  alt: string;
};
export type GalleryPage = { revision: number; items: PublicArtifact[]; next_cursor: string | null; total: number };
export type GalleryChange =
  | { type: "artifact:published"; revision: number; total: number; artifact: PublicArtifact }
  | { type: "artifact:hidden"; revision: number; total: number; id: string; version: number };
export type ArtifactReportReason =
  | "threats_abuse"
  | "private_information"
  | "sexual_graphic"
  | "harmful_instructions"
  | "spam_scam"
  | "something_else";

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort);
  try {
    const res = await fetch(path, { credentials: "same-origin", ...init, signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (!res.ok) throw new ApiError(res.status, body.code ?? "unknown", body.error ?? "Something went wrong.");
    return body as T;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

export const getGalleryPage = (after?: string, signal?: AbortSignal): Promise<GalleryPage> =>
  request(`/api/gallery?limit=12${after ? `&after=${encodeURIComponent(after)}` : ""}`, { signal });

export const getArtifact = (id: string, signal?: AbortSignal): Promise<PublicArtifact> =>
  request(`/api/gallery/${encodeURIComponent(id)}`, { signal });

export const getGalleryConfig = (signal?: AbortSignal): Promise<{ generation_enabled: boolean }> =>
  request("/api/gallery/config", { signal });

// The op key is reused for a retry, so a lost reply gets the first receipt.
export async function reportArtifact(id: string, reason: ArtifactReportReason, opKey: string): Promise<{ report_id: string; status: "queued" }> {
  await request("/api/session", { method: "POST" });
  return request(`/api/gallery/${encodeURIComponent(id)}/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason, op_key: opKey }),
  });
}
