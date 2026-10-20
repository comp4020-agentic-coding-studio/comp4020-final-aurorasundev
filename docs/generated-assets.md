# Generated assets

Earlier image assets came from the course image-generation endpoint
(`POST https://strproxy.comp.anu.edu.au/api/images/generations`).
Each entry records its generation method and processing. The later material
pass used Codex's built-in generator, documented separately below.
No user text ever goes into a texture.

## Track V

Post-processing ran in a headless Chromium canvas (Playwright). There was no
ImageMagick, and no npm dependency was added. 6 generations were downloaded;
2 sources were kept.

### `public/textures/paper-fibre.jpg` — 256×256 grey JPEG, 25,751 B

- **Model:** `flux-1.1-pro`, 1024x1024
- **Prompt:** "Seamless tileable texture, sharp macro scan of uncoated ivory cotton paper, faint short pale beige fibres embedded in the sheet and a soft felted grain, like fine archival drawing paper seen close up, low contrast, matte, uniformly lit flatbed scan, no wrinkles, no folds, no stains, no dark speckles, no vignette"
- **Post-processing:**
  1. Crop x128 y128, 512 px square, and resize to 256 px.
  2. Convert to luminance and high-pass it: subtract a box blur of radius 12, which removes the scan's lighting gradient.
  3. Make it seamless by cross-fading with a half-offset copy. The weight is `sin·sin`, divided by `sqrt(w²+(1−w)²)` so the grain contrast stays even.
  4. Normalise to unit variance, then map to `128 ± 28·v` grey.
  5. Encode as JPEG q 0.78.
- **Used by:**
  - the CSS sheets: the `soft-light` fibre layer over the ivory fill, 256 px repeat;
  - the 3D paper `bumpMap`: repeat 2×2, bumpScale 0.6.

  One file serves both uses.

### `public/textures/sheet-outline.png` — 512×604 alpha PNG, 16,708 B

- **Model:** `flux-1.1-pro`, 1024x1792
- **Prompt:** "Top-down flat-lay photograph of one single portrait sheet of ivory uncoated matte paper that was crumpled and then smoothed flat again, isolated on a solid pure black background. Slightly irregular torn deckle edges on all four sides. Soft faint crease lines and gentle wrinkles concentrated near the edges and corners, the large centre area is calm with only very faint creases. Even soft diffuse lighting from above, no text, no writing, no objects, no cast shadow, small black margin all around the sheet"
- **Post-processing:**
  1. Find the sheet's bounding box with a luminance threshold of 60, and crop to it plus a 4 px margin.
  2. Resize to 512 px wide.
  3. Set the RGB to white. Alpha is `clamp((L − 36) / 48)`.
- **Used as:** the 9-slice `mask-border` / `-webkit-mask-box-image`, with a slice of 56. It gives every HTML sheet its torn outline at any size.

### `public/textures/sheet-folds.jpg` — 512×604 grey JPEG, 19,546 B

- **Source:** the same generation as `sheet-outline.png`.
- **Post-processing:**
  1. Use the same crop and size as the outline.
  2. Shading is computed only inside the paper: local luminance minus a broad mean (box blur of radius width/6), times 2.2. Flat areas stay at 128 grey.
  3. Feather the folds to neutral between 54 px and 114 px from the edge. That way the 9-slice centre (slice 120) is perfectly flat and nothing gets stretched.
  4. Encode as JPEG q 0.8.
- **Used as:** an unfilled `border-image` with `mix-blend-mode: soft-light`. It adds restrained edge creases.

### Rejected generations

None of these were committed.

- **`fibre-1`, `fibre-2`** (`flux-1.1-pro`): too smooth, with no visible fibre.
- **`fibre-4`** (`ideogram-v3-quality`): rendered literal hairs.
- **`sheet-1`** (`flux-1.1-pro`): dense, uniform wrinkles. They would stretch across the reading area.

### Removed

- **`public/textures/paper-sheet.png`** (586,224 B): the earlier single stretched sheet background. It is replaced by the three files above.

Net change: +62,005 B, −586,224 B.

## Track F

The fire's textures in `public/textures/fire/`. Model `flux-1.1-pro`,
generated 8 October 2026. Ten images were generated; five were kept. They
load only when a burn or the furnace is first needed (see
`src/scene/fire/assets.js`), never on the space's first load.

Post-processing ran in a headless Chromium canvas (no ImageMagick):
seamless textures are a crop blended with its half-offset copies so the
seams vanish; keyed textures turn the white background into alpha and
un-mix the white from the fringe; the flake atlas finds separate flakes by
connected components and packs the 16 largest into a 4×4 grid.

| File | Size | Source image | Processing |
|---|---|---|---|
| `iron.jpg` | 512×512, 45.8 KB | iron3 (1024×1024) | centre 80 % crop, seamless, JPEG q0.82 |
| `charred.jpg` | 512×512, 29.2 KB | char1 (1024×1024) | centre 80 % crop, seamless, JPEG q0.80 |
| `ash-bed.webp` | 512×512, 112.8 KB | ash2 (1024×1024) | white keyed to alpha, round edge fade, WebP q0.82 |
| `flakes.webp` | 512×512, 59.8 KB | flakes2 (1024×1024) | 4×4 atlas of separated flakes with alpha, WebP q0.85 |
| `smoke.jpg` | 128×384, 3.0 KB | smoke1 (1024×1792) | central crop, greyscale (used as an alpha mask), JPEG q0.80 |

Total 250.5 KB.

Prompts of the kept images:

- **iron3**: "Seamless tileable texture filling the entire frame edge to edge, flat orthographic close-up photograph of old blackened cast iron surface, very dark umber brown and charcoal black, fine even sandy casting grain, faint rust-brown bloom in places, soot, low contrast, uniform overall tone with only subtle variation, no large blotches, no border, no frame, no rivets, no highlights, diffuse even lighting"
- **char1**: "Seamless tileable texture, flat orthographic macro photograph of thoroughly charred burnt paper surface, matte black and charcoal grey, fine cracked carbonised paper fibres, subtle grey ash dusting, crinkled texture, even soft diffuse lighting, no flames, no glow, no objects, no vignette, no text"
- **ash2**: "Top-down macro photograph of the remains of burnt paper: a shallow low pile of soft grey paper ash powder with many thin flat black and charcoal grey curled paper flakes lying on top, some flakes with pale grey ash edges, dry matte, fills the whole frame edge to edge, even soft diffuse light, no embers, no flames, no objects, no text"
- **flakes2**: "Top-down photograph of about twenty separate paper-thin fragments of burnt paper on a pure white background, each fragment flat and thin like a leaf of ash, irregular ragged outlines, black charred centres fading to dark grey and pale grey ashy edges, a few slightly curled, well separated from each other with clear white gaps, soft even light, no shadows, no text"
- **smoke1** (1024×1792): "A single thin delicate wisp of pale grey smoke rising vertically from the bottom centre, gently curling and dissipating toward the top, isolated on a pure black background, high detail, soft, translucent, no fire, no objects, no text"

Rejected: iron1 and iron2 (grey, camouflage-like blotches, nothing like
B01's dark iron), ash1 (fine powder without the flakes B03 shows), flakes1
(too few, touching flakes), ashbed3 (read as charcoal lumps, not paper ash).

## Material fidelity pass — 2026-10-09

### `public/textures/sheet-creases-v2.jpg` — 768×768 JPEG, 182,707 B

- **Generator:** Codex built-in ImageGen, invoked for the user's approved
  B01, space and write reference material pass. The tool does not expose an
  exact underlying model identifier.
- **Prompt brief:** square orthographic photograph of real matte paper that
  has been crumpled and flattened, fine fibres, an almost-white quiet central
  55% for legible writing, sharper irregular wrinkles along the outer 20%,
  natural rough edges, grayscale shading, no UI, text, props or coloured marks.
- **Processing:** converted to JPEG at quality 82 and resized to 768×768 with
  macOS sips. No new dependency or image manipulation library was added.
- **Use:** nine-sliced edge folds on write/read sheets, broad normal relief
  alongside the existing fibre texture in the Three.js paper material, and
  the drawn no-WebGL paper. The existing iron texture is retained and given
  rough normal relief on a rebuilt cylinder; no rendered reference mockup
  is pasted into the live furnace. Paper content stays in HTML.

## Gallery fixed material pack — 2026-10-18

The owner selected the mineral-grey record exhibition (G01–G03) and requested
all fixed visual image materials in `public`. Five generated assets are now
available in `public/textures/gallery/`; individual content-derived Gallery
artworks remain runtime output and are not part of this fixed pack.

| File | Dimensions | Role |
| --- | --- | --- |
| `vinyl-face.png` | 1024×1024 RGBA PNG | Charcoal record front; transparent exterior and label window |
| `vinyl-grooves-height.png` | 1024×1024 PNG | Non-colour concentric groove bump data |
| `paper-stock.jpg` | 1024×1024 JPEG | Shared sleeve/label paper substrate |
| `sleeve-frame.png` | 1024×1024 RGBA PNG | Blank paper edge overlay with transparent artwork window |
| `mineral-surface.jpg` | 1536×1024 JPEG | Restrained mineral-grey Gallery background material |

- **Generator:** Codex built-in Image Gen. The exact underlying model ID is
  not exposed. The record/frame use the selected G02 concept as a style
  reference; the other three are standalone material generations.
- **Prompts:** [complete material prompts and selected sources](../design/gallery-records-2026-10-18/asset-prompts.md).
  One cleanup edit preceded the final sleeve-frame selection.
- **Packaging:** macOS sips resized square exports to 1024 pixels. PNG
  preserves alpha for cutouts and lossless encoding for height data; opaque
  paper/background use JPEG quality 84. Background remains 1536×1024.
  No new dependency or visual reconstruction script was added.
- **Verification:** decoded the final images, checked dimensions and centre/
  corner alpha, and recorded bytes/hashes in the public manifest. The runtime
  pack totals 4,125,514 bytes. No page-rendering fidelity or provider-backed
  generation claim follows from these material checks.
- **Usage:** [state-by-state composition guidance](../design/gallery-records-2026-10-18/design.md#13-fixed-visual-assets-and-where-to-use-them).
  This pass does not modify the application's current material wiring.

## Gallery G01 mist background — 2026-10-19

The owner requested the same visual background as the supplied “唱片馆.png”, especially its white cloud-like ground haze. That image is byte-identical to the selected G01 in the design folder.

- **Runtime file:** `public/textures/gallery/gallery-stage-mist-v2.jpg`; public URL `/textures/gallery/gallery-stage-mist-v2.jpg`.
- **Generator:** Codex built-in Image Gen, using G01 as the edit target. No API key or paid project-provider call was used. The exact underlying model ID is not exposed.
- **Source:** `exec-0f8ac5df-60b6-4b66-a864-41d379585667.png`, generated 1584×993.
- **Packaging:** JPEG quality 88 using macOS sips, no resize; embedded sRGB IEC61966-2.1; 237,246 bytes.
- **SHA-256:** `f064130419ef58f0df9af7870672e466da264cf4d722e6cf34bb803754897512`.
- **Image:** quiet grey-green upper atmosphere, soft white lower ground mist and restrained fine grain. No text, UI, discs, sleeves, artwork or baked object shadows. Occluded parts are reconstructed; pixel-identical recovery of unseen areas is not claimed.
- **Usage:** replaces the flat mineral-surface composition as the active Gallery backdrop. Keep independent real artwork, live object shadows and HTML above it. Preserve the old surface file for compatibility without loading both background layers.
- **Prompt and usage:** [exact generation prompt](../design/gallery-records-2026-10-18/asset-prompts.md#6-gallery-stage-mist-v2jpg--2026-10-19), [latest design amendment](../design/gallery-records-2026-10-18/design.md#14-owner-amendment--restore-g01s-white-ground-mist-2026-10-19), and [Claude repair handoff](../design/gallery-records-2026-10-18/claude-revision-prompt-2026-10-19.md).
- **Verification boundary:** decoded and visually inspected the delivered JPEG; checked dimensions/profile/hash and relative asset links. This delivery edits assets and documentation only; the new backdrop is not yet wired into or browser-verified in the application.

## Homepage window-lit room plate — 2026-10-19

The owner requested the window-cast daylight and tactile wall/floor materials from the supplied “首页背景图.png”, fitted to the existing homepage without replacing the paper scene.

- **Runtime asset:** `public/textures/room/home-window-light-v1.jpg`; URL `/textures/room/home-window-light-v1.jpg`. Metadata: [room manifest](../public/textures/room/manifest.json).
- **Generator:** Codex built-in Image Gen; no project API key or project-provider call. The underlying model ID is not exposed. The input foreground was removed and the occluded room reconstructed.
- **Selected source:** `exec-c82b1628-951c-4df0-9411-58a6c95d2d92.png`. Three composition refinements followed the initial generation; only the selected final plate is packaged.
- **Packaging:** 1672×941 opaque JPEG, quality 88, no resize, embedded sRGB IEC61966-2.1, 328,412 bytes.
- **SHA-256:** `eeb8b7dbfc992834c358572753834d6124417c829cdf5e454a8a1e909e8b27ff`.
- **Composition evidence:** the existing camera projects the wall/floor join to about 43.48% height on desktop and 25.03% in portrait. The delivered plate's soft horizontal transition is approximately row 408/941 (43.36%), measured over the quiet central/right region. These are frame-dependent measurements, not new camera settings.
- **Content:** mineral-grey matte plaster above, pale limestone/microcement below, coherent soft off-camera left-window illumination and mullion shadows. No paper, furnace, fire, ash, text, UI, cloud mist or baked object shadows.
- **Integration boundary:** apply only to the existing wall/floor background materials, using aligned projection or surface-specific sampling. Preserve floor geometry and physical plane, wall position, camera behavior, real shadow receivers, existing contact-shadow enhancement, paper materials and lighting. Do not paste the plate over the canvas or independently repeat the whole image on both surfaces.
- **Delivery boundary:** this pass supplies image/metadata/provenance only. It does not modify or browser-verify the new room appearance. The owner requested the Claude implementation prompt in chat, so no prompt file was created.
