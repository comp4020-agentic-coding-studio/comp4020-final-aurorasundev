// The fire's textures, generated with the course image endpoint and cut
// down to small JPEG/WebP files (docs/generated-assets.md). They load the
// first time a burn or the furnace is needed, once per page, and are shared.
import * as THREE from "three";

const FILES = {
  iron: "iron.jpg",
  charred: "charred.jpg",
  ashBed: "ash-bed.webp",
  flakes: "flakes.webp",
  smoke: "smoke.jpg",
};

let cached = null;

/**
 * @param {string} [base] where the files are served, "/textures/fire/" by default
 * @returns {Promise<Record<keyof typeof FILES, THREE.Texture>>}
 */
export function loadFireTextures(base = "/textures/fire/") {
  cached ??= (async () => {
    const loader = new THREE.TextureLoader();
    const entries = await Promise.all(
      Object.entries(FILES).map(async ([key, file]) => [key, await loader.loadAsync(base + file)]),
    );
    const t = Object.fromEntries(entries);
    t.iron.wrapS = t.iron.wrapT = THREE.RepeatWrapping;
    t.charred.wrapS = t.charred.wrapT = THREE.RepeatWrapping;
    for (const key of ["iron", "charred", "ashBed", "flakes"]) t[key].colorSpace = THREE.SRGBColorSpace;
    // smoke is a luminance mask, not a colour
    t.smoke.colorSpace = THREE.NoColorSpace;
    return t;
  })().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}
