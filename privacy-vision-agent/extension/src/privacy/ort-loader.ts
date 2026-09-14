/**
 * Isolates the two onnxruntime-web entry points behind STATIC import
 * specifiers so Vite/Rollup can resolve and code-split each into a real,
 * browser-loadable chunk (a computed specifier — `import(someVariable)` —
 * cannot be resolved by a bundler and 404s at runtime; that was the actual
 * reason the vision stage never ran end-to-end before, see DECISION-018).
 *
 * Kept in its own file so tests can `vi.mock('@/privacy/ort-loader', ...)`
 * without vitest's Vite-powered Node runner eagerly trying to resolve these
 * imports — both `onnxruntime-web/webgpu` and `onnxruntime-web/wasm` declare
 * `"node": null` in their package exports, so Node/vitest cannot load either
 * one, even when the branch is never taken at runtime.
 */

export interface OrtModuleLike {
  InferenceSession: {
    create(
      model: ArrayBuffer | Uint8Array | string,
      options?: Record<string, unknown>
    ): Promise<{
      run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>;
      inputNames: readonly string[];
      outputNames: readonly string[];
    }>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  env: { wasm: { numThreads?: number; simd?: boolean; wasmPaths?: string } };
}

/** Load the WebGPU-enabled build, or the WASM-only build. Browser-only. */
export async function loadOrtModule(preferWebGpu: boolean): Promise<OrtModuleLike> {
  if (preferWebGpu) {
    return (await import('onnxruntime-web/webgpu')) as unknown as OrtModuleLike;
  }
  return (await import('onnxruntime-web/wasm')) as unknown as OrtModuleLike;
}
