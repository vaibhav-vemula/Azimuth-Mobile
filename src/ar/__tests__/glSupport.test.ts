import * as THREE from 'three';
import { createRendererOn, withoutWebGL1Global } from '../glSupport';

/** A stand-in for expo-gl: its WebGL 2 class extends the WebGL 1 class, so every context is an instance of both. */
class FakeWebGL1 {}
class FakeWebGL2 extends FakeWebGL1 {}

function fakeGl(): WebGL2RenderingContext {
  const gl = new FakeWebGL2() as unknown as Record<string, unknown>;
  return new Proxy(gl, {
    get: (target, key) => {
      if (key in target) return target[key as string];
      if (key === 'getParameter') return () => 8;
      if (key === 'getShaderPrecisionFormat') return () => ({ rangeMin: 127, rangeMax: 127, precision: 23 });
      if (key === 'getContextAttributes') return () => ({ alpha: true, depth: true, stencil: false, antialias: false });
      if (key === 'getExtension') return () => null;
      if (key === 'getSupportedExtensions') return () => [];
      if (typeof key === 'string' && /^[A-Z0-9_]+$/.test(key)) return 1;
      return () => ({});
    },
  }) as unknown as WebGL2RenderingContext;
}

const canvas = { width: 100, height: 100, style: {}, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as HTMLCanvasElement;

describe('starting three.js on expo-gl', () => {
  beforeEach(() => {
    (globalThis as { WebGLRenderingContext?: unknown }).WebGLRenderingContext = FakeWebGL1;
  });
  afterEach(() => {
    delete (globalThis as { WebGLRenderingContext?: unknown }).WebGLRenderingContext;
  });

  it('is refused by three itself, which is the failure on the phone', () => {
    expect(() => new THREE.WebGLRenderer({ canvas, context: fakeGl() })).toThrow(/WebGL 1 is not supported/);
  });

  it('gets past that check with the global hidden', () => {
    let message = '';
    try {
      createRendererOn(fakeGl(), canvas);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toMatch(/WebGL 1 is not supported/);
  });

  it('puts the global back afterwards, even when building fails', () => {
    expect(() =>
      withoutWebGL1Global(() => {
        expect((globalThis as { WebGLRenderingContext?: unknown }).WebGLRenderingContext).toBeUndefined();
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect((globalThis as { WebGLRenderingContext?: unknown }).WebGLRenderingContext).toBe(FakeWebGL1);
  });

  it('leaves no trace when the global was never there', () => {
    delete (globalThis as { WebGLRenderingContext?: unknown }).WebGLRenderingContext;
    withoutWebGL1Global(() => undefined);
    expect('WebGLRenderingContext' in globalThis).toBe(false);
  });
});
