# Generated assets

Every image asset that reproduces a reference look comes from the course
image-generation endpoint (`POST https://strproxy.comp.anu.edu.au/api/images/generations`).
Each entry records the model, the exact prompt, and how the download was
post-processed before it was committed. No user text ever goes into a texture.

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
