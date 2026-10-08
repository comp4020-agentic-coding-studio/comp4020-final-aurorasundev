# Generated assets

Images generated for Throwaway with the course image endpoint
(`POST https://strproxy.comp.anu.edu.au/api/images/generations`), then
downloaded and cut down for the runtime.

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
