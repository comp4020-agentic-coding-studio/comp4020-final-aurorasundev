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
| `src/scene/vendor/paper-scene.js` | `src/main-vat.js` | module-level setup moved into `createPaperScene()` with a `dispose()`; papers keyed by database ids rather than 40 fictional designs; clicks ask the app to open a paper; the red wall, lil-gui panel, URL debug flags and `#info` element removed; colours, camera framing and stage bounds retuned; a fill light added; a soft shadow-catching floor; pixel ratio, SSAO and shadow size reduced on phones; keyboard "Open paper" buttons follow each paper; the open sheet's screen rectangle is reported so the HTML reading layer can sit on it |

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
