import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// A square paper record sleeve with real thickness: a slim rounded slab of
// paper stock whose edges read as cut board (a touch darker and warmer than
// the face, as the edge of real card is), the complete generated image inset
// on the front, and the same paper frame the HTML sleeve uses (so the WebGL
// sleeve hands over to the HTML one without a seam). A unit object: the
// layout scales and places its group.
//
// One kit is shared by every sleeve: geometry and textures are made once,
// materials per sleeve (each fades on its own).

// sleeve-frame.png: the paper plate's outer edge sits 3.5% in from the file's
// edge, so at this scale the frame's paper meets the slab's edge exactly
export const FRAME_PLATE = 1.076;
export const ART_INSET = 0.87;
// thickness and edge roundness, as fractions of the sleeve's width
const DEPTH = 0.042;
// the sleeve's front (its paper frame), in sleeve widths from its centre:
// anything meant to draw in front of it sits past this
export const SLEEVE_FRONT = DEPTH / 2 + 0.0012;
const RADIUS = 0.012;

export type SleeveMesh = {
  group: THREE.Group;
  // the raycast target
  body: THREE.Mesh;
  art: THREE.Mesh;
  frame: THREE.Mesh;
  artMat: THREE.MeshBasicMaterial;
  mats: THREE.Material[];
  setOpacity: (o: number) => void;
  dispose: () => void;
};

export type SleeveKit = {
  make: () => SleeveMesh;
  dispose: () => void;
};

export function createSleeveKit(stock: THREE.Texture, frame: THREE.Texture): SleeveKit {
  // groups follow BoxGeometry: +x, -x, +y, -y (the four edges), +z, -z
  const slab = new RoundedBoxGeometry(1, 1, DEPTH, 3, RADIUS);
  const plane = new THREE.PlaneGeometry(1, 1);

  // The edge is only a few pixels deep on screen: the same stock, tinted
  // to the warmer, slightly darker tone of cut board, and fully matte.
  function make(): SleeveMesh {
    const group = new THREE.Group();
    const edgeMat = new THREE.MeshStandardMaterial({
      map: stock,
      color: 0xd8ccb8,
      roughness: 1,
      envMapIntensity: 0.2,
      transparent: true,
    });
    const faceMat = new THREE.MeshStandardMaterial({ map: stock, roughness: 0.95, envMapIntensity: 0.25, transparent: true });
    const backMat = new THREE.MeshStandardMaterial({ map: stock, color: 0xe9e3d8, roughness: 0.95, envMapIntensity: 0.2, transparent: true });
    const body = new THREE.Mesh(slab, [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, backMat]);
    body.renderOrder = 0;

    const artMat = new THREE.MeshBasicMaterial({ map: stock, transparent: true });
    const art = new THREE.Mesh(plane, artMat);
    art.scale.setScalar(ART_INSET);
    art.position.z = DEPTH / 2 + 0.0008;
    art.renderOrder = 1;

    const frameMat = new THREE.MeshStandardMaterial({
      map: frame,
      roughness: 0.95,
      envMapIntensity: 0.25,
      transparent: true,
      alphaTest: 0.01,
      depthWrite: false,
    });
    const frameMesh = new THREE.Mesh(plane, frameMat);
    frameMesh.scale.setScalar(FRAME_PLATE);
    frameMesh.position.z = DEPTH / 2 + 0.0012;
    frameMesh.renderOrder = 2;

    group.add(body, art, frameMesh);
    const mats: THREE.Material[] = [edgeMat, faceMat, backMat, artMat, frameMat];
    return {
      group,
      body,
      art,
      frame: frameMesh,
      artMat,
      mats,
      setOpacity(o) {
        for (const m of mats) m.opacity = o;
      },
      dispose() {
        for (const m of mats) m.dispose();
      },
    };
  }

  return {
    make,
    dispose() {
      slab.dispose();
      plane.dispose();
    },
  };
}
