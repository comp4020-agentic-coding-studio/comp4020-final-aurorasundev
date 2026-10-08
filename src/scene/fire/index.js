// The furnace and the burning of a paper (plan §5). Nothing here runs at
// import: the scene loads this module with a dynamic import() only when a
// ritual starts or a confirmed burn must play, so the space's first load
// carries none of it. Textures load on first use and are shared after.
export { loadFireTextures } from "./assets.js";
export { createFurnace, furnaceAnchor } from "./furnace.js";
export { createBurnEffect } from "./burn-effect.js";
