# Fixed Gallery assets — prompts and provenance

Date: 2026-10-18. Selected direction: A. Generation method: built-in Image Gen; the exact underlying model ID is not exposed. These five final assets contain no note text or fixed replacement artwork. A paper-frame cleanup pass was generated before choosing the final frame.

Runtime files are in `../../public/textures/gallery/`. PNG exports preserve alpha/data; opaque paper/background exports use JPEG quality 84. Square exports were resized to 1024×1024 with macOS sips; background remains 1536×1024. No source reference screenshot was cropped into a runtime asset.

## 1. vinyl-face.png

Input style reference: [selected G02](reference-images/G02-record-listening-desktop.png). Transparent background enabled. Generated source: `exec-3559715d-f72c-4374-8bf0-8f7de3868efe.png`.

```text
Use case: precise-object-edit / production game-and-web material cutout. Transform the supplied Throwaway Gallery concept screenshot into ONE isolated production asset by re-rendering only its CHARCOAL VINYL DISC FACE. Do not crop a region of the screenshot; reconstruct a clean orthographic asset. The screenshot is a material/style reference only. Output a 1024x1024 square front-facing perfectly circular vinyl record ring, centered at 512,512. Outer disc diameter approximately 940 pixels, perfectly round, NO perspective or ellipse, no tilt. Match the reference's dense fine concentric vinyl grooves, deep graphite-charcoal #252524, matte-to-satin finish, subtle fine radial machining and a very thin realistic worn outer edge. Delicate neutral grey broad surface sheen, no bright white glare, no dramatic directionally baked studio reflections, no iridescence or rainbow. CRITICAL compositing layout: the central circular paper-label area must be a COMPLETELY TRANSPARENT EMPTY OPENING about 470 pixels in diameter. The dynamic note-generated artwork will be composited behind that opening by the application. All area outside the outer circle must also be truly transparent. The output therefore has a charcoal vinyl annulus between approximately radius235 and radius470, and transparent centre and exterior. No paper label, centre photo, spindle pin, text, logo, number, track list, icons, background, floor, cast shadow or other objects. The hole is intentionally larger than a physical spindle hole, to reserve the whole dynamic label window. Preserve a clean antialiased alpha edge on both boundaries. This is a reusable fixed material asset for the selected mineral-grey Gallery, not a website mockup.
```

## 2. vinyl-grooves-height.png

New technical texture, opaque background. Generated source: `exec-ee4f667d-eb35-431a-ac64-3f1ff418c49a.png`.

```text
Use case: stylized-concept / grayscale technical texture. Create ONE square 1024x1024 production BUMP HEIGHT TEXTURE for a charcoal vinyl record's fine concentric grooves. This is a material data map, NOT a rendered disc, not a photograph and not a normal map. Fill the full square with a perfectly radially symmetric, front orthographic circular groove field centered EXACTLY at the canvas centre. Dense delicate hairline concentric recording grooves, hundreds of closely spaced very fine circular ridges, crisp high-resolution microstructure. All circles must be truly concentric and circular, no perspective, ellipse, waviness or spirals. Use ONLY neutral grayscale around midgrey: base about RGB128,128,128, hairline ridge values around 150 and troughs around 105; low-amplitude relief. Even contrast in every direction. The inner 20 percent radius can be smooth neutral grey for an unused label area, fade the grooves gently into that area, not an abrupt rim. Extend the concentric groove field naturally to the square boundary with no visible disc silhouette. No baked lighting, no bright specular wedges, no directional gradients, no metallic sheen, no ambient occlusion, no shadows, no background scene, no alpha, no text, numbers or logos, no borders. The image will be sampled as non-colour bump data on actual geometry with live lighting; do not simulate that lighting in this map.
```

## 3. paper-stock.jpg

New paper surface, opaque background. Generated source: `exec-99cc7722-7efe-430f-8b36-398665e96593.png`.

```text
Use case: photorealistic-natural / flat material texture. Generate ONE 1024x1024 square production texture of real uncoated archival paper stock, matching the off-white matte paper sleeves and record labels in a refined mineral-grey/charcoal exhibition. Full-bleed flatbed macro scan, evenly diffuse shadow-free lighting. Warm ivory approximately #f3f0e8, natural compact cotton fibres, very fine short embedded fibres, delicate soft paper tooth, exceptionally restrained near-white flecks and microscopic surface irregularities. Premium 250gsm soft matte stock. This texture serves BOTH the empty sleeve back/edge and the substrate of a dynamic circular record label. It must have calm even tone and consistent fine scale across the entire square. No large folds or wrinkles, no border, no sheet outline, no corners, no torn edges, no visible horizon, no stains, no dark dust, no foxing, no burn marks, no yellow aged paper, no overlaid artwork, writing, text, icons, logos or watermarks. Do not render a photo of paper lying on a table: render only the paper surface edge to edge. No vignette, directional lighting or shadows. The displayed artwork will be generated separately from the visitor's burned note; do not invent a fixed artwork in this material.
```

## 4. sleeve-frame.png

Input style reference: [selected G02](reference-images/G02-record-listening-desktop.png). Transparent background enabled. Initial source: `exec-b138450f-c81c-4a77-8e3c-790438a88324.png`; final cleanup source: `exec-a9c7feea-4301-45c9-9f64-79f377d800d4.png`. Only the latter is shipped.

```text
Use case: precise-object-edit / transparent production overlay. Re-render the paper album sleeve edge from this Throwaway Gallery reference as ONE reusable empty square PAPER SLEEVE FRAME, not a screenshot crop. Use the reference only for its ivory archival paper material. Output square 1024x1024, perfectly front orthographic with four straight sides, no perspective or rotation. The outer paper square occupies about 96% of the image, leaving a small TRANSPARENT outer margin. Four narrow off-white paper edge bands, each about 4% of the canvas width, with authentic fine paper fibres, gently softened corners, tiny natural edge irregularities and only a few delicate shallow handling creases at the corners. Paper tone approximately #f3f0e8 with subtle neutral grey grain, premium matte printed-record sleeve. CRITICAL: a very large square CENTRAL WINDOW occupying about 86% of the canvas width must be ENTIRELY TRANSPARENT, so the application can insert ANY separately generated square artwork behind it. Not white, not grey, not checkerboard: true zero-alpha empty space. The exterior outside the frame is ALSO true transparent alpha. Only the thin paper frame should be visible. All four bands must be continuous and of approximately equal width. No backing sheet filling the central window, no inner printed square, no empty solid white card, no photograph or artwork, no circular hole, no thumb notch, text, logos, black border, floor, surface, drop shadow, dramatic lighting or other objects. A subtly real paper edge, not a thick picture frame or plastic border. This image is a material overlay asset with clean antialiasing. Keep the full note-generated image visible inside the window when composited; do not create any predefined content.
```

Cleanup edit prompt (input was the initial generated frame):

```text
Use case: precise-object-edit. Clean up this existing transparent paper sleeve frame for final web production. Preserve its square front-on geometry, narrow four paper bands, very large transparent square centre window, overall dimensions, genuine ivory paper fibre material and restrained corner creases. CHANGE ONLY the alpha-edge quality and surface cleanliness: remove all isolated stray white flecks outside the frame, remove all yellow, red, magenta or coloured fringes around the inside/outside edges, remove dirty brown dots and stains. Paper colour should remain neutral warm ivory #f3f0e8, clean archival stock rather than aged paper. Both inner and outer boundaries should be smooth, tidy and softly antialiased with a very slight natural paper texture, no jagged cutout noise. Keep the entire centre window truly transparent zero alpha, keep the exterior truly transparent zero alpha, do not fill either with black, white, grey or a checkerboard. Use a 1–2 pixel neutral ivory edge transition into alpha, no coloured matte. No shadow, no background, no image, no text, no added illustration. This is a blank compositing frame so dynamic note artwork remains separate.
```

## 5. mineral-surface.jpg

New mineral surface, opaque background. Generated source: `exec-566f70df-f31d-4587-a7f4-43b9909b6d50.png`.

```text
Use case: photorealistic-natural / production background texture. Create ONE full-bleed rectangular landscape 1536x1024 material image for the selected light mineral-grey Throwaway record Gallery. A straight-on / flatbed scan of very fine matte mineral plaster mixed with subtle smooth paper tooth. Colour is a pale desaturated sage/mineral grey approximately RGB198,205,204 / #c6cdcc. Extremely fine soft neutral surface grain, delicate naturally varied microtexture, calm high-end gallery-wall finish. Uniform even luminance throughout the whole image with only tiny low-contrast variation, gentle cool-grey/green undertone. This will be a subtle reusable CSS/WebGL material behind dynamically positioned records, not a completed scene. Fill the entire image edge to edge. No wall-floor horizon, corners, gradients, light beams, spotlights, vignette, dark edges, cast shadows, depth of field, obvious large blotches, cracks, exposed concrete holes, dirt, scratches, coloured speckles, patterns, borders, logos, text, paper sheets, records, artwork, objects or furniture. No blue or purple theme. Avoid overly busy concrete, sand or harsh grain. Real tactile mineral surface at a fine scale, edited and quiet enough to sit behind readable charcoal text. Background colour and stage shading will remain controlled separately by code, so do not bake directional lighting into the texture.
```

## Verification boundary

The saved runtime images are decoded and inspected directly, with alpha checks for the centre/corners of the two cutouts. A local-file browser preview was not available because the browser rejects file URLs; no browser-rendered fidelity claim is made. The asset pass does not change the running Gallery. Final page fidelity remains a later implementation check.

