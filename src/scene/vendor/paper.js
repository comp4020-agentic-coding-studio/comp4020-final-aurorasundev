// Adapted from paper-crumple-demo by nagasawa (ITEM Inc.), MIT licence
// (see ./LICENSE and THIRD_PARTY_NOTICES.md), commit f84648b0.
// Changes: PAPER_DESIGNS, the canvas print textures (title, thumbnail, URL)
// and the font loader are removed. Every paper shares one plain material
// passed in by the scene, so no words are ever drawn into WebGL.
import * as THREE from "three";

/**
 * Builds a Three.js mesh from the animData.
 * Returns: { mesh, positionAttr, normalAttr }
 */
export function createPaper(animData, material) {
  const { vertexCount, indices, uvs, positions, normals } = animData;

  const geometry = new THREE.BufferGeometry();

  // ===== Vertex positions (initialized to frame 0) =====
  // Rewritten every frame, so it holds a Float32Array directly.
  const positionArray = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount * 3; i++) {
    positionArray[i] = positions[i]; // frame 0
  }
  const positionAttr = new THREE.BufferAttribute(positionArray, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage); // updated frequently
  geometry.setAttribute("position", positionAttr);

  // ===== Normals =====
  const normalArray = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount * 3; i++) {
    normalArray[i] = normals[i];
  }
  const normalAttr = new THREE.BufferAttribute(normalArray, 3);
  normalAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("normal", normalAttr);

  // ===== UV =====
  const uvArray = new Float32Array(uvs.length);
  for (let i = 0; i < uvs.length; i++) {
    uvArray[i] = uvs[i];
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));

  // ===== Indices =====
  const indexArray = new Uint16Array(indices);
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));

  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    positionAttr,
    normalAttr,
  };
}

/**
 * Updates the geometry's positions and normals for the given frame
 * (fractional allowed). A fractional frame linearly interpolates between
 * the two adjacent frames.
 */
export function updatePaperFrame(paper, animData, frameIdx) {
  const { vertexCount, frameCount, positions, normals } = animData;
  const { positionAttr, normalAttr } = paper;

  const len = vertexCount * 3;
  const f0 = Math.floor(frameIdx);
  const t = frameIdx - f0;

  const off0 = f0 * len;

  const posArray = positionAttr.array;
  const nrmArray = normalAttr.array;

  if (t < 1e-6) {
    // Integer frame — just copy
    for (let i = 0; i < len; i++) {
      posArray[i] = positions[off0 + i];
      nrmArray[i] = normals[off0 + i];
    }
  } else {
    // Fractional frame — lerp
    const f1 = (f0 + 1) % frameCount;
    const off1 = f1 * len;
    const s = 1 - t;
    for (let i = 0; i < len; i++) {
      posArray[i] = positions[off0 + i] * s + positions[off1 + i] * t;
      nrmArray[i] = normals[off0 + i] * s + normals[off1 + i] * t;
    }
  }

  positionAttr.needsUpdate = true;
  normalAttr.needsUpdate = true;

  paper.mesh.geometry.computeBoundingSphere();
  paper.mesh.geometry.computeBoundingBox();
}
