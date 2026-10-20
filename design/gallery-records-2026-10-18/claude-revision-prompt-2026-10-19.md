# Claude prompt — Gallery repairs and the approved mist background

You are continuing Throwaway on `claude/gallery-ai-keepsakes`. Repair the six audited defects below and replace the Gallery backdrop with the newly supplied image. Implement the repairs; do not stop at analysis or a proposed plan.

Audit baseline: `c4ebee688839380d87af11736c9e00802f971d8c`, reviewed on 2026-10-19. Check the current branch and working tree first. Line numbers below refer to that baseline; locate the actual functions before editing. Preserve existing user changes, including `plans-gallery-ai.md` and the newly supplied asset/documentation. Do not reset the branch, discard files, rebuild the app from scratch, or return to the old grid-first design.

## 1. Product contract and references

Read these before editing:

- [Selected design](design.md), especially the latest background amendment in section 14.
- [Technical notes](technical-notes.md).
- [G01: desktop orbit](reference-images/G01-orbit-desktop-mineral.png).
- [G02: record detail](reference-images/G02-record-listening-desktop.png).
- [G03: phone orbit](reference-images/G03-orbit-mobile-mineral.png).
- `CLAUDE.md`, `docs/adr/005-release-keepsakes.md`, and `docs/artifacts-runbook.md`.

Only direction A is active. The owner's latest image named “唱片馆.png” is byte-identical to G01; use G01 as the portable reference.

Keep the anonymous, non-social exhibition: no original note, author, date, source link, ranking, likes, comments, personal history, or duplicate filler records. Only a successfully burned Release paper can produce a record. Keep never does. Release remains the only author choice, with its disclosure; do not add another Write opt-in.

The artwork must still derive from that particular burned note. Preserve the at-ignition in-memory extraction, the constrained CreativeBriefV2, source deletion in the burn transaction, idempotency, image inspection, gated media access, and the rule against neutral/random fallback art. Never store raw source text/drawing in jobs, logs, files, or retry payloads.

## 2. Required background replacement

**Use the supplied runtime asset directly:**

- Repository file: `public/textures/gallery/gallery-stage-mist-v2.jpg`
- Public URL: `/textures/gallery/gallery-stage-mist-v2.jpg`
- [Preview the actual clean background](../../public/textures/gallery/gallery-stage-mist-v2.jpg)
- 1584 × 993, opaque sRGB JPEG, 237,246 bytes.
- SHA-256: `f064130419ef58f0df9af7870672e466da264cf4d722e6cf34bb803754897512`.

This is the clean background plate reconstructed from G01: quiet pale sage/mineral-grey air above, fine restrained texture, and a broad soft WHITE ground-mist layer across the lower half. It contains no text, discs, sleeves, artwork, or object shadows. It is a static background material, not a replacement for the live exhibition.

Change `src/styles/gallery.css`, primarily `.records-surface` and its pseudo-elements. The current background combines `mineral-surface.jpg` at 0.7 opacity with additional gradients; this creates the wrong flat, coarse wall effect.

Required composition:

1. Keep a compatible mineral base colour as the loading fallback.
2. Render the new plate behind the interactive records/sleeves and behind native HTML.
3. Start with the plate at opacity 1, normal blending, no repeat, centred, and `cover` sizing. Tune responsive positioning only after visual comparison.
4. Remove or neutralise the old surface/gradient contribution on this Gallery background. Do not stack both texture files, add more grain, reduce the plate to a barely visible overlay, or wash out its white mist with another coloured layer.
5. Preserve the soft lower mist and gentle depth. Do not replace it with literal sky clouds, fire smoke, a hard wall/floor seam, or a heavy animated fog shader.
6. Keep interactive object shadows separate. Do not bake fake disc/sleeve shadows into the background.
7. Preserve colour fidelity: no dark blue theme, orange cast, artificial vignette, or global tint over the generated artworks.
8. Use one shared background layer. Preserve continuity when a record opens; G02 may retain a restrained detail overlay, but must not become a different room.
9. On phones, crop horizontally as needed while retaining the lower mist in the lower stage. Never stretch the image or repeat it as wallpaper. Check safe areas and short landscape screens.
10. Load this image only for the Gallery. The main paper room must not request it.

Keep the old `mineral-surface.jpg` file for compatibility; it is superseded as the active Gallery backdrop. Do not delete the other fixed materials or modify the paper room/furnace materials.

Visual acceptance: compare the live page against G01 at its approximately 8:5 framing, then check 1920×1080, 1366×768, 1280×720, 390×844, 390×480, and 844×390. The upper area must remain calm and the white cloud-like ground haze must be clearly present beneath the records. Do not claim pixel-identical recovery of background areas that were obscured in the reference. Match the visible colour, atmosphere, mist placement and hierarchy.

## 3. P1 — all records must remain reachable beyond the 48-item cap

Files to inspect: `src/lib/gallery-state.ts` (`bound`, `page` handling), `src/lib/useGallery.ts`, `src/GalleryApp.tsx`, and the orbit window integration.

Audited reproduction: load five pages of twelve records, for sixty records total. New pages are appended, then `bound()` deletes from the end. The last twelve records are discarded while the cursor advances to the end. Result: 48 records retained, record 60 unreachable, `hasMore=false`.

- [ ] Add a failing regression proving that records 49–60 are reachable, not just that the array has at most 48 entries.
- [ ] Implement a bounded, navigable collection window. Retire entries away from the active area; do not immediately discard the page just fetched.
- [ ] Preserve the selected/open record, server cursor semantics, ID/version deduplication, and tombstones for hidden records.
- [ ] Support continued forward exploration and an intentional way back to previously visited portions. A circular orbit around the first 48 objects is not sufficient.
- [ ] Exercise at least 60 and 180 distinct fixtures. Verify the real orbit and fallback can reach the final record without a reload and without unbounded GPU textures.
- [ ] Check arrival/hide during paging and ensure stale pages cannot resurrect removed objects.

Do not solve this by increasing the cap to an arbitrary large number or loading every full-resolution image.

## 4. P1 — recover tasks after a restart before lease expiry

File: `server/artifacts/worker.ts`, especially `recover()` around lines 147–177 and its once-at-startup invocation.

Audited reproduction: a process restarts while a GENERATING job still has a future `lease_until`. Startup skips it. Advancing beyond lease expiry and waking the worker again leaves it GENERATING forever. REVIEWING uses the same expired-only startup pattern.

- [ ] Add a regression with a future lease at restart, then advance a fake clock past expiry.
- [ ] Ensure every orphaned GENERATING/REVIEWING task reaches an appropriate recoverable or terminal state. Account for this single-process Fly deployment; choose a safe startup ownership rule or periodic recovery, and document the choice.
- [ ] A finalized valid file must be adopted and inspected.
- [ ] A dispatched image with no recovered file must become GENERATION_UNKNOWN; never automatically resend an ambiguously charged request.
- [ ] EXTRACTING after process loss must still become SOURCE_UNAVAILABLE. Never recover it from raw text or invent a fallback.
- [ ] Verify both quick restart and restart after lease expiry, with generation enabled and paused.
- [ ] Keep late results guarded by ownership/state/lease so they cannot publish after an operator action.

Do not weaken the possible-charge acknowledgement on manual retries.

## 5. P1 — apply operator hides during slow generation

Files: `server/artifacts/worker.ts` (`drain`, `wake`, `applyAdmin`), `server/artifacts/store.ts`, and the media router/events.

Audited reproduction: hold one image provider request unresolved, enqueue a hide for an already published DIFFERENT record, and wake the worker. After 1.2 seconds the hide is still pending and the record is PUBLISHED. It only hides when the unrelated image request finishes. An image call may last up to 120 seconds.

- [ ] Write a controlled-provider regression that keeps generation unresolved while applying the hide.
- [ ] Make administration execute promptly independently of long provider awaits, while keeping one image-generation runner and transactional idempotency.
- [ ] Within about one second, commit HIDDEN, increment version/revision once, and gate subsequent detail/image reads with 404.
- [ ] Broadcast the hide after commit to every open Gallery; unlink files afterwards.
- [ ] Keep the generation request held during this verification: resolving it before checking the hide would miss the bug.
- [ ] A late provider result must not undo a hide.
- [ ] Verify this also works when generation is paused.

Reporting by itself still only queues a private review. Do not auto-hide based on report counts.

## 6. P2 — remove hidden media immediately during drag

Files: `src/scene/gallery-orbit.ts` (`setItems` around lines 726–729), `GalleryOrbit.tsx`, and Gallery state integration.

Code-review finding: `setItems()` postpones the entire update while dragging. This also postpones removals, leaving a hidden sleeve/label visible until release.

- [ ] Separate immediate removal/revocation from deferred insertion/reordering.
- [ ] Remove a hidden sleeve and any central label reference before pointer-up. Never defer a safety removal until idle.
- [ ] Preserve the focused ID/gesture for surviving items. Defer new arrivals until an appropriate idle boundary; do not move the collection under the pointer.
- [ ] If the focused/open record is hidden, close its detail and select the nearest valid survivor. Handle a now-empty collection honestly.
- [ ] Test while the pointer is still held down, on wheel settling, and with a context-loss fallback.
- [ ] Prevent any queued older collection from restoring the hidden object after the gesture ends.

## 7. P2 — bind report replies to the correct record and operation

Files: `src/lib/useGallery.ts` around lines 120–150 and `src/components/RecordView.tsx`.

Audited failing UI regression: report A, leave the reply pending, switch to B, then resolve A's request successfully. B incorrectly shows “Report received” and loses its report action. The hook currently shares one global report state/reference.

- [ ] Reproduce that exact ordering with a deferred response.
- [ ] Bind the state, frozen reason, operation key, and result to the artifact being reported.
- [ ] A late success/refusal/transport failure for A must not overwrite B's form, status, or pending operation.
- [ ] Preserve an unsettled report's original reason/key across close and reopen of that artifact. Switching to/reporting B must not erase A's unsettled operation.
- [ ] Retrying A after a lost response must reuse A's key; do not generate a second report.
- [ ] Test success, 4xx refusal, lost response, hide while sending, and switching/closing/reopening.
- [ ] Keep the server's report idempotency and rate limits.

## 8. P2 — repair short landscape layouts and preserve usable controls

Files: `src/styles/gallery.css`, `src/scene/gallery-orbit.ts` layout measurement, and `RecordView.tsx`.

Browser reproduction at 844×390:

- The orbit collapses into tiny thumbnail-sized objects.
- In detail, the record covers the Back to the Gallery button.
- The close cross overlaps the title.
- The width-only phone breakpoint leaves a short landscape viewport using an unsuitable desktop layout.

- [ ] Add a height-aware compact layout, or deliberately use an accessible collection when there is not enough stage height. Do not reduce the entire exhibition to a miniature.
- [ ] Give the header, back/close controls, full square artwork, title and report/player area reserved, non-overlapping space.
- [ ] Allow detail/report content to scroll naturally on short screens. Keep orbit gestures out of those scrolling forms.
- [ ] Keep interactive controls at least 44×44 CSS pixels where applicable, readable text, and no horizontal overflow.
- [ ] The complete artwork must remain inspectable; do not permanently obscure it with the decorative record.
- [ ] Verify 844×390 and 932×430 as well as 390×480/844 and the desktop sizes above.
- [ ] Confirm keyboard navigation, Escape, focus return, reduced motion, and no-WebGL/context-loss fallback.

Preserve the intentional desktop overlap/composition from G02 where there is room. Use a sensible responsive layout rather than many unrelated absolute-position offsets.

## 9. Visual refinement and honest feature status

After the functional fixes:

- Keep G01's spacious diagonal orbit and relative depth. Avoid bunching the sleeves into two rigid piles or clipping distant sleeves into the heading.
- Keep G03's compact four-neighbour composition when there are enough distinct real records. Do not manufacture extra objects for sparse data.
- Keep the same artifact image on its sleeve, record label and full artwork. Do not substitute the offline fixture art as production output.
- Reuse the existing vinyl/paper/frame assets. The new background is the only new visual asset required by this task.
- Keep the room free of Gallery downloads. Retain bounded decoded textures, dispose retired resources, and avoid full-screen postprocessing for static mist.

**Music implementation remains separate from this completed repair pass.** The owner selected [AI-directed parameters performed with Web Audio](music-design.md) on 2026-10-19; that complete design supersedes the old external-provider/audio-file proposal. The disabled Listen button is not a working player. Until implementation, preserve truthful image-only copy and add no fake waveform, duration or playback animation. Future music work reuses the current brief, saves one deterministic score and adds one browser player plus gated score reads; it adds no music service, audio job or paid generation call. Follow music-design.md and technical-notes sections 6–7, rather than the superseded provider plan.

Real note-to-image semantics, image-model access, and the real image-policy service have not been verified by fixture tests. Do not claim these are validated or silently make paid calls. Identify the remaining real-service smoke test separately.

## 10. Verification and delivery

At the audit baseline, build, TypeScript, and all existing 230 tests passed, despite these defects. The UI tests use jsdom and mainly exercise the fallback; they do not validate the WebGL orbit.

- [ ] Add meaningful regressions for the six cases above; confirm they fail on the faulty behavior, then pass after the repair.
- [ ] Run the full current `pnpm check` against an isolated local database. Never point `APP_URL` at Fly production.
- [ ] Build the client and check route lazy-loading/network requests.
- [ ] Test the actual browser at all specified sizes, including the background comparison and open/close/turn/report flows. Do not infer visual fidelity from a successful build.
- [ ] Use synthetic fixtures only for offline tests. Label fixture screenshots accurately.
- [ ] Save browser evidence in an appropriate existing evidence folder; link it from the factual implementation log.
- [ ] Update ADR/runbook details where recovery/admin semantics changed. Update asset usage documentation if your actual layer implementation differs.
- [ ] Keep changes scoped. Do not modify the paper-room materials, moderation policy, raw-note retention, or unrelated features.
- [ ] Do not merge to main, deploy, change secrets, or call paid generation services as part of this repair task.

Return: what changed; the regression and browser results; screenshots compared with G01/G02/G03; remaining real-service/music/hardware checks; and an accurate statement of commit/push/deployment status. Do not call the full image-and-music exhibition complete while music or provider verification is still absent.

