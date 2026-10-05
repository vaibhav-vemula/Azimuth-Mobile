import * as THREE from 'three';

/**
 * three.js refuses a context that is an instance of WebGLRenderingContext ("WebGL 1 is not supported since r163"). On
 * expo-gl every context is a WebGL 2 context whose class extends WebGLRenderingContext, as the WebGL spec describes, so
 * that check wrongly rejects it and the 3D view never starts. three only makes the check when that global exists, so it is
 * hidden for the moment the renderer is constructed and put back straight after.
 */
export function withoutWebGL1Global<T>(build: () => T): T {
  const g = globalThis as { WebGLRenderingContext?: unknown };
  const had = Object.prototype.hasOwnProperty.call(g, 'WebGLRenderingContext');
  const saved = g.WebGLRenderingContext;
  g.WebGLRenderingContext = undefined;
  try {
    return build();
  } finally {
    if (had) g.WebGLRenderingContext = saved;
    else delete g.WebGLRenderingContext;
  }
}

/** A three.js renderer on an expo-gl context. `canvas` is the stand-in three reads its size and events from. */
export function createRendererOn(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  return withoutWebGL1Global(() => new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: true }));
}
