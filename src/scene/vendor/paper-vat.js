// Adapted from paper-crumple-demo by nagasawa (ITEM Inc.), MIT licence
// (see ./LICENSE and THIRD_PARTY_NOTICES.md), commit f84648b0.
// Changes: debug URL flags and console logging removed; load cached once.
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

const FRAME_COUNT = 50;

// Throwaway: the demo read ?decode= / ?normals= debug flags from the URL here;
// they are fixed to the correct decode and smooth normals.
const DECODE_MODE = "correct";
const NORMALS_MODE = "smooth";

/**
 * Loads the VAT files (FBX mesh + EXR position texture) and returns
 * animData in the same shape as animation.json.
 *
 * animData: { vertexCount, frameCount, indices, uvs, positions, normals }
 */
// Throwaway: the decoded data is shared by every paper and every mount of the
// scene, so it loads and decodes once per page.
let cached = null;
export function loadVATData(basePath) {
  cached ??= decodeVATData(basePath).catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

async function decodeVATData(basePath) {
  const fbxLoader = new FBXLoader();
  const exrLoader = new EXRLoader();
  exrLoader.setDataType(THREE.FloatType);

  // Load the FBX and the position EXR in parallel
  const [fbxGroup, posTex] = await Promise.all([
    fbxLoader.loadAsync(basePath + "geo/vertex_animation_textures1_mesh.fbx"),
    exrLoader.loadAsync(basePath + "tex/vertex_animation_textures1_pos.exr"),
  ]);

  // Get the mesh out of the FBX
  let fbxMesh = null;
  fbxGroup.traverse((child) => {
    if (child.isMesh && !fbxMesh) fbxMesh = child;
  });
  if (!fbxMesh) throw new Error("No mesh found in the FBX");

  const geo = fbxMesh.geometry;
  const posAttr = geo.getAttribute("position");
  const uvAttr = geo.getAttribute("uv");
  const indexAttr = geo.getIndex();
  const vertexCount = posAttr.count;
  // VAT lookup UV: FBXLoader stores the second UV set as "uv1"
  const vatUvAttr = geo.getAttribute("uv2") || geo.getAttribute("uv1");

  // Index array
  // The FBX's tail has 2 triangles that look like a non-VAT bbox dummy
  // (uv1 = 0,0); exclude them.
  const indices = [];
  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i++) indices.push(indexAttr.getX(i));
  } else {
    for (let i = 0; i < vertexCount; i += 3) {
      const hasInvalidVatUv =
        vatUvAttr &&
        (
          (vatUvAttr.getX(i) === 0 && vatUvAttr.getY(i) === 0) ||
          (vatUvAttr.getX(i + 1) === 0 && vatUvAttr.getY(i + 1) === 0) ||
          (vatUvAttr.getX(i + 2) === 0 && vatUvAttr.getY(i + 2) === 0)
        );
      if (hasInvalidVatUv) continue;

      indices.push(i, i + 1, i + 2);
    }
  }

  // UV array (for paper texture mapping)
  const uvs = [];
  if (uvAttr) {
    for (let i = 0; i < uvAttr.count; i++) {
      uvs.push(uvAttr.getX(i), uvAttr.getY(i));
    }
  }

  // ===== Read frame data out of the EXR position texture =====
  const posData = posTex.image.data; // Float32Array
  const texW = posTex.image.width;
  const texH = posTex.image.height;
  const channels = posData.length / (texW * texH); // usually 4 (RGBA)

  const rawFrameCount = FRAME_COUNT;
  let pointCount = vertexCount;

  if (vatUvAttr) {
    pointCount = 0;
    for (let v = 0; v < vertexCount; v++) {
      if (vatUvAttr.getX(v) === 0 && vatUvAttr.getY(v) === 0) continue;

      const col = Math.floor(vatUvAttr.getX(v) * texW);
      const row = Math.floor((1 - vatUvAttr.getY(v)) * texH);
      pointCount = Math.max(pointCount, row * texW + col + 1);
    }
  }

  // Rows occupied by one frame (for this asset: 3500 points ÷ width 1024 →
  // 4 rows)
  const rowsPerFrame = Math.ceil(pointCount / texW);

//  console.log("[VAT] pointCount:", pointCount, "rowsPerFrame:", rowsPerFrame, "rawFrameCount:", rawFrameCount);

  // Each vertex's VAT point ID — vertices that share a position in the
  // triangle soup get the same ID. Used both for decoding and for
  // computing smooth normals.
  const vertexPointIds = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    let pointId;
    if (vatUvAttr) {
      if (vatUvAttr.getX(v) === 0 && vatUvAttr.getY(v) === 0) {
        pointId = 0;
      } else {
        const col = Math.floor(vatUvAttr.getX(v) * texW);
        const row = Math.floor((1 - vatUvAttr.getY(v)) * texH);
        pointId = row * texW + col;
      }
    } else {
      pointId = v;
    }
    vertexPointIds[v] = Math.max(0, Math.min(pointId, pointCount - 1));
  }

  // Actual vertex coordinates for every frame (rest position plus the
  // displacement already added in). One flat array laid out as
  // [frame 0's xyz for every vertex][frame 1's xyz for every vertex]...
  // "raw" means before the still frames are cut; after cutting, it
  // becomes `positions`.
  const rawPositions = new Float32Array(vertexCount * 3 * rawFrameCount);

  // Total rows the animation uses (for this asset: 4 rows × 50 frames =
  // 200 = texture height)
  const totalRows = rawFrameCount * rowsPerFrame;

  for (let frame = 0; frame < rawFrameCount; frame++) {
    for (let v = 0; v < vertexCount; v++) {
      const pointId = vertexPointIds[v];

      // There are more points than the texture is wide, so one frame
      // wraps across several rows (for this asset: 3500 points →
      // 1024 × 4 rows). The file itself naturally lists frames
      // top-to-bottom, but three.js's EXRLoader flips the scanlines
      // top-to-bottom when storing them in the array, to match WebGL's
      // UV convention (V=0 is the bottom) — so reading the array as if
      // it were the image gives you the whole thing upside down. One
      // flip undoes that.
      const col = pointId % texW;
      const blockRow = Math.floor(pointId / texW);
      let row;
      if (DECODE_MODE === "naive") {
        // For the article: reads the logical rows as-is with no
        // correction (the first, worst-case breakage, with every quirk
        // mixed together)
        row = frame * rowsPerFrame + blockRow;
      } else if (DECODE_MODE === "reversed") {
        // For the article: row order fixed but frame order is still
        // reversed (symptom ①: frame 0 is a neat crumpled ball / the
        // last frame is flat — time runs backwards)
        row = frame * rowsPerFrame + (rowsPerFrame - 1 - blockRow);
      } else if (DECODE_MODE === "noflip") {
        // For the article: only the frame order is reversed, without
        // fixing the row order within each block (symptom ②: a tear
        // from misaligned rows)
        row = (rawFrameCount - 1 - frame) * rowsPerFrame + blockRow;
      } else {
        row = totalRows - 1 - (frame * rowsPerFrame + blockRow);
      }
      const pixelIdx = (row * texW + col) * channels;
      const off = (frame * vertexCount + v) * 3;

      // The pixel value is the displacement from the rest position.
      // Only X has its sign flipped, so it's subtracted back out. The
      // FBX arrives unconverted (the raw file's vertex values match
      // what's loaded), but the EXR's displacement was baked out with
      // just its X component mirrored — apparently to match a
      // left-handed target (Unity flips X on FBX import).
      // (?decode=nomirror removes this correction to reproduce symptom ③.)
      const xSign = DECODE_MODE === "nomirror" ? 1 : -1;
      rawPositions[off + 0] = posAttr.getX(v) + xSign * posData[pixelIdx + 0];
      rawPositions[off + 1] = posAttr.getY(v) + posData[pixelIdx + 1];
      rawPositions[off + 2] = posAttr.getZ(v) + posData[pixelIdx + 2];
    }
  }

  // ===== Cut the motionless leading/trailing frames =====
  // Measures the largest vertex movement between adjacent frames and
  // removes the stretches where nothing is moving.
  const frameStride = vertexCount * 3;
  const frameDeltas = [];
  for (let frame = 0; frame < rawFrameCount - 1; frame++) {
    const a = frame * frameStride;
    const b = (frame + 1) * frameStride;
    let maxDelta = 0;
    for (let i = 0; i < frameStride; i++) {
      const d = Math.abs(rawPositions[a + i] - rawPositions[b + i]);
      if (d > maxDelta) maxDelta = d;
    }
    frameDeltas.push(maxDelta);
  }

  const MOTION_EPSILON = 1e-4;
  let firstMoving = frameDeltas.findIndex((d) => d > MOTION_EPSILON);
  let lastMoving = frameDeltas.length - 1;
  while (lastMoving >= 0 && frameDeltas[lastMoving] <= MOTION_EPSILON) {
    lastMoving--;
  }

  let frameCount = rawFrameCount;
  let positions = rawPositions;
  // In a symptom-reproduction mode the deltas aren't meaningful, so don't cut
  if (
    DECODE_MODE === "correct" &&
    (firstMoving > 0 || lastMoving < frameDeltas.length - 1)
  ) {
    if (firstMoving === -1) firstMoving = 0;
    // frameDeltas[i] is the movement from frame i to i+1, so keep through i+1
    frameCount = lastMoving + 2 - firstMoving;
    positions = rawPositions.slice(
      firstMoving * frameStride,
      (firstMoving + frameCount) * frameStride,
    );
  } else {
  }

  // ===== Vertices to measure (excluding the FBX's trailing bbox dummy vertices) =====
  const validVerts = [];
  for (let v = 0; v < vertexCount; v++) {
    if (vatUvAttr && vatUvAttr.getX(v) === 0 && vatUvAttr.getY(v) === 0) continue;
    validVerts.push(v);
  }

  // ===== Measure the open state's (frame 0) XZ size =====
  // Used to size it against the screen once it's open.
  let minFX = Infinity;
  let maxFX = -Infinity;
  let minFZ = Infinity;
  let maxFZ = -Infinity;
  for (const v of validVerts) {
    const x = positions[v * 3 + 0];
    const z = positions[v * 3 + 2];
    if (x < minFX) minFX = x;
    if (x > maxFX) maxFX = x;
    if (z < minFZ) minFZ = z;
    if (z > maxFZ) maxFZ = z;
  }
  const flat = { width: maxFX - minFX, depth: maxFZ - minFZ };

  // ===== Measure the crumpled state's (last frame) center and radius =====
  // Used for the physics collision sphere and the rotation center. To
  // keep a stray protruding corner (an outlier) from skewing it, the
  // radius is the 90th percentile of distances from the centroid.
  const lastOff = (frameCount - 1) * frameStride;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const v of validVerts) {
    cx += positions[lastOff + v * 3 + 0];
    cy += positions[lastOff + v * 3 + 1];
    cz += positions[lastOff + v * 3 + 2];
  }
  cx /= validVerts.length;
  cy /= validVerts.length;
  cz /= validVerts.length;

  const dists = new Float32Array(validVerts.length);
  for (let i = 0; i < validVerts.length; i++) {
    const v = validVerts[i];
    const dx = positions[lastOff + v * 3 + 0] - cx;
    const dy = positions[lastOff + v * 3 + 1] - cy;
    const dz = positions[lastOff + v * 3 + 2] - cz;
    dists[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  dists.sort();
  const crumple = {
    center: [cx, cy, cz],
    radius: dists[Math.floor(validVerts.length * 0.9)],
  };

  // ===== Compute smooth normals =====
  // The mesh is a triangle soup that doesn't share vertices, so
  // computeVertexNormals would give flat-shaded face normals and the
  // triangle edges would show.
  //
  // So normals are built per point instead:
  //   ① Compute each triangle's (soup order) face normal.
  //   ② Add that face normal into the slot for the point each of its
  //      three corner vertices belongs to (an interior grid point
  //      collects votes from its roughly 6 surrounding triangles).
  //   ③ Averaging (normalizing) each point's total gives that point's
  //      normal.
  //   ④ Hand that back out to every copy-vertex belonging to the same
  //      point.
  // Every copy-vertex at the same spot ends up with the same normal, so
  // the triangle seams stop showing up in the shading.
  const normals = new Float32Array(vertexCount * 3 * frameCount);
  const pointNormals = new Float32Array(pointCount * 3);

  for (let frame = 0; frame < frameCount; frame++) {
    const srcOff = frame * vertexCount * 3;

    // For the article (?normals=flat): skips the per-point averaging and
    // puts the face normal straight onto its three vertices — equivalent
    // to computeVertexNormals on the soup. Reproduces the state where
    // the triangles show.
    if (NORMALS_MODE === "flat") {
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3;
        const b = indices[i + 1] * 3;
        const c = indices[i + 2] * 3;
        const ax = positions[srcOff + a];
        const ay = positions[srcOff + a + 1];
        const az = positions[srcOff + a + 2];
        const e1x = positions[srcOff + b] - ax;
        const e1y = positions[srcOff + b + 1] - ay;
        const e1z = positions[srcOff + b + 2] - az;
        const e2x = positions[srcOff + c] - ax;
        const e2y = positions[srcOff + c + 1] - ay;
        const e2z = positions[srcOff + c + 2] - az;
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        for (let k = 0; k < 3; k++) {
          const o = srcOff + indices[i + k] * 3;
          normals[o] = nx;
          normals[o + 1] = ny;
          normals[o + 2] = nz;
        }
      }
      continue;
    }

    pointNormals.fill(0);

    // Add the (area-weighted) face normal into each point
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3;
      const b = indices[i + 1] * 3;
      const c = indices[i + 2] * 3;

      const ax = positions[srcOff + a];
      const ay = positions[srcOff + a + 1];
      const az = positions[srcOff + a + 2];
      const e1x = positions[srcOff + b] - ax;
      const e1y = positions[srcOff + b + 1] - ay;
      const e1z = positions[srcOff + b + 2] - az;
      const e2x = positions[srcOff + c] - ax;
      const e2y = positions[srcOff + c + 1] - ay;
      const e2z = positions[srcOff + c + 2] - az;

      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      for (let k = 0; k < 3; k++) {
        const pid = vertexPointIds[indices[i + k]] * 3;
        pointNormals[pid] += nx;
        pointNormals[pid + 1] += ny;
        pointNormals[pid + 2] += nz;
      }
    }

    // Normalize
    for (let p = 0; p < pointCount; p++) {
      const o = p * 3;
      const len = Math.hypot(
        pointNormals[o],
        pointNormals[o + 1],
        pointNormals[o + 2],
      );
      if (len > 1e-10) {
        pointNormals[o] /= len;
        pointNormals[o + 1] /= len;
        pointNormals[o + 2] /= len;
      } else {
        pointNormals[o] = 0;
        pointNormals[o + 1] = 1;
        pointNormals[o + 2] = 0;
      }
    }

    // Hand it back out to each vertex
    for (let v = 0; v < vertexCount; v++) {
      const pid = vertexPointIds[v] * 3;
      const o = srcOff + v * 3;
      normals[o] = pointNormals[pid];
      normals[o + 1] = pointNormals[pid + 1];
      normals[o + 2] = pointNormals[pid + 2];
    }
  }

  return { vertexCount, frameCount, indices, uvs, positions, normals, crumple, flat };
}
