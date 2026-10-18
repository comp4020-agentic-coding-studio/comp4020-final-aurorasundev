# Record Gallery — technical design and illustrative code

Read [the selected visual direction and product proposal](design.md) first. **Direction A is selected: G01 desktop orbit, G02 focused record and G03 mobile.** This is a design blueprint. Code below illustrates boundaries and algorithms; it is not installed application code or a claim of browser/production verification. The original `plans-gallery-ai.md` remains untouched.

## 1. Reuse the working app

Local source inspected at `7204e31` already has Gallery HTTP/SSE, private image gating, moderation, reports, operator tools and revision-aware client state. The visible collection in `src/GalleryApp.tsx` is currently a square grid. `src/components/ArtifactDialog.tsx` shows an image and report flow. `src/lib/useGallery.ts` and `gallery-state.ts` should continue to own server truth; neither Three.js nor a music player becomes a second source of truth.

The existing scene dependency is Three.js 0.160.1. Add GSAP core/Observer only at implementation time and pin the resolved compatible version. Do not upgrade the furnace's Three dependency as part of the redesign, add React Three Fiber, introduce a second physics system, or install Lenis just because the reference uses it.

Proposed component/module boundary:

| Path | Change |
| --- | --- |
| `src/GalleryApp.tsx` | Compose collection state, orbit/fallback, record view and one player |
| `src/components/GalleryOrbit.tsx` — new | HTML host and semantic controls; mount/dispose the isolated scene |
| `src/scene/gallery-orbit.ts` — new | Disc, image planes, layout, raycasting, textures and GSAP phase/transition controller |
| `src/components/GalleryGridFallback.tsx` — new | Reuse the current grid for no-WebGL/reduced-motion access; no duplicated fetch logic |
| `src/components/ArtifactDialog.tsx` | Preserve native dialog/report behavior; restyle as the record focus view, add optional audio controls |
| `src/lib/gallery-audio.ts` — new | One audio element/graph, play/pause/stop/gain; no model calls |
| `src/lib/gallery-api.ts`, `gallery-state.ts`, `useGallery.ts` | Small DTO/version additions for track status; retain recovery and frozen reports |
| `server/papers.ts`, `server/artifacts/store.ts` | Capture eligible source immediately before the successful burn; replace neutral fallback with the ignition brief path |
| `server/artifacts/provider.ts`, `types.ts`, `worker.ts` | Versioned content-derived brief; image prompt preset; durable derivative-only jobs |
| `server/artifacts/music.ts` — new | Optional real music provider and bounded private audio output |
| `server/artifacts/router.ts`, `events.ts` | Authorized audio file serving and artifact-updated event |
| `server/db.ts` | Append the next migration for derivative/music metadata if required; current shipped migrations remain immutable |

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

A constrained shared shape can start like this:

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

This is a proposed vocabulary for review, not a schema already shipped. Use strict JSON Schema, required keys, additionalProperties=false at every nested level, and local validation. No arbitrary source summary or free-text image/music prompt is stored. The image prompt builder expands every visual field into server-owned phrases; the music builder expands the musical fields plus the metaphor/relation. A matching art-style version is attached separately, so visual consistency does not erase content differences.

The extraction instruction must make the source untrusted data, include drawing input when present, choose visual/musical metaphors from its actual content and exclude diagnoses, names, addresses, quotations and literal reconstruction. Validate incomplete output/refusal; an enum-valid answer is not proof it came from a note. The server must bind the response to the fresh burn's captured source and private lease.

Use [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) through the existing adapter. Image generation continues through the existing [Images API](https://developers.openai.com/api/reference/resources/images/methods/generate), using the selected common style and this note's validated brief. These interfaces do not establish account access or output quality.

Tests should inspect requests as well as results: image/music requests contain the validated symbolic fields, never a note body, drawing data URI, raw summary or paper/owner ID. Different synthetic source meanings must produce different relevant briefs in a real-provider evaluation before aesthetic claims are made. Fixtures test plumbing, not model understanding.

## 5. Extract at ignition without changing the fire protocol

Recommended event sequence:

```text
confirm drop / Place with the existing op_key
  → read a bounded private source snapshot, synchronously
  → existing burnPaper transaction checks rights and wins ACTIVE transition
  → clear content and drawing; commit the existing burn receipt
  → respond / broadcast existing paper:destroyed immediately
  → clients play the existing 4800 ms burn
  → one in-memory extraction request works alongside that animation
  → persist validated CreativeBriefV2 only
  → image job → inspect → publish; optional music job → check/review → attach
```

Never start the creative request for an unsuccessful/duplicate operation. A read snapshot is discarded if burnPaper reports forbidden, paper_gone, op_conflict or fresh=false. Capture and conditional burn must happen without an intervening await; mode/content immutability and the conditional ACTIVE update prevent a stale snapshot from winning against quarantine. Read only the eligible Release source; Keep does not call the creative provider.

Use the existing burn operation receipt as the final result. Do not add a new 202 pre-burn protocol, an AI wait inside SQL, a new author checkbox, a global animation lock or per-frame events. The server's private snapshot must never be added to the public Burned result/JSON or paper SSE. Use an explicit public response allowlist.

The in-memory extractor is not a durable source queue. Reserve a lease/token on the metadata-only job, bound extraction time (initial proposal: 8 seconds), and limit concurrent source requests (initial proposal: 4). A duplicate burn cannot launch another request. If processing is unavailable, at capacity or interrupted by restart, mark the creative result unavailable, clear references and allow the already-committed burn to finish normally. Do not keep the original in SQLite so that it can be retried tomorrow.

Once a valid brief is durable, image/music jobs can retry within bounded policies without their source. A restart while source extraction is pending marks that source-lost attempt failed, rather than switching to neutralRecipe or pretending a new recipe was reconstructed. A late response must still match its lease, job state and allowed record state before it is accepted.

Publish no image before `destroyed_at + burn_duration_ms` as a presentation guard. After that, actual generation/inspection can take longer. This preserves current owner/spectator burn timing; AI latency is not added to the paper SSE contract. This intentionally does **not** guarantee strict equality between actual network duration and flame duration.

This source-handling rule is a change from the earlier plan: original data may exist transiently in the single in-flight processing request after database deletion. It is never a persisted retry payload. JavaScript garbage collection and a remote service do not provide an instant zero-retention guarantee; do not claim they do.

## 6. Music API and private audio assets

Proposed target: real model-generated 24-second instrumental audio, using the same validated brief. One candidate request shape, based on the official [compose API](https://elevenlabs.io/docs/api-reference/music/compose):

```http
POST https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128
Content-Type: application/json
xi-api-key: <read from the server secret store>
```

```json
{
  "model_id": "music_v2",
  "music_length_ms": 24000,
  "force_instrumental": true,
  "store_for_inpainting": false,
  "prompt": "A sparse 24-second instrumental miniature. Felt piano, a slow pulse with long rests, an interrupted thread-like motif and an open ending. Gentle dynamics. No lyrics, speech, voice imitation or alarms."
}
```

That prompt is an invented example expanded from allowed brief values; it is not sent for every record. Do not provide seed alongside the prompt form without checking the provider's current schema. Music account/model access, costs, rights for the intended publication and real output quality need verification before activation. No paid call or credential configuration is part of this design task.

A small durable audio job can be unique by artifact ID and generation version, storing status, attempts, safe error, lease, private file key and duration. It holds no original source or raw provider response. Generate audio only after a valid content brief and an accepted image exist, so rejected images do not trigger unnecessary audio calls. Start with music disabled and a low operator-set daily limit (proposal: 5 requests/day); never silently substitute stock loops when the provider is unavailable.

Use a bounded private MP3 file (proposal: 2 MiB maximum for the short piece), atomic finalization and actual duration validation. Count audio against the existing volume's managed-byte capacity, not an unlimited new folder. Unknown result after dispatch follows the existing image rule: no automatic second paid generation; operator acknowledgement before a potentially charged retry. Image publication remains independent.

Pure instrumental settings reduce spoken-content risk but do not make the image moderator an audio moderator. Initially keep generated audio private until format/duration/level checks and an operator listening review pass. An eventual unattended audio-content policy needs its own verified detection/review path. Do not expose a 'reviewed' status just because an MP3 decoded successfully.

## 7. Public media contract and playback

A proposed backward-compatible addition to PublicArtifact:

```ts
type PublicAudio =
  | { status: 'pending' }
  | { status: 'unavailable' }
  | { status: 'ready'; url: string; duration_ms: number };
// PublicArtifact adds: audio?: PublicAudio
```

An absent field means a legacy/image-only record, never a fabricated track. Public fields contain no provider, original paper ID, source-derived narrative or private error detail. A new `artifact:updated` event carries the allowlisted object with a higher version and Gallery revision when an audio attachment becomes public. It does not change paper count or spin/reorder the orbit.

`GET /api/gallery/:id/audio` must check current PUBLISHED state, serve only a server-owned file, use no-store semantics and support valid byte ranges for browser seeking. Hidden/missing returns 404. Existing artifact:hidden closes the detail and stops audio immediately; removal gates both image/audio before unlink. No unrestricted static directory or stable ungated external audio URL.

Use one HTMLAudioElement per Gallery page, not one element for every artwork or a new one on every frame. If an analyser/fade is needed, create one MediaElementAudioSource/AudioContext/GainNode graph and reuse it. Resume the context and request play from the explicit user's action, handle rejected playback, fade with the audio clock, then pause/reset. Control volume in one place. Visibility change, unmount and record hide stop sound.

[Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) inform user-gesture startup. Web Audio plays/synthesizes sound; Three.js visualizes it. Neither is the external AI music generator. A simple waveform can use actual analyser data or peaks derived from the actual file; no decorative fake playing state.

## 8. Loading and responsiveness

- Metadata/reconnect/report state reuse current hooks. Render at most about 7 sleeve meshes on desktop and 4 on phones, backed by a bounded loaded collection; do not mount 200 GPU textures.
- Keep full square image URLs private/state-gated. Prefer a future inspected thumbnail variant for orbit textures; until available load only the few visible assets, never upsample a tiny crop as the detail image.
- At 1024², an RGBA GPU texture is roughly 4 MiB before mipmaps; many WebP files that are small on the network still consume GPU memory after decoding. Dispose texture/geometry/material resources on window change and scene unmount.
- Start pixel ratio caps around 1.5 desktop / 1.25 phone and measure. Stop idle rendering when hidden; use no full-resolution postprocessing by default. Do not claim target FPS until measured on a real browser/device.
- Album artwork and music must not preload during room entry. Set audio preload=none; playback fetch begins after explicit action.
- Below about 600 CSS pixels, use a compact arrangement like G03, not a scaled-down desktop screenshot. Above/below-stage HTML has reserved space. Controls remain 44 px and input text at least 16 px.
- Detail on phone stacks full art, title and player. On short landscape screens allow the detail content to scroll naturally instead of trapping gestures in the orbit.
- For reduced motion/no WebGL/context loss, reuse the existing grid and dialog. Maintain an equivalent accessible collection of the visible orbit's real records; suppress purely decorative canvas duplication from assistive technology.

## 9. Checks needed before calling this implemented

| Boundary | Evidence needed |
| --- | --- |
| Meaning | Synthetic notes with different meaning, source-request inspection, validated different relevant briefs, actual image review |
| Privacy | Source canaries absent from new tables/files/logs/public DTOs; only transient at-ignition request carries source |
| Minimal burn changes | Existing burn/witness/drawing/quarantine/idempotency suites; burn response does not wait for model; original cleared in the same transaction |
| Timing | Early and late extraction with fake clocks; normal 4.8-second fire; late image cannot appear before the allowed presentation time |
| Recovery | Duplicate op dispatches once; restart during volatile extraction fails honestly; derivative-ready jobs recover; no neutral fallback |
| Live collection | Arrival during drag does not shift current focus; hiding stops audio; reconnect/out-of-order HTTP cannot restore hidden media |
| Audio | Single player, user-action-only start, pause/close/leave handling, actual duration/waveform, unavailable state, gated range requests |
| Visual | Browser comparison against chosen concept at 1920, 1366, 1280 and 390 widths; selected full image is inspectable; controls do not collide |
| Performance | Network/build inspection proves lazy isolation; bounded GPU memory; phone input and a real browser audio check |

No product tests, music calls or real-note source processing were run for this design-only deliverable. The checks above belong to a later authorized implementation and verification pass.
