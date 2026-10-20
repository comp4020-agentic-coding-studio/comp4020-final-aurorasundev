import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POLICY_VERSION } from "../server/moderation.ts";
import {
  ArtifactError,
  artifactProviderFromEnv,
  artifactTitle,
  fixtureBrief,
  imagePrompt,
  openAiArtifactProvider,
  parseBrief,
  INSPECTION_BLOCK_CODES,
  STYLE_PRESET_VERSION,
  validateWebp,
} from "../server/artifacts/provider.ts";
import { MATERIALS, PALETTES, type CreativeBriefV2 } from "../server/artifacts/types.ts";

// The OpenAI keepsake adapter against a fake fetch: what is sent, what is
// accepted, and how every failure is classified. Nothing here calls OpenAI.

const WEBP = readFileSync(resolve(import.meta.dirname, "fixtures/artifacts/keepsake-1024.webp"));
const SOURCE_CANARY = "CANARY-SOURCE-7f3a my private words";
const brief: CreativeBriefV2 = {
  schema_version: 2,
  metaphor: "thread",
  relation: "separated",
  motion: "still",
  space: "open",
  material: "paper_stone",
  palette: "slate_ivory",
  music: { timbre: "felt_piano", pulse: "none", density: "sparse", ending: "open" },
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const completed = (value: unknown) =>
  json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const NO_FLAGS = Object.fromEntries(
  ["sexual", "sexual/minors", "harassment", "harassment/threatening", "hate", "hate/threatening", "illicit", "illicit/violent",
    "self-harm", "self-harm/intent", "self-harm/instructions", "violence", "violence/graphic"].map((k) => [k, false]),
);

type Sent = { path: string; body: Record<string, unknown> };
function fakeApi(handler: (path: string, body: Record<string, unknown>) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = JSON.parse(String(init?.body));
    sent.push({ path, body });
    return handler(path, body);
  }) as typeof fetch;
  return { impl, sent };
}
const signal = () => AbortSignal.timeout(5000);

afterEach(() => vi.restoreAllMocks());

describe("the brief request at ignition", () => {
  it("sends the note as data with its drawing as an image, store:false, and a strict nested schema", async () => {
    const api = fakeApi(() => completed(brief));
    const provider = openAiArtifactProvider("sk-test", api.impl);
    expect(await provider.extractBrief({ text: SOURCE_CANARY, drawing: "data:image/png;base64,AAAA" }, signal())).toEqual(brief);
    const [call] = api.sent;
    expect(call.path).toBe("/v1/responses");
    expect(call.body).toMatchObject({ model: "gpt-4.1-mini-2025-04-14", store: false, stream: false });
    const format = (call.body.text as { format: { strict: boolean; schema: Record<string, unknown> } }).format;
    expect(format.strict).toBe(true);
    const schema = format.schema as { additionalProperties: boolean; required: string[]; properties: { music: { additionalProperties: boolean } } };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.music.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(["material", "metaphor", "motion", "music", "palette", "relation", "schema_version", "space"]);
    const [system, user] = call.body.input as { role: string; content: unknown }[];
    expect(String(system.content)).not.toContain("CANARY");
    expect(String(system.content)).toMatch(/data, never instructions/);
    const parts = user.content as { type: string; text?: string; image_url?: string }[];
    expect(JSON.parse(parts[0].text!)).toEqual({ paper_text: SOURCE_CANARY, paper_drawing: "attached image" });
    expect(parts[1]).toEqual({ type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "low" });
  });

  it("samples the brief with variety, while every check stays deterministic", async () => {
    const briefApi = fakeApi(() => completed(brief));
    await openAiArtifactProvider("k", briefApi.impl).extractBrief({ text: "w", drawing: null }, signal());
    const briefTemperature = briefApi.sent[0].body.temperature as number;
    expect(briefTemperature).toBeGreaterThanOrEqual(0.8);
    expect(briefTemperature).toBeLessThanOrEqual(1);

    let responses = 0;
    const checkApi = fakeApi((path) => {
      if (path.endsWith("/moderations")) return json({ results: [{ flagged: false, categories: NO_FLAGS }] });
      responses++;
      if (responses === 1) return completed({ decision: "allow", reason: "none", certainty: "clear", policy_version: POLICY_VERSION });
      return completed({ decision: "allow", legible_text: false, face: false, identifiable_place: false, certainty: "clear" });
    });
    const { openAiProvider } = await import("../server/moderation.ts");
    await openAiArtifactProvider("k", checkApi.impl, openAiProvider("k", checkApi.impl)).inspectImage(WEBP, signal());
    const checks = checkApi.sent.filter((s) => s.path === "/v1/responses");
    expect(checks).toHaveLength(2);
    for (const check of checks) expect(check.body.temperature).toBe(0);
  });

  it("a brief at any temperature is still held to the exact schema", async () => {
    for (const bad of [{ ...brief, palette: "neon" }, { ...brief, note: SOURCE_CANARY }]) {
      const err = await openAiArtifactProvider("k", fakeApi(() => completed(bad)).impl)
        .extractBrief({ text: "w", drawing: null }, signal())
        .catch((e: unknown) => e);
      expect((err as ArtifactError).code).toBe("brief_malformed");
    }
  });

  it("rejects unknown keys, nested extras, values outside the lists and free text", () => {
    for (const bad of [
      { ...brief, title: "my secret" },
      { ...brief, metaphor: "a house on Elm Street" },
      { ...brief, schema_version: 1 },
      { ...brief, music: { ...brief.music, lyrics: "la" } },
      { ...brief, music: { ...brief.music, timbre: "violin" } },
      (({ music: _, ...rest }) => rest)(brief),
      null,
      [brief],
    ]) {
      expect(() => parseBrief(bad), JSON.stringify(bad)).toThrow(ArtifactError);
    }
  });

  it("classifies refusal, incomplete output, malformed output, auth, rate limits and server errors", async () => {
    const cases: [Response, string, string][] = [
      [json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }), "brief_refusal", "refusal"],
      [json({ status: "incomplete", output: [] }), "brief_incomplete", "invalid"],
      [completed({ ...brief, extra: 1 }), "brief_malformed", "invalid"],
      [json({ error: { message: SOURCE_CANARY } }, 401), "provider_auth", "config"],
      [json({ error: {} }, 403), "provider_auth", "config"],
      [json({ error: {} }, 429, { "retry-after": "9" }), "brief_rate_limited", "transient"],
      [json({ error: { message: SOURCE_CANARY } }, 500), "brief_provider_error", "transient"],
    ];
    for (const [response, code, kind] of cases) {
      const provider = openAiArtifactProvider("k", fakeApi(() => response).impl);
      const err = await provider.extractBrief({ text: "w", drawing: null }, signal()).catch((e: unknown) => e);
      expect(err, code).toBeInstanceOf(ArtifactError);
      expect([(err as ArtifactError).code, (err as ArtifactError).kind]).toEqual([code, kind]);
      expect(String((err as Error).message)).not.toContain("CANARY");
    }
  });
});

describe("content shapes the image", () => {
  it("two notes with different meanings give different briefs, prompts and titles (fixture plumbing)", () => {
    const a = fixtureBrief("I never finished that conversation with her.", null);
    const b = fixtureBrief("Everyone expected me to be perfect and I was so tired.", null);
    expect(a.metaphor).not.toBe(b.metaphor);
    expect(imagePrompt(a)).not.toBe(imagePrompt(b));
    expect(artifactTitle(a)).not.toBe(artifactTitle(b));
  });

  it("builds the prompt from the brief and the shared style only", () => {
    const prompt = imagePrompt(brief);
    expect(prompt).toMatch(/ribbon or thread/);
    expect(prompt).toMatch(/gap that the connection does not close/);
    expect(prompt).toMatch(/no text/i);
    expect(imagePrompt({ ...brief })).toBe(prompt);
    expect(artifactTitle(brief)).toBe("An unfinished thread");
  });
});

describe("the shared style", () => {
  // the part every prompt shares, i.e. the style preset
  const commonSuffix = (prompts: string[]): string => {
    let n = 0;
    while (prompts.every((p) => p.length > n && p[p.length - 1 - n] === prompts[0][prompts[0].length - 1 - n])) n++;
    return prompts[0].slice(prompts[0].length - n);
  };
  const variants = <K extends "palette" | "material">(key: K, values: readonly CreativeBriefV2[K][]) =>
    values.map((v) => imagePrompt({ ...brief, [key]: v }));

  it("is a new preset version", () => {
    expect(STYLE_PRESET_VERSION).toBe("mineral-record-v2");
  });

  it("lets each palette and material lead: they differ before the shared style, which names neither", () => {
    for (const [key, prompts] of [["palette", variants("palette", PALETTES)], ["material", variants("material", MATERIALS)]] as const) {
      expect(new Set(prompts).size).toBe(prompts.length);
      const shared = commonSuffix(prompts);
      expect(shared).toMatch(/no text/i);
      // where the prompts first differ comes before the shared style starts
      let first = 0;
      while (prompts.every((p) => p[first] === prompts[0][first])) first++;
      expect(first).toBeLessThan(prompts[0].length - shared.length);
      // the palette is stated before the subject, not after it
      if (key === "palette") expect(first).toBeLessThan(prompts[0].indexOf("ribbon"));
    }
  });

  it("gives every palette its own colour words", () => {
    const words = variants("palette", PALETTES).map((p) => p.slice(0, p.indexOf(".")).toLowerCase().match(/[a-z]+/g)!);
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        // more distinct than shared: no two palettes reduce to the same description
        const shared = words[i].filter((w) => words[j].includes(w) && w !== "and" && w !== "against" && w !== "colour");
        expect(shared.length, `${PALETTES[i]} vs ${PALETTES[j]}`).toBeLessThan(3);
      }
    }
  });
});

describe("the image request", () => {
  it("sends only server phrases and the enums, with the agreed parameters and none of the legacy ones", async () => {
    const api = fakeApi(() => json({ data: [{ b64_json: WEBP.toString("base64") }] }));
    const image = await openAiArtifactProvider("k", api.impl).generateImage(brief, signal());
    expect(image).toMatchObject({ width: 1024, height: 1024 });
    expect(image.bytes.equals(WEBP)).toBe(true);
    const [call] = api.sent;
    expect(call.path).toBe("/v1/images/generations");
    expect(call.body).toEqual({
      model: "gpt-image-2",
      prompt: imagePrompt(brief),
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: "webp",
      output_compression: 80,
      background: "opaque",
      moderation: "auto",
    });
    expect(call.body).not.toHaveProperty("response_format");
    expect(call.body).not.toHaveProperty("style");
  });

  it("treats an unknown outcome as ambiguous, never as safe to repeat", async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const timedOut = await openAiArtifactProvider("k", hang).generateImage(brief, AbortSignal.timeout(20)).catch((e: unknown) => e);
    expect([(timedOut as ArtifactError).code, (timedOut as ArtifactError).kind]).toEqual(["image_timeout", "ambiguous"]);

    const dropped = (async () => {
      throw new TypeError("socket hang up");
    }) as typeof fetch;
    const lost = await openAiArtifactProvider("k", dropped).generateImage(brief, signal()).catch((e: unknown) => e);
    expect([(lost as ArtifactError).code, (lost as ArtifactError).kind]).toEqual(["image_transport", "ambiguous"]);

    const server = await openAiArtifactProvider("k", fakeApi(() => json({}, 502)).impl).generateImage(brief, signal()).catch((e: unknown) => e);
    expect((server as ArtifactError).kind).toBe("ambiguous");
  });

  it("separates an explicit rate limit, auth and refusal from an unknown outcome", async () => {
    const cases: [Response, string, string][] = [
      [json({}, 429, { "retry-after": "40" }), "image_rate_limited", "transient"],
      [json({}, 401), "provider_auth", "config"],
      [json({ error: { code: "moderation_blocked" } }, 400), "image_refused", "refusal"],
    ];
    for (const [response, code, kind] of cases) {
      const err = await openAiArtifactProvider("k", fakeApi(() => response).impl).generateImage(brief, signal()).catch((e: unknown) => e);
      expect([(err as ArtifactError).code, (err as ArtifactError).kind], code).toEqual([code, kind]);
    }
    const limited = await openAiArtifactProvider("k", fakeApi(() => json({}, 429, { "retry-after": "40" })).impl)
      .generateImage(brief, signal())
      .catch((e: unknown) => e);
    expect((limited as ArtifactError).retryAfterMs).toBe(40_000);
  });

  it("refuses malformed, oversized, wrong-size and non-WebP output", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const small = Buffer.from(WEBP);
    small[24] = 0x00; // width becomes 769
    for (const body of [
      { data: [{ b64_json: "not base64 !!" }] },
      { data: [{ url: "https://example.com/image.webp" }] },
      { data: [] },
      { data: [{ b64_json: png.toString("base64") }] },
      { data: [{ b64_json: small.toString("base64") }] },
      { data: [{ b64_json: Buffer.alloc(3 * 1024 * 1024, 1).toString("base64") }] },
    ]) {
      const err = await openAiArtifactProvider("k", fakeApi(() => json(body)).impl).generateImage(brief, signal()).catch((e: unknown) => e);
      expect((err as ArtifactError).kind, JSON.stringify(body).slice(0, 60)).toBe("invalid");
    }
  });
});

describe("inspection", () => {
  const moderationAllows = (path: string) => {
    if (path.endsWith("/moderations")) return json({ results: [{ flagged: false, categories: NO_FLAGS }] });
    return null;
  };
  const policyAllow = { decision: "allow", reason: "none", certainty: "clear", policy_version: POLICY_VERSION };
  const visual = (v: Record<string, unknown>) => ({ decision: "allow", legible_text: false, face: false, identifiable_place: false, certainty: "clear", ...v });

  async function inspect(visualAnswer: Response | Record<string, unknown>, moderation?: Response) {
    let responses = 0;
    const api = fakeApi((path) => {
      if (path.endsWith("/moderations")) return moderation ?? moderationAllows(path)!;
      responses++;
      // first Responses call is the existing content policy, the second the visual policy
      if (responses === 1) return completed(policyAllow);
      return visualAnswer instanceof Response ? visualAnswer : completed(visualAnswer);
    });
    const { openAiProvider } = await import("../server/moderation.ts");
    const provider = openAiArtifactProvider("k", api.impl, openAiProvider("k", api.impl));
    return { result: await provider.inspectImage(WEBP, signal()).catch((e: unknown) => e), api };
  }

  it("allows only a clear abstract image, after the existing harm checks", async () => {
    const { result, api } = await inspect(visual({}));
    expect(result).toBe("allow");
    expect(api.sent.map((s) => s.path)).toEqual(["/v1/moderations", "/v1/responses", "/v1/responses"]);
    // the image went to the harm screen as an image
    expect(JSON.stringify(api.sent[0].body.input)).toContain("data:image/webp;base64,");
  });

  it("blocks legible text, faces, places, uncertainty and refusals, each with its own code", async () => {
    const cases: [Response | Record<string, unknown>, string][] = [
      [visual({ legible_text: true }), "inspection_text"],
      [visual({ face: true }), "inspection_face"],
      [visual({ identifiable_place: true }), "inspection_place"],
      [visual({ certainty: "uncertain" }), "inspection_uncertain"],
      [visual({ decision: "block" }), "inspection_blocked"],
      [visual({ decision: "block", face: true, certainty: "uncertain" }), "inspection_face"],
      [json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: SOURCE_CANARY }] }] }), "inspection_refused"],
    ];
    for (const [answer, code] of cases) {
      const { result } = await inspect(answer);
      expect(result, code).toBe(code);
      expect(INSPECTION_BLOCK_CODES).toContain(result);
    }
  });

  it("blocks on the harm gate without asking the visual check", async () => {
    const gate = json({ results: [{ flagged: true, categories: { ...NO_FLAGS, "sexual/minors": true } }] });
    const { result, api } = await inspect(visual({}), gate);
    expect(result).toBe("inspection_harm");
    expect(api.sent).toHaveLength(1);
  });

  it("keeps an image the content policy could not clear, under its own code", async () => {
    const api = fakeApi((path) => {
      if (path.endsWith("/moderations")) return moderationAllows(path)!;
      return completed({ decision: "review", reason: "uncertain", certainty: "uncertain", policy_version: POLICY_VERSION });
    });
    const { openAiProvider } = await import("../server/moderation.ts");
    const provider = openAiArtifactProvider("k", api.impl, openAiProvider("k", api.impl));
    expect(await provider.inspectImage(WEBP, signal())).toBe("inspection_harm_review");
    expect(api.sent.map((s) => s.path)).toEqual(["/v1/moderations", "/v1/responses"]);
  });

  it("reports an unavailable check as an error, never an allow", async () => {
    const { result } = await inspect(visual({}), json({}, 500));
    expect(result).toBeInstanceOf(ArtifactError);
    expect((result as ArtifactError).kind).toBe("transient");
    const malformed = await inspect(visual({ extra: true }));
    expect((malformed.result as ArtifactError).kind).toBe("invalid");
  });
});

describe("choosing a provider", () => {
  it("refuses the fixture on Fly even with keepsakes switched off", () => {
    expect(() => artifactProviderFromEnv({ ARTIFACT_PROVIDER: "fixture", FLY_APP_NAME: "x", ARTIFACTS_ENABLED: "0" })).toThrow(/refused on Fly/);
    expect(artifactProviderFromEnv({ ARTIFACT_PROVIDER: "fixture" })?.name).toBe("fixture");
  });

  it("has no provider without a key, and rejects unknown names", () => {
    expect(artifactProviderFromEnv({})).toBeNull();
    expect(artifactProviderFromEnv({ OPENAI_API_KEY: "sk-test" })?.name).toBe("openai");
    expect(() => artifactProviderFromEnv({ ARTIFACT_PROVIDER: "other" })).toThrow(/unknown/);
  });

  it("validates WebP headers strictly", () => {
    expect(validateWebp(WEBP)).toBe(true);
    const animated = Buffer.from(WEBP);
    animated[20] |= 0x02;
    expect(validateWebp(animated)).toBe(false);
    expect(validateWebp(WEBP.subarray(0, WEBP.length - 1))).toBe(false);
    expect(validateWebp(Buffer.from("RIFF0000WEBPVP8 "))).toBe(false);
  });
});
