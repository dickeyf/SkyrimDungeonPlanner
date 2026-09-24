/**
 * three.js view of a cell (D44), imperative and outside the Svelte component tree. The 2D
 * top-down view is an orthographic camera on the 3D scene; Z slices become clipping planes
 * later (phase 4).
 */
export * from './CellScene';
export * from './meshCache';
export * from './sceneObjects';
export * from './transform';
