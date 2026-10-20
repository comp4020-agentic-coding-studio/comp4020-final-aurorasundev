# Gallery: entry mist and the record belt (2026-10-19)

Status: **draft for the owner's approval.** Supersedes the browse layout of
`design/gallery-records-2026-10-18/` (G01's orbit and its title block). The
opened record (G02) and the report view (G03) keep their content and copy;
only how they are reached changes. Reference for structure and motion craft:
goodgrowth.com (Codrops case study, 2026-08-27). Nothing is copied from its
assets, type or palette.

Unchanged rules (CLAUDE.md, ADR 005): an unordered exhibition, with no feed,
dates, counts, ranking, likes or comments, and no link back to a paper. Text
lives only in HTML. This visual draft adds no sound and no room code.
The separately selected [Web Audio music design](../gallery-records-2026-10-18/music-design.md)
is independent of belt/entry motion: future sound starts only from explicit
Play in a record, never from the entry, wheel or transition. Music remains
unimplemented; this note does not approve the draft layout. A reduced-motion
or no-WebGL viewer gets the existing grid with equivalent future player controls.

## 1. Two states, one progress value

The Gallery is one page with a virtual progress `p` from 0 (entry) to 1
(exhibition). It is not native page scroll: the document never scrolls, so
mobile address-bar resizing and overscroll cannot disturb the scene, and the
wheel stays free to turn the belt once `p = 1`.

- **Advance:** wheel, swipe up, Space, PageDown or ArrowDown, or the "Enter"
  hint. Each gesture drives one GSAP timeline toward `p = 1`. It is not
  scrubbed per pixel.
- **Return:** the corner wordmark, or Escape with no record open, plays it
  back to `p = 0`. Wheel and swipe never return from the exhibition (§7c).
- **Replay:** the entry plays on every visit and can be skipped at once by
  any advance gesture. Closing a record never replays it.
- **Load gating:** the entry is visible while textures decode,
  `renderer.compile()` runs and three warm-up frames render. The advance is
  accepted at once; if assets are not ready, the transition holds its first
  beat (at most 1.4 s) instead of showing a half-built scene.

## 2. Entry (p = 0)

- **Centre:** "The Throwaway Gallery" (display serif, HTML), with
  "Images shaped by released notes." beneath it in small text, and a quiet
  "Scroll" hint at the bottom. The header keeps the Throwaway wordmark,
  "Back to the space" and "About".
- **Title reveal:** superseded 2026-10-20 (§7): no letter effects; the
  mist above the title does the revealing.
- **Mist (replaces the mist photograph):** a full-screen fragment shader
  (2026-10-20: drawn as a transparent veil *above* the HTML title; see §7).
  - Domain-warped fbm (4 octaves) drifting slowly, rendered as soft tufts in
    translucent off-white and grey-blue over a pale ground, at about 0.35–0.6
    alpha so the ground breathes through.
  - Interaction: a 128² ping-pong flow texture. The pointer splats force
    weighted by its velocity, not its position, and each frame keeps 0.94 of
    the previous field. The flow offsets the mist's sample coordinates, so a
    passing hand parts and curls the mist, which closes again over about 2 s.
    Touch drags do the same.
  - Rendered at most 1× DPR (mist is soft), on demand only while the entry is
    visible. Reduced motion: one still frame, no flow.

## 3. Transition (p: 0 → 1, about 1.6 s)

1. The title fades as it scales into the corner wordmark position. The
   mist clears fully (2026-10-20, §7), so the stage plate shows.
2. The globe's meridians draw in from the poles (line dash offset).
3. The vinyl rises from the centre, tilts to its rest angle and starts its
   idle spin.
4. The cards gather from particles one by one along the belt, with a 0.09
   stagger from the front card outward, so the belt arrives with a tail.
5. The record's title, caption and the arrows fade in last.

Played backwards on return.

## 4. Exhibition (p = 1)

**Camera:** orthographic, as in the reference, so the belt does not bulge or
steepen. Scene units are tied to the viewport height.

**Layers, back to front:**

1. **Globe:** 7 meridian rings on a flattened sphere (x scale 1.7, y 0.905),
   drawn as fine graphite lines with a slight hand-drawn weight variation
   (option A: paper-lantern ribs or wound thread). No fill, no texture. It
   counter-rotates against the belt: `globe.rotY = -beltAngle * GLOBE_SPIN`,
   with GLOBE_SPIN snapped so one card step moves exactly one meridian step,
   and every rest pose is the same composition.
2. **Back half of the belt:** behind the globe, dimmed and faded toward the
   back. Cards there are not interactive.
3. **Vinyl:** in front of the globe, at the centre, tilted back. It idle-spins
   on a time-based clock (frame-rate independent). Belt motion adds spin
   that decays back to idle. The label shows the front card's image. The
   view-dependent groove sheen and matte black come from step 4.
4. **Front half of the belt:** passes in front of the vinyl (2026-10-20:
   across its middle, the front card over its centre); the front card is the
   largest.

**Belt geometry:**

- Cards sit on the flattened sphere's equator band.
- The band is curved by a latitude shift, not a tilt:
  `lat(θ) = 0.2 · (0.3·sin θ + 0.7·sin³ θ)` rad, at most about 11°. The band
  reads as a gentle S from upper left to lower right, nearly horizontal at
  the front.
- Cards are square sleeves with thickness and a paper edge (step 4), facing
  outward along the band.

**Input:**

- **Wheel or drag** turns the belt. One damping layer on the angle.
- **Snapping:** the belt snaps to the nearest card after the wheel has been
  quiet for 220 ms, or on release with a velocity throw of at most ±3 cards.
- **Phone:** a swipe ignores its drag distance on release and commits one
  step from where it began.
- **Keys:** ArrowLeft and ArrowRight step the belt.
- **Hover** on desktop lifts a front-half card slightly.
- **Click:** clicking the front card or the vinyl opens the record; clicking
  another front-half card turns it to the front.
- **Wheel in either direction** turns the belt; it never returns to the
  entry (§7c).

**Particles (dissolve zones):** the stretches where the band rounds the
globe's left and right silhouettes are dissolve zones.

- A card entering a zone breaks into particles that drift back along the
  band's tangent and fade. A card leaving the far zone gathers from particles
  into its sleeve.
- One shared particle mesh: each card in a zone is drawn as a grid of about
  64×64 points sampling its image, positioned in the vertex shader by a
  per-card `uDissolve` 0→1 plus per-particle noise offsets. Everywhere else a
  card is an ordinary mesh.
- **Fast turns:** above a belt speed threshold, zones use a cheap alpha
  dissolve instead, so a hard fling never fills the screen with debris.
- **Operator hides:** a hidden card dissolves in place immediately,
  wherever it is.
- Cards leaving on open, and returning on close, use the same particle path.
- The mobile budget is at most 3 cards in particle form at once.

**Phone (≤ 600 px):**

- The vinyl moves up to about 40 % of the height, and the globe and belt are
  scaled so the band spans the full width with the front card about 40 % of
  the width.
- The belt's back half is hidden: the front arc only, with dissolve zones at
  the screen edges.
- "Open record" stays a button under the title.

## 5. Opening a record

The step-2 timeline, retargeted to the belt:

1. The other front-half cards dissolve, staggered outward from the focus.
2. The globe dims and stops counter-rotating; the mineral surface fades in
   behind the sleeve (2026-10-20).
3. The focused sleeve comes forward to the HTML art frame.
4. The vinyl tucks into the sleeve, turns one full revolution there in
   plain sight (2026-10-20), then slides slowly out to the disc frame and
   spins up gently.
5. The title is revealed character by character, then the caption, report
   link and arrows.
6. On timeline complete, the HTML record takes over.

Close plays it back: the cards gather from particles into the belt again.
Arrows inside an open record step the belt behind it and swap the record
without leaving.

## 6. Fallbacks and limits

- Reduced motion or no WebGL: the existing grid, with no entry animation,
  mist motion or particles. A plain centred title above the grid.
- A lost WebGL context drops to the grid, as now.
- DPR caps: scene 1.5 on desktop and 1.25 on phone; mist 1.
- Rendering runs continuously only while something moves (vinyl idle spin
  counts) and the tab is visible.
- The texture budget stays at 14 images. Cards beyond the budget show the
  blank paper stock until near the front.

## 7. Decisions (owner, 2026-10-19)

- **Visible ring: 10 cards on desktop, 6 on phone.** The 48-record sliding
  window stays underneath and feeds replacements through the dissolve
  zones, so the collection feels endless rather than counted.
- **Display face:** an exhibition display serif replaces the system serif
  for the entry title, the corner wordmark and record titles. It is
  self-hosted woff2 (OFL), Latin subset, `font-display: swap`. Body text
  stays on the system stack. **Chosen: Gloock** (OFL, single weight 400;
  specimen in `font-specimen.html`).
- **Globe:** option A, fine graphite lines.
- **Trackpad flick:** a hard flick may cross several cards. The wheel path
  rounds the whole travelled distance, inertia tail included, with no cap
  (pinned by `spec/gallery-motion.test.ts`). Desktop drag throws keep their
  ±3 cap, and a phone swipe stays one step.

## 7a. Owner revision after a real-screen review (2026-10-20)

These replace the earlier text where they differ.

- **Entry title:** no SplitText slide-up and no ScrambleText settle. The
  title is one real heading with its own text from the first paint.
- **Entry mist:** dense, and drawn as a transparent premultiplied veil
  *above* the title (the canvas takes no pointer; the header sits above it),
  so the title sits half-hidden in the cloud and surfaces as it drifts. Its
  density breathes on a 7 s cosine that starts thin, so the title reads
  within a couple of seconds without a pointer. The pointer parts a broad
  lane (splat variance 0.012 of the height², the mist thins up to 92 %)
  that closes over about 2.5 s (flow kept at 0.975 per 60 Hz frame).
  Reduced motion: a lighter still veil (level 0.32) behind the plain title.
- **Exhibition background:** the stage plate `gallery-stage-mist-v2.jpg`
  shows clear behind the globe, record and belt. The mist clears to 0 on
  the way in and is hidden at the exhibition. (It had been an opaque canvas
  over the plate at every stage.)
- **Belt height:** BAND_DROP 0: the band's centre line runs through the
  record's middle; the S-curve latitude is unchanged.
- **Cards:** 1.5× (CARD 1.65 globe units; phone 0.44 of the width, clamped
  from 1.5× = 0.48, which made the six-card arc's neighbours touch on a
  390 px screen). The cards are **in front of** the record: the front card
  covers its centre and the record shows round it.
- **Record tumble:** at rest the record turns slowly in space as well as on
  its spindle, in the spirit of goodgrowth.com's CD: x 0.36·sin(0.42 t),
  y 0.42·sin(0.31 t + 1.3), z 0.1·sin(0.35 t + 0.6) over the rest tilt, the
  groove spin and the scroll boost. It oscillates and never rolls over, so
  the label reads most of the time. Blended out over the open's tuck, back
  in on close; none under reduced motion.
- **Opening is slow and calm** (desktop, about 4.85 s to the hand-over):
  neighbours dissolve (1.0 s each, 0.1 s apart); the sleeve comes forward
  (1.15 s from 0.25 s) as the record tucks in (1.3 s); the record, half out
  of the sleeve, turns one full revolution there (1.3 s from 1.35 s); it
  slides out over 1.5 s (sine.inOut), spins up gently to upright (1.3 s
  from 3.55 s); the text reveal starts at 3.45 s. Close about 3.1 s (64 %),
  a step inside an open record 1.3 s, the phone's open 1.8 s with the disc
  staying tucked.
- **Opened record ground:** `mineral-surface.jpg`, behind the sleeve and
  record and above the stage plate, faded in by the open timeline and out
  by the close (never a hard cut); the phone's scrolling dialog and the
  no-WebGL dialog use the same surface. No wash over the arriving WebGL
  record (acdc603).

## 7b. Owner revision two (2026-10-20, second real-screen review)

- **The entry title becomes the wordmark.** On the way in, "The Throwaway
  Gallery" flies to the corner and replaces "Throwaway": its first line is
  measured against the corner's own text (same Gloock face, font sizes as
  the scale, top left as the origin) and lands exactly on it while the old
  "Throwaway" fades out underneath; the corner's text then comes up over the
  identical landed title, which hides, so one element remains and nothing
  blinks. A title wrapped onto two lines (a phone) cannot land as one line,
  so it crossfades with the corner over the flight's last 0.3 s. The corner
  reads "The Throwaway Gallery" through the exhibition and any opened record
  (the dialog's header copy too); 19 px on a phone so it fits beside "Space"
  and "About". The return plays it backwards. The room page keeps
  "Throwaway".
- **The Gallery wordmark returns to the Gallery's entry, not the room.**
  Clicking it (or Enter, or Space) closes an open record first, then plays
  the return: the title flies from the corner back to the centre over the
  mist, and the entry can be entered again as usual. It is a real link to
  `/gallery/` handled in place (so without JavaScript it still lands on the
  Gallery's entry), named "The Throwaway Gallery". "Back to the space" is the
  way to `/`.
- **The record ends in front of the sleeve, without a pop.** It tucks
  behind the sleeve and turns there as before; then it slides out *behind*
  the sleeve until its rim has cleared the sleeve's edge (55 % of the slide,
  with a 4 % gap); only there, overlapping nothing, does it step in front
  (draw order and depth together), and it comes back over the sleeve's edge
  to rest exactly on the HTML disc frame (position, size, in front). If the
  clear point would leave the screen the record may be up to 15 % smaller at
  the turn, growing back as it comes forward. Slide 2.2 s (was 1.5 s;
  hand-over about 5.4 s); the close plays the same path back (slide 1.3 s,
  close about 3.1 s). The compact layout's record rests behind the sleeve
  and simply stays there; the phone keeps the record tucked.
- **Cards pass through a veil at the record's rim.** Interpretation of "when
  cards scroll in front of the vinyl, they dissolve into particles and
  gather again; when a card leaves the vinyl, it again dissolves and
  gathers": as the belt turns, a front-half card whose centre crosses the
  record's silhouette edge (entering the record's area, and again leaving
  it) breaks briefly into grain in place and re-forms over the crossing.
  The pulse is measured in the record's on-screen horizontal radii from its
  centre (u; the rim is u = 1): it rises to 0.62 at the rim and falls to 0 at
  u = 1 ± 0.32, so the card stays legible and never disappears. Resting
  neighbours sit at u ≈ 1.61 (desktop) and 1.43 (phone) at every size, the
  front card at 0, so no card rests mid-pulse. It is a zone candidate in the
  shared particle path: the 4 / 3 budget (nearest the front first), the
  fast-turn alpha fallback with its hysteresis, and none under reduced
  motion, while any part of an open shows, or before the entrance has
  finished. The side dissolve zones are unchanged.

## 7c. Owner revision three (2026-10-20)

- **No scrolling back to the entry.** In the exhibition the wheel (and a
  swipe) turns the belt both ways; the "absorb the first wheel-up, return on
  the second" rule is gone. The way back is the corner wordmark, or Escape
  with no record open. A wheel-up while the transition is still advancing
  still turns it back.
- **Slower dissolves.** The zones and the rim give a dissolve by position, so
  a card crossed a zone in ~0.15 s and the grain was gone before anyone saw
  it. The shown dissolve now follows that target in time
  (`particles-plan.ts` `easeDissolve`): it breaks up quickly to what the
  target reached (`BREAK_SECONDS` 0.12), holds a moment (`HOLD_SECONDS`
  0.25), then gathers back slowly (`GATHER_BACK_SECONDS` 0.6), so a rim
  crossing during one step reads for about 1.5 s. Reduced motion and an open
  follow at once. `RIM_BAND` is 0.4 (so the phone's resting neighbours, at
  u ≈ 1.43, stay outside it).

## 7d. Owner follow-up (2026-10-20)

- **Rim particles only on approach.** In either scroll direction, compare a
  card's distance from the record's centre with its previous frame. Only an
  approaching front-half card may start the rim pulse. Leaving the record
  never starts a second pulse; a pulse already in flight finishes gathering
  at the existing calm pace. This replaces the two-crossing rule in §7b.
- **No bright wash at handover.** Keep a WebGL record dialog's backdrop
  transparent while its static artwork fades in. The mineral ground is
  already present, so adding a light wash at that instant brightens the
  live canvas before the HTML disc has covered it. The plain fallback
  retains its own background and backdrop.
