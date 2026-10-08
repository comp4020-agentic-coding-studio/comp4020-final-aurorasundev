// Keeps the fire out of passes that redraw the scene with one override
// material, such as the space's SSAO normal/depth pass. Those draw every
// mesh and sprite with a plain material: the flames' slice quads, smoke
// cards and decals would land in the depth buffer as solid rectangles, and
// a burning paper's consumed parts (cut away only by its own shader) as
// intact paper, so the ambient occlusion would show ghosts of all of them.
//
// While an override material is set, the draw range is emptied just before
// the draw and given back right after it, so the ordinary render and the
// shadow map (which never calls these callbacks) are untouched.
export function skipOverridePasses(object) {
  const before = object.onBeforeRender;
  const after = object.onAfterRender;
  let saved = null;
  object.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    if (scene.overrideMaterial) {
      saved = geometry.drawRange.count;
      geometry.drawRange.count = 0;
    }
    before.call(this, renderer, scene, camera, geometry, material, group);
  };
  object.onAfterRender = function (renderer, scene, camera, geometry, material, group) {
    if (saved !== null) {
      geometry.drawRange.count = saved;
      saved = null;
    }
    after.call(this, renderer, scene, camera, geometry, material, group);
  };
  return () => {
    object.onBeforeRender = before;
    object.onAfterRender = after;
  };
}
