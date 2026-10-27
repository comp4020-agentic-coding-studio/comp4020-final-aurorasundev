# Gallery music — AI-directed parameters, performed with Web Audio

Date: 2026-10-19. Status: **implemented 2026-10-27 behind `GALLERY_MUSIC_ENABLED` (off in production); not acoustically verified in a real browser** (see ADR 006). The text below is the design as selected; where it says "future" or "proposed", read "implemented, flag off". Baseline: `9501f73`; refreshed against `cb0d337` during this pass. The later image-palette, brief-sampling and inspection-code changes keep the same V2 music fields and are preserved. This amendment supersedes the earlier external music-provider, MP3-storage and HTMLAudioElement proposals in this design package.

## 1. Intent, authority and scope

The owner selected **OpenAI chooses musical parameters; the browser synthesizes and performs the piece**. The cover and sound must express the same burned Release note. They are independent, anonymous derivatives, with no original text, drawing, quotation, voice, diagnosis or link back to a paper.

The existing ignition request already produces `CreativeBriefV2.music` (`timbre`, `pulse`, `density`, `ending`), alongside visual metaphor, relation, motion and space. Reuse that validated result. A constrained deterministic composer translates those AI-selected directions into a short score; a program-generated seed supplies variation within them. Do not claim the model generated a recording or individually composed every note.

Decisions made here:

- A piece lasts **24,000 ms including its ending and effect tail**, plays once, and has no lyrics or speech.
- Compose and store its score once when an inspected image is published. Playback never calls OpenAI.
- Use native Web Audio, without a new runtime dependency, music-service credential, audio generation endpoint, sample download or stored MP3.
- Preserve the burn transaction, current 4.8–15-second extraction-following fire, image requests, inspections, quotas, reports and existing source deletion.
- Keep G02's focused record/player composition. Music does not choose between the existing orbit and the separate, unapproved belt-layout draft.
- Existing records remain image-only in the first release; no automatic historical backfill or reconstruction.

Success means a fresh eligible note becomes an inspected image and a repeatable, content-directed instrumental; any visitor can choose to hear it, with one local player and truthful failure states. Image viewing must work when music is disabled, unavailable or unsupported.

## 2. Alternatives considered

| Approach | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Reuse the current AI brief, compose a bounded score locally, synthesize in the browser | No extra AI round trip; preserves current source handling and extraction deadline; deterministic playback | Limited musical vocabulary and synthesized timbres; listening and tuning still needed | **Selected** |
| Expand the ignition schema so the model writes a larger score | More direct model control over melody | Changes the working extraction schema/token budget and increases timeout/malformed-output exposure | Defer; not required for v1 |
| Call a separate music/audio service | Potentially richer recorded sound | Another credential, generation cost, latency, audio storage and content-review system | Superseded |

The chosen method is an AI-directed generative instrumental, not a sampled piano performance or a full music-model recording. Describe soft key tones as **felt-like keys**, rather than promising a real felt piano.

## 3. Complete sequence

```mermaid
sequenceDiagram
    participant V as Person releasing a paper
    participant S as Existing server
    participant A as Existing OpenAI adapters
    participant D as SQLite / private images
    participant G as Gallery visitor
    participant W as Browser Web Audio
    V->>S: Confirm existing furnace drop, with existing operation key
    S->>D: Capture eligible source in memory, clear original, commit receipt
    S-->>V: Existing burn reply and room SSE immediately
    S->>A: One existing bounded CreativeBriefV2 extraction
    A-->>S: Validated visual and musical parameters
    S->>D: Persist derivative brief only; settle existing fire hold
    S->>A: Existing image generation and inspection
    A-->>S: Accepted image
    S->>S: Compose score from brief + one new random seed
    S->>D: Atomically publish image metadata and optional validated score
    S-->>G: Existing artifact:published, with small music descriptor
    G->>W: Explicit Play click creates/resumes one AudioContext
    G->>S: GET currently published record's /score
    S-->>G: Validated stored score, no original or full brief
    G->>W: Render one short buffer with OfflineAudioContext, then play
    G->>W: Pause / Resume / Play again use the same buffer
```

### At ignition

Reuse the current one-attempt, 15-second-bounded source extraction and `paper:extraction_settled`. No music-specific AI request, new Write checkbox, pre-ignition wait, source retry payload or extension to the flame deadline. `ARTIFACTS_ENABLED` continues to control new derivative processing. A failed extraction leaves no record or music.

### At image publication

Inside the existing guarded publication transaction, when music is enabled:

1. Validate the job's stored `CreativeBriefV2` using the existing parser.
2. Make one CSPRNG seed (four random bytes, stored as eight lowercase hexadecimal characters). The seed is not derived from a paper, owner or return key.
3. Run the pure composer, validate its output, and save the immutable score with the new public artifact. Only then commit and broadcast the existing `artifact:published` event.
4. An invalid/unsupported music result leaves `music_score` null and a safe internal diagnostic; it must not block an otherwise accepted image or generate a replacement soundtrack. No raw brief or exception body is logged.

The score exists only for an independently published artifact, never for Keep, cancelled, quarantined, forbidden, duplicate or failed-extraction paths. Repeated publication/recovery must reuse the committed score and seed. Images rejected by inspection create no publicly playable piece.

There is no asynchronous music queue, `pending` music status, extra daily AI allowance or `artifact:updated` event in v1. Image and optional score become visible atomically. Existing image unknown-outcome/retry rules remain unchanged.

## 4. Stored score and composition contract

The following is a **future** contract, not a type already present in source:

```ts
type MusicScoreV1 = {
  schema_version: 1;
  composer_version: 'throwaway-score-v1';
  renderer_version: 'throwaway-synth-v1';
  seed: string; // exactly eight lowercase hexadecimal characters
  duration_ms: 24000;
  tempo_bpm: 48 | 60 | 72;
  timbre: 'felt_piano' | 'soft_glass' | 'warm_pad';
  ending: 'open' | 'settled' | 'fading';
  reverb_mix: 0.06 | 0.12 | 0.18;
  notes: Array<{
    at_ms: number;
    duration_ms: number; // includes the voice's release
    midi: number;
    velocity: number;
  }>;
};
```

Limits: JSON at most **16 KiB UTF-8**, 1–96 events, integer times, MIDI 48–84, velocity 0.12–0.70, event duration 120–2,400 ms. Each event ends by 22,000 ms, leaving the last two seconds for the tail/fade. At most six overlapping voice envelopes. Events are sorted by `(at_ms, midi, duration_ms)`; reject duplicate events, unknown keys/versions, NaN/infinite numbers, negative times and unsupported values. No text, code, URL, sample, arbitrary waveform or DSP graph can be supplied in a score.

The browser validates the score again before rendering. Its renderer accepts only the three server-owned timbres and the known renderer version. Do not execute model output, load a URL from it, or persist free-form model instructions.

### How the note influences the music

The model chooses the existing brief; the program performs the following bounded translation. The seed changes root selection, permitted rests, motif inversions and small velocity variation **after** the semantic choices. Randomness never replaces the brief.

| Brief field | v1 translation |
| --- | --- |
| `music.timbre` | Selects one fixed synthesis preset: soft keys, quiet glass tones or a warm pad |
| `music.pulse` | `none`: phrase spacing of 2/4 beats, without a beat track; `slow`: 1/2-beat spacing with gentle recurring accents. Neither adds drums |
| `music.density` | `sparse`: one melodic line; `layered`: add quiet lower anchors, subject to the six-voice cap |
| `music.ending` | `open`: stop away from the root; `settled`: final root near 20 s; `fading`: reduce velocity in the final third without forcing resolution |
| `relation` | `connected`/`opening`: major pentatonic; `separated`/`under_pressure`: minor pentatonic; `receding`: suspended pentatonic. Separated phrases retain rests; pressure keeps the register narrow |
| `motion` | `still`: 48 BPM, repeat the motif; `unfolding`: 72 BPM, gently extend its register; `drifting`: 60 BPM, alternate phrases and rests; `settling`: 60 BPM, thin the final third |
| `metaphor` | Chooses the motif below, so sound shares the cover's symbolic direction |
| `space` | `enclosed`: 0.06 reverb mix; `open`: 0.12; `distant`: 0.18 |

Motifs use scale-degree indices, not quoted melodies: thread `[0,2,4,2]`; vessel `[0,4,2,0]`; threshold `[0,2,4,6]`; path `[0,2,4,2,0]`; seed `[0,2,4,6,4]`; stone `[0,0,2,0]`. Scale semitones are major `[0,2,4,7,9]`, minor `[0,3,5,7,10]`, suspended `[0,2,5,7,10]`; continue degrees into the next octave. Choose a root from MIDI `[48,50,53,55]` with the seed. Keep `under_pressure` motifs within degrees 0–4.

Use a documented, frozen Mulberry32 PRNG for composition. Round musical times to integer milliseconds, keep rests on half-beat boundaries, and discard candidates that would exceed time/polyphony limits. Layered anchors use the same scale at lower velocity; never clip or accelerate notes just to fill all 96 slots. Add the ending within the remaining event budget. Save the resulting note events, not merely a seed that a later composer might reinterpret.

These are initial compositional constraints requiring listening tests. Different notes may share a mood/motif. Do not claim that every output is unique or that music accurately diagnoses an emotion.

### Version and repeatability rules

- Save the score and seed once. Replay, another visitor, reconnect and browser resize do not recompose or request AI.
- Keep the v1 renderer available for v1 scores. A future timbre/algorithm change uses a new version, without silently changing existing pieces.
- Expect the same notes, timing, structure and seeded effects across devices, with small browser/audio-device differences. Do not promise bit-identical PCM or the same perceived loudness on every speaker.
- Migration adds a nullable `music_score` column to `artifacts` using the next migration after current version 9. Never rewrite shipped migrations or regenerate images.
- Old null scores remain unavailable. A later, separately scoped backfill may use an existing valid stored V2 brief with no source reread or AI request; v1 does not add that command, job or event.

## 5. Public contract, live behavior and publication controls

Add an optional music field to the existing allowlisted `PublicArtifact`:

```ts
type PublicMusic =
  | { status: 'unavailable' }
  | { status: 'ready'; score_version: 1; duration_ms: 24000 };
// music?: PublicMusic; absent is a legacy image-only record
```

Do not include full scores in collection pages or SSE. No audio URL, original paper/job ID, complete brief, private failure reason or model prompt becomes public. Publishing the descriptor does not change the Gallery total twice, reorder an existing object, change orbit focus or start sound in another session.

Future `GET /api/gallery/:id/score`:

- Read-only, `Cache-Control: no-store`; same UUID validation and current PUBLISHED-state gate as the image route.
- Return `{ artifact_id, artifact_version, score }` only when the feature is enabled and the stored score is valid/supported. Return the existing generic gone response (404) for hidden/missing/unavailable output. Do not start a job from GET.
- Validate current publication before sending. A hidden object's future score/image requests both fail. A previously downloaded score cannot be recalled; do not claim otherwise.

Proposed **new, not implemented** flag: `GALLERY_MUSIC_ENABLED=0` by default. When set to `1`, fresh accepted images may acquire scores and published supported scores may be served. Add `music_enabled` to `/api/gallery/config`; missing means false for older servers. Refresh that config on every Gallery snapshot/reconnect, without resetting record focus or reports. This is independent of `generation_enabled`: pausing AI processing need not silence already published pieces. Turning music off preserves stored scores/images, serves no scores and marks descriptors unavailable. A server restart/reconnect stops local playback, and the new snapshot/config controls later attempts. Changing configuration is a later release action, not part of this documentation pass.

Reuse the current `artifact:hidden` event and native report flow. The report targets the whole record; an operator hide stops its sound and removes the artwork. Do not auto-hide by report count or add an unimplemented audio moderation service. Since output is restricted local synthesis with no voice/files, score validation plus renderer testing is the relevant technical gate; human listening is still required for launch quality, not claimed as an automated harm judgement.

## 6. Browser synthesis and playback

### One engine for the Gallery page

Use one live `AudioContext`, one master gain and at most one playing `AudioBufferSourceNode`. On first explicit Play, create/resume the live context **inside the click handler before awaiting an import, fetch or render**. Check Web Audio support first. Fetch/revalidate the selected record's score on every Play/Resume; this is a normal read, never an AI request. Refuse playback while the Gallery is reconnecting.

Lazy-load the synthesis module only after Play. Render a mono **44,100 Hz, 24-second** buffer with `OfflineAudioContext`; this is about 4.0 MiB of raw PCM. Keep at most one completed record buffer and one offline render in flight. A repeated request for the same score shares its render. A different request invalidates the old action token; finish and discard an obsolete render before starting the latest pending one. Do not assume `startRendering()` can be cancelled portably.

Cache key: `(artifact_id, artifact_version, renderer_version)`. Keep it in memory only; no IndexedDB, localStorage, Service Worker audio cache, base64 MP3 or permanent WAV. Remove a hidden record's buffer immediately. Server persistence is the score, not browser PCM.

### Sound graph and timbres

Offline: bounded oscillator voices → preset filter/envelope → restrained seeded reverb → rendered buffer. Use the score seed for the effect's noise impulse; never `Math.random()` during a render. Apply the final fade from 22–24 s and attenuate output whose absolute peak exceeds 0.70; never boost quiet output merely to normalize it. Reject non-finite/silent output as a render failure.

Initial preset character:

| Preset | Implementation direction | Limit |
| --- | --- | --- |
| `felt_piano` | Sine/triangle partials, soft 10 ms attack, short decaying body and low-pass around 1.8 kHz | Felt-like synthetic keys; no piano sample or recording claim |
| `soft_glass` | Quiet sine partials, 20 ms attack, longer release, low-pass around 3.5 kHz | No harsh high-frequency strikes or sudden loud transients |
| `warm_pad` | Two gentle detuned oscillators, 250 ms attack/release smoothing, low-pass around 1.6 kHz | No more than six musical voices; bound all oscillators/effect nodes |

Live: buffer source → track gain → master gain → destination. Default master volume **0.35**; 0–1 volume slider with a 30 ms ramp. All stop/pause changes fade over **200 ms** using audio-clock automation. Stop scheduled sources and disconnect their graph when done; close the live context on Gallery unmount. These are engineering limits, not a hearing-safety guarantee for every playback device.

### States and controls

| State | Visible controls/copy | Transition |
| --- | --- | --- |
| No valid score / music disabled | Disabled Listen; “There is no sound for this record yet.” | Image/report remain fully usable |
| Unsupported browser | Disabled Listen; “Sound is not supported in this browser.” | No repeated error dialog or WebGL dependency |
| Fetching / rendering | “Preparing sound…”; cancel/close still works | No fake timer, waveform motion or spinning record |
| Ready / initial | Play | Starts only after successful current-action checks |
| Playing | Pause, elapsed/total, volume | Only the selected record sounds |
| Paused | Resume, elapsed/total, volume | Resume from the saved offset, same buffer |
| Ended | Play again; show 0:24 | Replay from zero after explicit click; no loop/auto-next |
| Network / render / resume failure | “Sound could not start. Try again.”; or “Reconnect to listen.” | Retry is explicit and makes no AI request |

An `AudioBufferSourceNode` is single-use. Pause fades/stops it, stores the offset at the end of that fade, and Resume creates a new source into the same buffer. Derive elapsed time from the audio clock plus offset, never accumulated setInterval ticks. Seeking, download, autoplay, playlists, background listening and cross-device synchronized playback are out of scope for v1.

Serialize transitions through that one source: wait for the old 200 ms fade/stop before a requested replacement or Resume can sound, then check the latest action token again. Pause in the last 200 ms clamps the offset to the duration and becomes Ended. Do not overlap two sources to implement a crossfade. Once a source has stopped, release an obsolete buffer before rendering another record.

Stop and reset sound on selecting another record, closing the detail, entering its report form, hiding the record, reconnecting, tab visibility becoming hidden, leaving Gallery or losing the current object/version. Returning to the tab/reconnecting never resumes automatically. If the browser suspends/interruption stops the context, show a paused state and require another user action.

Every async completion checks an action token, selected artifact ID/version, mounted state, current publication descriptor, feature flag and connection state before starting sound. A reply/render for record A cannot start after B opens; a late `onended` from A cannot change B's player state. A hide cancels pending playback and drops its cache. Scope this controller to the page, not to each artwork or WebGL mesh.

## 7. Visual and accessible behavior

Use [G02](reference-images/G02-record-listening-desktop.png) for the existing focused artwork, record and restrained player; G01/G03 still guide browsing unless a later visual amendment is approved. Do not generate new fixed artwork to depict playback.

- Show a small code-native Play/Pause button, elapsed/total text and a labelled volume slider. Use 44 px touch targets and visible keyboard focus.
- A waveform may be 48 min/max bins derived from the **actual rendered PCM**. Before a buffer exists show a quiet empty placeholder; never invent a waveform or activity.
- The chosen disc turns slowly only while actually playing, initially around six RPM, with subtle deceleration on pause. Keep sound's clock independent from Three.js/GSAP and the orbit phase. Reuse the same playback angle when HTML takes over from the scene.
- Reduced motion disables disc rotation and decorative movement; playback, controls and text progress remain usable. No WebGL/grid fallback still has the same audio player.
- State changes use a restrained live region; do not announce every elapsed-time tick. Progress is read-only in v1, not a misleading seek slider.
- Keep current “Images shaped by released notes.” copy until music is implemented and available. A future ready record may say “AI-directed generative instrumental”; never label a missing piece as playing or an unreviewed implementation as verified.

### Future disclosure copy, to change only when music ships

Keep the existing Release control and I understand checkbox. The future Release supporting text is:

> Its fate is no longer yours to control. After it burns, an anonymous image and short instrumental may appear in the public Gallery. Your original words and drawing are deleted as it burns.

The automatic trigger is unchanged; “may appear” acknowledges generation/inspection failure, flags and quotas, not a new author opt-in. About should explain that OpenAI chooses abstract image and musical directions once at ignition, only those directions are kept, and sound is synthesized in the visitor's browser on request. Do not describe a second reading of the original, a third-party music service or guaranteed publication. Update consent-copy tests alongside this future copy; this document pass leaves the implemented form unchanged.

## 8. Implementation boundaries for Claude

This section identifies future changes; it does not authorize implementation in this documentation task.

| Files | Responsibility |
| --- | --- |
| New `shared/music-score.ts` | Versioned score types, strict validation and pure `composeMusicScore(brief, seed)`; browser-safe imports only |
| `server/artifacts/types.ts`, `store.ts`, `worker.ts` | Optional public music descriptor; pass the music flag into guarded publication, compose/store once from the valid brief |
| `server/db.ts` | Next append-only migration, nullable `artifacts.music_score`; preserve all existing rows |
| `server/artifacts/router.ts`, `server/index.ts` | Config flag and read-only gated `/score` route; no music provider or media-file directory |
| New `src/lib/gallery-audio.ts` | Offline synthesis, one live graph, buffer reuse, playback clock, cancellation and disposal |
| New `src/lib/useGalleryAudio.ts` | Page-level React lifecycle/selection bridge; create/resume the context synchronously from the Play handler |
| `src/lib/gallery-api.ts`, `src/lib/useGallery.ts`, `src/GalleryApp.tsx`, `src/components/RecordView.tsx` | Read score/config, refresh config on reconnect, own one controller, render real state and preserve reports/record selection |
| `src/components/WriteDialog.tsx`, `README.md` | Future Release/About disclosure of the image and browser instrumental; no new author control |
| `src/scene/gallery-orbit.ts`, `src/styles/gallery.css` | Small selected-disc playback bridge and HTML fallback; do not replace browse geometry or room code |
| New music-focused specs; current Gallery/worker/consent specs | Verify contracts, publication, lifecycle races, privacy and existing flows |

Keep `CreativeBriefV2` and its current schema/model/output budget unchanged. The score composer consumes a small music-specific view of the validated brief; do not import the server provider, keys or filesystem into client code. Follow Node's direct type stripping/erasable syntax and existing project style. No Tone.js, external samples, AudioWorklet, Redis, second machine or music job is needed for this bounded piece.

Suggested implementation order: score validation/composition → migration/atomic publication/gated read → offline renderer → one-player lifecycle → G02 controls/disc bridge → regression and real-browser listening evidence. Complete each boundary before wiring the next; do not rerun the completed image-Gallery build plan or change the furnace.

## 9. Acceptance evidence

1. **Meaning and determinism:** same brief/seed/version yields the same stored event list; different selected timbre/pulse/density/ending and visual relations change the relevant musical behavior. Different real synthetic notes need an eventual real extraction/listening evaluation; fixture keyword mappings do not prove model understanding.
2. **No extra AI:** count provider calls around fresh burns, duplicate burns, publication, Play, Resume, Replay and reconnect. Music adds zero model/image/moderation/audio-service requests; no original or full brief appears in score responses.
3. **Publication:** fresh Release has at most one saved seed/score; rejected image/Keep/quarantine/duplicate paths expose none. Invalid music does not block an accepted image. Migration preserves legacy image-only records. Unknown score versions fail closed for sound.
4. **Gating and races:** hide during score fetch, offline render and playback; switch A→B while A renders; close/reopen; reconnect with a hidden object; late HTTP/onended. No stale result sounds or changes the other record's controls. Existing reporting/pagination/hide tests continue to pass.
5. **Audio:** render all three presets and every ending in a real browser; verify 24-second duration, finite samples, non-silent output and absolute peak ≤0.70. Listen for clicks, clipping, harsh glass tones and clean fades. PCM sample equality across different browsers is not required.
6. **Controls:** explicit start, pause/resume offset, replay from zero, volume ramps, natural ending, browser interruption, tab hidden and route unmount. At most one audible source, one retained PCM buffer and one render in flight; rapid switching never creates overlapping tracks.
7. **Visual/accessibility:** G02 at 1920×1080, 1366×768, 390×844, 390×480 and 844×390; keyboard/44 px targets; report scrolling; reduced motion and no WebGL with working audio. Elapsed/waveform/disc reflect actual player state.
8. **Performance:** no music module/context/PCM on home entry, Gallery browsing or detail opening before Play. Record first-click fetch/render latency and CPU/memory on desktop and a real phone. Loading must not freeze close/navigation; do not promise a render time before measurement.
9. **Release:** temporary fixture database for local tests; synthetic content for any separately authorized real-provider evaluation. Document version/flag/backup/rollback. This design does not change secrets, perform migration, enable flags, commit, push or deploy.

## 10. Sources and evidence limits

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses): use the existing strict structured brief, handle refusals/incomplete output and retain local validation. This design adds no new OpenAI request.
- [Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices): user-gesture context startup and careful graph/resource handling.
- [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext) and [AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode): short offline rendering, reusable buffers and single-use playback sources.
- [AudioContext currentTime](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/currentTime): the playback/scheduling clock.

Only documentation and existing code were inspected for this amendment. No new music implementation, rendered audio, paid request, credential change, browser-audio test or deployment is claimed.
