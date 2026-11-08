const base = process.argv[2];
const j = (o) => ({ "Content-Type": "application/json", ...o });
async function session() { const r = await fetch(base + "/api/session", { method: "POST" }); return r.headers.get("set-cookie").split(";")[0]; }
const save = (c, body) => fetch(base + "/api/papers", { method: "POST", headers: j({ Cookie: c }), body: JSON.stringify({ confirmed: true, ...body }) });
const tally = (arr) => arr.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {});
const t = Date.now();

// 1. 100 concurrent saves from 50 people
const cs = await Promise.all(Array.from({ length: 50 }, session));
let rs = await Promise.all(cs.flatMap((c, i) => [0, 1].map((k) => save(c, { content: `stress ${i}-${k}`, mode: k ? "KEEP" : "RELEASE", submission_key: crypto.randomUUID() }))));
console.log("1. 100 concurrent saves:", tally(rs.map((r) => r.status)), `${Date.now() - t} ms`);
let list = await (await fetch(base + "/api/papers")).json();
console.log("   papers in space:", (list.papers ?? list).length);

// 2. same submission_key ten times at once -> one paper
const key = crypto.randomUUID();
rs = await Promise.all(Array.from({ length: 10 }, () => save(cs[0], { content: "dup", mode: "KEEP", submission_key: key })));
const ids = new Set(await Promise.all(rs.map(async (r) => { const b = await r.json(); return b.id ?? b.paper?.id; })));
console.log("2. same key x10:", tally(rs.map((r) => r.status)), "distinct ids:", ids.size);

// 3. 20 readers witness one Release paper at once
const r0 = await (await save(cs[1], { content: "race target", mode: "RELEASE", submission_key: crypto.randomUUID() })).json();
const pid = r0.id ?? r0.paper?.id;
const readers = await Promise.all(Array.from({ length: 20 }, session));
const receipts = await Promise.all(readers.map(async (c) => (await (await fetch(`${base}/api/papers/${pid}`, { headers: { Cookie: c } })).json()).read_receipt));
rs = await Promise.all(readers.map((c, i) => fetch(`${base}/api/papers/${pid}/witness`, { method: "POST", headers: j({ Cookie: c }), body: JSON.stringify({ read_receipt: receipts[i] }) })));
console.log("3. 20 concurrent witnesses:", tally(rs.map((r) => r.status)));
// repeat witness by the same person counts once
await Promise.all([0, 1, 2].map(() => fetch(`${base}/api/papers/${pid}/witness`, { method: "POST", headers: j({ Cookie: readers[0] }), body: JSON.stringify({ read_receipt: receipts[0] }) })));
const after = await (await fetch(`${base}/api/papers/${pid}`, { headers: { Cookie: readers[0] } })).json();
console.log("   witness_count:", after.witness_count, "(expect 20)");

// 4. all 20 burn at once -> exactly one wins
const ops = readers.map(() => crypto.randomUUID().replace(/-/g, ""));
rs = await Promise.all(readers.map((c, i) => fetch(`${base}/api/papers/${pid}/burn`, { method: "POST", headers: j({ Cookie: c }), body: JSON.stringify({ read_receipt: receipts[i], op_key: ops[i], confirmed: true }) })));
const st = rs.map((r) => r.status); console.log("4. 20 concurrent burns:", tally(st));
const winner = st.indexOf(200);
if (winner >= 0) {
  const replay = await fetch(`${base}/api/papers/${pid}/burn`, { method: "POST", headers: j({ Cookie: readers[winner] }), body: JSON.stringify({ read_receipt: receipts[winner], op_key: ops[winner], confirmed: true }) });
  console.log("   winner replays its key:", replay.status);
}
const gone = await fetch(`${base}/api/papers/${pid}`, { headers: { Cookie: readers[0] } });
console.log("   paper afterwards:", gone.status);

// 5. SSE: 70 streams from one address
const ctrls = []; const sse = [];
for (let i = 0; i < 70; i++) { const ac = new AbortController(); ctrls.push(ac); sse.push(fetch(base + "/api/events", { signal: ac.signal, headers: { Cookie: cs[i % 50] } }).then((r) => r.status).catch(() => "err")); }
console.log("5. 70 streams from one address:", tally(await Promise.all(sse)));
// 6. live latency while 59 streams are open: one listener measures save->event
const ac = new AbortController();
const r = await fetch(base + "/api/events", { signal: ac.signal, headers: { Cookie: cs[0] } });
console.log("6. extra listener status:", r.status);
ctrls.forEach((c) => c.abort());
await new Promise((ok) => setTimeout(ok, 300));
const ac2 = new AbortController();
const r2 = await fetch(base + "/api/events", { signal: ac2.signal, headers: { Cookie: cs[0] } });
const reader = r2.body.getReader(); const dec = new TextDecoder();
await reader.read(); // snapshot
const lat = [];
for (let i = 0; i < 10; i++) {
  const t0 = performance.now();
  const p = save(cs[2 + i], { content: "lat", mode: "KEEP", submission_key: crypto.randomUUID() });
  for (;;) { const { value } = await reader.read(); if (dec.decode(value).includes("paper")) break; }
  lat.push(performance.now() - t0); await p;
}
console.log("   after closing: listener", r2.status, "save->event ms:", lat.map((x) => x.toFixed(0)).join(","));
ac2.abort(); ac.abort();
console.log("total", Date.now() - t, "ms");
