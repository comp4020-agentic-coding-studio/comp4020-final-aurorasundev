import { randomUUID } from "node:crypto";
import { inject } from "vitest";

// A visitor as the server sees one: a session cookie, nothing else.
const baseUrl = inject("baseUrl");
export const url = (path: string): URL => new URL(path, baseUrl);

export type Visitor = { cookie: string };

export async function visitor(): Promise<Visitor> {
  const res = await fetch(url("/api/session"), { method: "POST" });
  return { cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

export const post = (who: Visitor | null, path: string, body: Record<string, unknown>): Promise<Response> =>
  fetch(url(path), {
    method: "POST",
    headers: { "content-type": "application/json", ...(who ? { cookie: who.cookie } : {}) },
    body: JSON.stringify(body),
  });

export async function leave(who: Visitor, mode: "KEEP" | "RELEASE", content = `paper ${randomUUID()}`) {
  const res = await post(who, "/api/papers", { content, mode, confirmed: true, submission_key: randomUUID() });
  if (res.status !== 201) throw new Error(`save answered ${res.status}`);
  return ((await res.json()) as { paper: { id: string } }).paper.id;
}

export type Opened = {
  id: string;
  content: string;
  mode: string;
  version: number;
  witness_count: number;
  viewer: { is_author: boolean; has_witnessed: boolean; can_burn: boolean };
  read_receipt: string;
};

export async function open(who: Visitor, id: string): Promise<Opened> {
  const res = await fetch(url(`/api/papers/${id}`), { headers: { cookie: who.cookie } });
  if (res.status !== 200) throw new Error(`open answered ${res.status}`);
  return (await res.json()) as Opened;
}

export const witness = (who: Visitor, id: string, receipt: string | undefined): Promise<Response> =>
  post(who, `/api/papers/${id}/witness`, { read_receipt: receipt });

export const total = async (): Promise<number> =>
  ((await (await fetch(url("/api/papers"))).json()) as { total: number }).total;
