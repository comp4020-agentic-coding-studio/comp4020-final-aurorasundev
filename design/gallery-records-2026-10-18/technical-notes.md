# Record Gallery — technical design and illustrative code

Read [the selected visual direction and product proposal](design.md) first. **Direction A is selected: G01 desktop orbit, G02 focused record and G03 mobile.** This is a design blueprint. Code below illustrates boundaries and algorithms; it is not installed application code or a claim of browser/production verification. The original image-Gallery plan is historical; its amendment links to the selected [music design](music-design.md). Music remains designed, not implemented.

## 1. Reuse the working app

Baseline `9501f73`, rechecked against `cb0d337`, already has the record exhibition, `RecordView.tsx`, Gallery HTTP/SSE, private image gating, moderation, reports, operator tools and revision-aware client state. Keep those implementations. `src/lib/useGallery.ts` and `gallery-state.ts` continue to own server truth; neither Three.js nor a player becomes a second source of truth.

The existing scene dependencies are Three.js 0.160.1 and GSAP 3.15.0. Reuse them; music adds no runtime dependency. Do not upgrade the furnace's Three dependency as part of the redesign, add React Three Fiber, introduce a second physics system, or install Lenis just because the reference uses it.

Current boundaries and proposed music changes (the complete score/player contract is in [music-design.md](music-design.md)):

| Path | Change |
| --- | --- |
| `src/GalleryApp.tsx` | Compose collection state, orbit/fallback, record view and one player |
| `src/components/GalleryOrbit.tsx` — existing | HTML host and semantic controls; mount/dispose the isolated scene |
| `src/scene/gallery-orbit.ts` — existing | Disc, image planes, layout, raycasting, textures and GSAP phase/transition controller |
| `src/components/GalleryGridFallback.tsx` — existing | Reuse the current grid for no-WebGL/reduced-motion access; no duplicated fetch logic |
| `src/components/RecordView.tsx` | Preserve native dialog/report behavior; replace its disabled player slot with truthful music controls |
| `src/lib/gallery-audio.ts`, `useGalleryAudio.ts` — new | One Web Audio controller, short offline rendering, reusable PCM, pause/resume/stop/gain; no model calls |
| `src/lib/gallery-api.ts`, `gallery-state.ts`, `useGallery.ts` | Small DTO/version additions for track status; retain recovery and frozen reports |
| `server/papers.ts` | Preserve the completed ignition capture/burn/settled protocol unchanged |
| `server/artifacts/provider.ts`, `types.ts`, `worker.ts`, `store.ts` | Preserve current brief/image work; compose the optional score only in guarded image publication |
| `shared/music-score.ts` — new | Browser-safe score contract/validation and deterministic composition from the existing validated brief |
| `server/artifacts/router.ts`, `server/index.ts` | Gated score JSON and separate music flag; retain existing publication/hide events |
| `server/db.ts` | Append the next migration after v9 for nullable `artifacts.music_score`; shipped migrations remain immutable |

The Gallery continues to be lazy-loaded through the existing entry point. Its scene imports no `paper-scene.js`, furnace, fire or cannon module. The main room imports no Gallery motion/audio provider. Backend keys never enter Vite client variables.

## 2. Orbital geometry: one phase, not independently animated cards

Use an orthographic camera, one shared phase and an ellipse tilted in screen space. Depth and a small explicit scale change make near sleeves larger; orthographic projection alone does not create perspective scaling. The centre disc is a separate object showing the current focus.

The following original layout helpers are self-contained illustrative TypeScript, not copied site source:

```ts
const TAU = Math.PI * 2;
const FRONT = -Math.PI / 2;
const mod = (n: number, length: number) => ((n % length) + length) % length;

export function orbitPose(index: number, count: number, phase: number) {
  if (count < 1) throw new RangeError('An orbit needs an item');
  const angle = index * TAU / count + phase;
  const tilt = -0.22;
  const x = 2.8 * Math.cos(angle);
  const y = 1.45 * Math.sin(angle);
  const near = (1 - Math.sin(angle)) / 2;
  return {
    x: x * Math.cos(tilt) - y * Math.sin(tilt),
    y: x * Math.sin(tilt) + y * Math.cos(tilt),
    z: -0.6 + near * 1.2,
    scale: 0.62 + near * 0.38,
    rotateY: Math.cos(angle) * 0.20,
  };
}

export function nearestDetent(phase: number, count: number) {
  if (count < 1) throw new RangeError('An orbit needs an item');
  const step = TAU / count;
  const unwrappedIndex = Math.round((FRONT - phase) / step);
  return {
    index: mod(unwrappedIndex, count),
    phase: FRONT - unwrappedIndex * step,
  };
}
```

Production radii come from available stage bounds and the chosen G01/G03 composition. Use a one-item display for count=1 rather than running a huge empty ring. Keep a centre exclusion zone so sleeves never block the active record's label or HTML controls. Rendering is clipped to the stage, not allowed to make the whole page horizontally scroll.

Input changes a target phase. One ticker applies damped motion and updates transforms; do not call React setState for every rendered frame. When a gesture settles, update a **focused ID** once. Only an explicit Open action changes the opened ID or fetches detail. Never perform a detail request or start playback for every wheel movement.

With GSAP Observer, scope `target` to the stage and observe wheel/pointer/touch. Normalize wheel delta modes, clamp extreme deltas and ignore pinch/zoom/modifier gestures. Pause the observer during detail/report interaction and scene transitions. Desktop can coast and snap; a phone swipe should settle from the gesture's starting index, with one intentional step for a normal short swipe, so half-finished drag and snap do not fight.

Motion proposal:

| Transition | Initial tuning target |
| --- | --- |
| Entry | 500–700 ms restrained reveal, no forced boot screen |
| Wheel/drag settle | About 300–500 ms, no repeated multi-second lock |
| Open/close focus | 650–800 ms, reversible, preserve selected ID |
| Record rotation while playing | Slow visual turn, independent of audio pitch/clock |
| Pause/close fade | About 150–250 ms for audio; subtle disc deceleration |
| Reduced motion | Still image collection and ordinary dialog/player; no idle spin |

These are tuning targets, not measured performance. The [GSAP Observer API](https://gsap.com/docs/v3/Plugins/Observer/) provides the input layer; [Three's orthographic camera](https://threejs.org/docs/pages/OrthographicCamera.html) provides projection. The implementation still needs our own selection, snapping and cleanup logic.

## 3. Record material and artwork planes

For the selected A direction, build a thin charcoal disc from ring/cylinder geometry, a small spindle hole, restrained groove normal/roughness detail and a circular paper label. Use MeshStandardMaterial for most surfaces.

No new GLB or Cinema4D workflow is necessary for this shape. Square image planes use real generated textures and soft contact/shadow treatment. Use sRGB image textures with colour handling compatible with r160. Do not add full-screen bloom or expensive flow-map distortion to make the first version seem more complex. A subtle dither can be confined to the art/record treatment; UI text must remain crisp.

The selected disc label, square sleeve and opened image reference **the same artifact image**, not separately regenerated variants. G01/G02/G03 contain illustrative variations of the same motif because they are generated concepts. Runtime must use one actual asset consistently.

### Fixed materials are now available

Use the material files already generated in `public/textures/gallery/`: `vinyl-face.png`, `vinyl-grooves-height.png`, `paper-stock.jpg`, `sleeve-frame.png` and `mineral-surface.jpg`. Their public URL prefix is `/textures/gallery/`. See [the exact state/material mapping and layer order](design.md#13-fixed-visual-assets-and-where-to-use-them) and [the machine-readable manifest](../../public/textures/gallery/manifest.json).

A 2D/plane-based record may use the transparent vinyl face over its content-generated label. A physically lit geometry version uses the groove height as NoColorSpace bump data and a charcoal base; the bitmap front plate is then a fallback, not an additional shiny layer. Sleeve stock is shared with the blank label substrate, while dynamic note imagery stays separate. Transparent frame/face materials must preserve alpha so they cannot create an opaque central rectangle.

## 4. One versioned content-derived creative brief

The existing shared brief is already validated with this shape; reuse it unchanged for music:

```ts
export type CreativeBriefV2 = {
  schema_version: 2;
  metaphor: 'thread' | 'vessel' | 'threshold' | 'path' | 'seed' | 'stone';
  relation: 'separated' | 'connected' | 'under_pressure' | 'opening' | 'receding';
  motion: 'still' | 'unfolding' | 'drifting' | 'settling';
  space: 'enclosed' | 'open' | 'distant';
  material: 'paper_stone' | 'frosted_glass' | 'ink_fibre';
  palette: 'slate_ivory' | 'sage_charcoal' | 'cobalt_paper';
  music: {
    timbre: 'felt_piano' | 'soft_glass' | 'warm_pad';
    pulse: 'none' | 'slow';
    density: 'sparse' | 'layered';
    ending: 'open' | 'settled' | 'fading';
  };
};
```

This vocabulary is shipped in the branch, although its music fields are not performed yet. Preserve the current strict JSON Schema and local validation. No arbitrary source summary or free-text image/music prompt is stored. The image builder expands visual fields into server-owned phrases; the new deterministic score composer consumes the musical fields plus validated visual semantics. Keep its current extraction schema/model/output budget; no second model call is needed.

The extraction instruction must make the source untrusted data, include drawing input when present, choose visual/musical metaphors from its actual content and exclude diagnoses, names, addresses, quotations and literal reconstruction. Validate incomplete output/refusal; an enum-valid answer is not proof it came from a note. The server must bind the response to the fresh burn's captured source and private lease.

Use [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) through the existing adapter. Image generation continues through the existing [Images API](https://developers.openai.com/api/reference/resources/images/methods/generate), using the selected common style and this note's validated brief. These interfaces do not establish account access or output quality.

Tests should inspect requests as well as results: image requests contain only server phrases from validated fields, and music adds no external request at all. Score replies contain no note body, drawing data URI, raw summary or paper/owner ID. Different synthetic source meanings must produce different relevant briefs in a real-provider evaluation before aesthetic claims are made. Fixtures test plumbing, not model understanding.

## 5. Preserve the implemented ignition and fire protocol

Current sequence to preserve, with only local score composition added:

```text
confirm drop / Place with the existing op_key
  → read a bounded private source snapshot, synchronously
  → existing burnPaper transaction checks rights and wins ACTIVE transition
  → clear content and drawing; commit the existing burn receipt
  → respond / broadcast existing paper:destroyed immediately
  → clients play fire for at least 4800 ms, holding until extraction settles (15 s cap)
  → one existing in-memory extraction request works alongside that animation
  → persist validated CreativeBriefV2 only; existing extraction-settled signal
  → image job → inspect → compose optional local score → atomically publish both
```

Never start the creative request for an unsuccessful/duplicate operation. A read snapshot is discarded if burnPaper reports forbidden, paper_gone, op_conflict or fresh=false. Capture and conditional burn must happen without an intervening await; mode/content immutability and the conditional ACTIVE update prevent a stale snapshot from winning against quarantine. Read only the eligible Release source; Keep does not call the creative provider.

Use the existing burn operation receipt as the final result. Do not add a new 202 pre-burn protocol, an AI wait inside SQL, a new author checkbox, a global animation lock or per-frame events. The server's private snapshot must never be added to the public Burned result/JSON or paper SSE. Use an explicit public response allowlist.

The in-memory extractor is not a durable source queue. Reserve a lease/token on the metadata-only job, preserve its current 15-second-from-burn deadline and limit of four concurrent source requests. A duplicate burn cannot launch another request. If processing is unavailable, at capacity or interrupted by restart, mark the creative result unavailable, clear references and allow the already-committed burn to finish normally. Do not keep the original in SQLite so that it can be retried tomorrow.

Once a valid brief is durable, existing image jobs follow their bounded retry policy without their source. Music is a pure local composition at publication, not another provider job. A restart while source extraction is pending marks that source-lost attempt failed, rather than switching to neutralRecipe or pretending a new recipe was reconstructed. A late response must still match its lease, job state and allowed record state before it is accepted.

Preserve the current stored publication guard and extraction-settled behavior. Image generation/inspection can take longer than the fire. Music adds no HTTP wait, timer, source request or paper SSE event; it must not restore the superseded fixed-fire recommendation.

This source-handling rule is a change from the earlier plan: original data may exist transiently in the single in-flight processing request after database deletion. It is never a persisted retry payload. JavaScript garbage collection and a remote service do not provide an instant zero-retention guarantee; do not claim they do.

## 6. Selected music contract: stored score, no new provider

The owner selected **existing OpenAI parameters → deterministic score → Web Audio**. [music-design.md](music-design.md) is the authoritative end-to-end design; [ADR 006](../../docs/adr/006-browser-synthesised-record-music.md) records its alternatives and costs. This replaces the external music-service, private MP3 and extra audio-job proposal.

Reuse `CreativeBriefV2` unchanged. At accepted-image publication, compose and save one bounded 24-second `MusicScoreV1` with a fresh fixed seed, exact note events and pinned composer/renderer versions. The next append-only migration adds nullable `artifacts.music_score`. Music validation failure preserves the accepted image; existing null/legacy records remain image-only. No backfill, new paid request, original reread, music quota or new SSE event is part of v1.

## 7. Public score contract and one browser player

`PublicArtifact.music` is optional: absent/unavailable for image-only records, or `{status:'ready', score_version:1, duration_ms:24000}`. Keep scores out of collection pages and SSE. New read-only `GET /api/gallery/:id/score` checks current publication and proposed `GALLERY_MUSIC_ENABLED` (default off), returning only artifact ID/version plus the validated score, with no-store caching. Hidden/missing/unavailable returns 404; GET never creates work. Existing publication/hide events retain their meaning.

On explicit Play, synchronously create/resume the one live AudioContext before asynchronous work, read the score, and lazy-load the synthesis engine. OfflineAudioContext renders a short mono buffer; AudioBufferSourceNode plays it. Pause saves its audio-clock offset and stops that single-use source; Resume makes a new source into the same buffer; Replay starts at zero. Volume and 200 ms fades use GainNode automation. No HTMLAudioElement, MP3, external sample or range request is needed.

Keep one completed PCM buffer and one offline render in flight. Token/selection/version guards reject late results. Switch, close, reporting, hide, reconnect, hidden tab and route exit stop sound. Never auto-resume. Progress follows the audio clock, waveform bins come from actual PCM, and reduced motion suppresses visual spin without removing sound. The complete schema, timbres, timing, UI states, versioning and verification requirements are specified once in [the music design](music-design.md).

## 8. Loading and responsiveness

- Metadata/reconnect/report state reuse current hooks. Render at most about 7 sleeve meshes on desktop and 4 on phones, backed by a bounded loaded collection; do not mount 200 GPU textures.
- Keep full square image URLs private/state-gated. Prefer a future inspected thumbnail variant for orbit textures; until available load only the few visible assets, never upsample a tiny crop as the detail image.
- At 1024², an RGBA GPU texture is roughly 4 MiB before mipmaps; many WebP files that are small on the network still consume GPU memory after decoding. Dispose texture/geometry/material resources on window change and scene unmount.
- Start pixel ratio caps around 1.5 desktop / 1.25 phone and measure. Stop idle rendering when hidden; use no full-resolution postprocessing by default. Do not claim target FPS until measured on a real browser/device.
- No music engine, score fetch, AudioContext or PCM allocation during room entry, Gallery browsing or detail opening. Score fetch and lazy synthesis begin only after explicit Play; image loading remains unchanged.
- Below about 600 CSS pixels, use a compact arrangement like G03, not a scaled-down desktop screenshot. Above/below-stage HTML has reserved space. Controls remain 44 px and input text at least 16 px.
- Detail on phone stacks full art, title and player. On short landscape screens allow the detail content to scroll naturally instead of trapping gestures in the orbit.
- For reduced motion/no WebGL/context loss, reuse the existing grid and dialog. Maintain an equivalent accessible collection of the visible orbit's real records; suppress purely decorative canvas duplication from assistive technology.

## 9. Checks needed before calling this implemented

| Boundary | Evidence needed |
| --- | --- |
| Meaning | Synthetic notes with different meaning, source-request inspection, validated different relevant briefs, actual image review |
| Privacy | Source canaries absent from new tables/files/logs/public DTOs; only transient at-ignition request carries source |
| Minimal burn changes | Existing burn/witness/drawing/quarantine/idempotency suites; burn response does not wait for model; original cleared in the same transaction |
| Timing | Preserve existing early/late extraction and 4.8–15-second fire tests; music adds no request, wait or paper event |
| Recovery | Duplicate op dispatches once; restart during volatile extraction fails honestly; derivative-ready jobs recover; no neutral fallback |
| Live collection | Arrival during drag does not shift current focus; hiding stops audio; reconnect/out-of-order HTTP cannot restore hidden media |
| Music | Deterministic stored score; zero extra AI calls; one player; actual 24-second PCM/progress; pause/resume/races/disposal; gated score reads |
| Visual | Browser comparison against chosen concept at 1920, 1366, 1280 and 390 widths; selected full image is inspectable; controls do not collide |
| Performance | Network/build inspection proves lazy isolation; bounded GPU memory; phone input and a real browser audio check |

No product tests, music calls or real-note source processing were run for this design-only deliverable. The checks above belong to a later authorized implementation and verification pass.
