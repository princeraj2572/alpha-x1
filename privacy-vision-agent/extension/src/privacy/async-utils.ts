/**
 * Shared helper for bounding async work that has no other timeout of its
 * own — model/worker/session creation depends on hardware, drivers, and
 * asset I/O, none of which this codebase controls. Without a bound, a
 * genuine stall (a known class of real-world WebGPU driver issue, a stuck
 * fetch, ...) hangs forever with zero user-visible feedback, since none of
 * the "load a heavy local resource" call sites in this project have any
 * other timeout mechanism.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
