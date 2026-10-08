# Third-party notices

## paper-crumple-demo

- Source: <https://github.com/item-develop/paper-crumple-demo>
- Commit reused: `f84648b001dd13becda7a629ab5398cecfe3a252`
- Author: nagasawa (ITEM Inc.)
- Licence: MIT (full text below, and in `src/scene/vendor/LICENSE`)

Throwaway's crumpled papers are this demo's vertex-animation-texture (VAT)
paper, physics and motion. What was taken, and how it changed:

| In this repo | From the demo | Changes |
|---|---|---|
| `public/vat/geo/vertex_animation_textures1_mesh.fbx`, `public/vat/tex/vertex_animation_textures1_pos.exr` | `vat/` | none (byte-for-byte copies) |
| `src/scene/vendor/paper-vat.js` | `src/paper-vat.js` | URL debug flags and console logging removed; the decoded data is cached once per page |
| `src/scene/vendor/paper.js` | `src/paper.js` | the fictional brand designs, canvas print textures and font loading removed; papers share one plain material, so no words are drawn into WebGL |
| `src/scene/vendor/paper-scene.js` | `src/main-vat.js` | module-level setup moved into `createPaperScene()` with a `dispose()`; papers keyed by database ids rather than 40 fictional designs; clicks ask the app to open a paper; the red wall, lil-gui panel, URL debug flags and `#info` element removed; colours, camera framing and stage bounds retuned; a fill light added; shared procedural paper-grain colour and bump textures with a matte material; a soft shadow-catching floor; pixel ratio, SSAO and shadow size reduced on phones; keyboard "Open paper" buttons follow each paper; the open sheet's screen rectangle is reported so the HTML reading layer can sit on it |

Not used: the demo's `index.html`, its SVG thumbnails in `data/`, and
`preview-4-3.mp4`. three.js 0.160.1 and cannon-es 0.20.0 (the versions the
demo pins) are installed from npm rather than its CDN import map.

```
MIT License

Copyright (c) 2026 nagasawa (ITEM Inc.)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fire (`src/scene/fire/`)

The furnace and the burning of a paper are Throwaway's own modules, written
for three.js 0.160.1. Three open-source projects informed them; one GLSL
function is copied.

| Project | Commit studied | Licence | What Throwaway took |
|---|---|---|---|
| [Housz/ThreeVolumetricFire](https://github.com/Housz/ThreeVolumetricFire) | `ed1ee936cd451384a744bb6cd5c85454764b5ecc` | MIT, © 2025 Housz | the technique in `flames.js`: view-aligned slices through a box, density looked up per fragment and displaced upwards by animated turbulence. No code copied: the slices here are a fixed quad stack oriented in the vertex shader (no per-frame geometry), the density is a set of teardrop tongues computed in the shader instead of `firetex.png`, and blending is premultiplied "over" instead of additive. |
| [OtanoStudio/Burn-Dissolve](https://github.com/OtanoStudio/Burn-Dissolve) | `84fe66cf16c3c9cfbd3d6a3cd438563515694e18` | Apache-2.0 | the structure of `burn-material.js`: a standard material patched with `onBeforeCompile`, a height-driven burn boundary perturbed by simplex noise, discard past it, an emissive edge. Changed: measured in object space along an axis fixed at ignition, a leaning front, scorch / stain / charcoal / ash-rim bands, consumption lagging the char, vertex shrivel and collapse, a matching depth material. |
| [blvdesign/BurningPaperShader](https://github.com/blvdesign/BurningPaperShader) | `0a8d15ace4bb6fb1127313d25edb6b2c47bf7be5` | MIT, © 2026 Nikita Belov | the layering of a paper burn (dry stain and scorch ahead of the front, a thin segmented glowing edge, charred lip, ash fringe) used as the reference for the bands in `burn-material.js`. It is a Swift/Metal package; no code copied. |
| [ashima/webgl-noise](https://github.com/ashima/webgl-noise) | — | MIT | `snoise()` (3D simplex noise by Ian McEwan and Stefan Gustavson) in `noise.glsl.js`, copied with its helper functions renamed. Licence below. |

The generated textures in `public/textures/fire/` are listed with their
prompts in `docs/generated-assets.md`.

```
Copyright (C) 2011 by Ashima Arts (Simplex noise)
Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
