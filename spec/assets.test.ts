import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

it("serves the same built script compressed or uncompressed with separate cache variants", async () => {
  const page = await (await fetch(baseUrl)).text();
  const entry = page.match(/<script[^>]+src="([^"]+\.js)"/);
  expect(entry, "Build the client before checking production asset delivery").not.toBeNull();
  const url = new URL(entry![1], baseUrl);
  const compressed = await fetch(url, { headers: { "Accept-Encoding": "gzip" } });
  const plain = await fetch(url, { headers: { "Accept-Encoding": "gzip;q=0, identity" } });
  expect(compressed.status).toBe(200);
  expect(plain.status).toBe(200);
  expect(compressed.headers.get("content-encoding")).toBe("gzip");
  expect(plain.headers.get("content-encoding")).toBeNull();
  expect(compressed.headers.get("vary")).toContain("Accept-Encoding");
  expect(plain.headers.get("vary")).toContain("Accept-Encoding");
  expect(compressed.headers.get("cache-control")).toContain("immutable");
  expect(compressed.headers.get("content-type")).toContain("javascript");
  expect(Number(compressed.headers.get("content-length"))).toBeLessThan(Number(plain.headers.get("content-length")) / 2);
  expect(await compressed.text()).toBe(await plain.text());
});
