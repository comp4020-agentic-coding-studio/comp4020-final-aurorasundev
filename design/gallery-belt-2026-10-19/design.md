# Gallery: entry mist and the record belt (2026-10-19)

Status: **draft for the owner's approval.** Supersedes the browse layout of
`design/gallery-records-2026-10-18/` (G01's orbit and its title block). The
opened record (G02) and the report view (G03) keep their content and copy;
only how they are reached changes. Reference for structure and motion craft:
goodgrowth.com (Codrops case study, 2026-08-27). Nothing is copied from its
assets, type or palette.

Unchanged rules (CLAUDE.md, ADR 005): an unordered exhibition, with no feed,
dates, counts, ranking, likes or comments, and no link back to a paper. Text
lives only in HTML. No sound. No room code. A reduced-motion or no-WebGL
viewer gets the existing grid.

## 1. Two states, one progress value

The Gallery is one page with a virtual progress `p` from 0 (entry) to 1
(exhibition). It is not native page scroll: the document never scrolls, so
mobile address-bar resizing and overscroll cannot disturb the scene, and the
wheel stays free to turn the belt once `p = 1`.

- **Advance:** wheel, swipe up, Space, PageDown or ArrowDown, or the "Enter"
  hint. Each gesture drives one GSAP timeline toward `p = 1`. It is not
  scrubbed per pixel.
- **Return:** wheel or swipe down at the belt's rest, or Escape with no
  record open, plays it back to `p = 0`.
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
- **Title reveal:** SplitText characters slide up out of a mask, with
  stagger 0.02, 0.6 s and power3.out, then a short ScrambleText settle on
  the last word. Screen readers get the whole title (aria-label). Reduced
  motion shows the title still.
- **Mist (replaces the mist photograph):** a full-screen fragment shader
  drawn behind the HTML title.
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

1. The title's characters lift and fade with a 0.015 stagger, and the
   centre title scales into the corner wordmark position. The mist thins to
   about 0.25 alpha but stays as the exhibition's atmosphere.
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
4. **Front half of the belt:** passes in front of the vinyl's lower edge; the
   front card is the largest.

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
- **Wheel down at rest** returns to the entry only after a deliberate second
  gesture: the first is absorbed while the belt settles, and the belt's own
  turning comes first.

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
2. The globe dims to about 0.3 and stops counter-rotating.
3. The focused sleeve comes forward to the HTML art frame.
4. The vinyl slides out of the sleeve to the disc frame and spins up.
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
