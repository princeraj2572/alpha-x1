import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout } from './async-utils';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves with the inner value when it settles before the deadline', async () => {
    const result = withTimeout(Promise.resolve('ok'), 1000, 'thing');
    await expect(result).resolves.toBe('ok');
  });

  it('rejects with the inner error when it rejects before the deadline', async () => {
    const result = withTimeout(Promise.reject(new Error('boom')), 1000, 'thing');
    await expect(result).rejects.toThrow('boom');
  });

  it('rejects with a labeled timeout error once the deadline passes without settling', async () => {
    const never = new Promise(() => {});
    const result = withTimeout(never, 5000, 'model init');
    const assertion = expect(result).rejects.toThrow('model init timed out after 5000ms');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('does not fire the timeout once the inner promise has already resolved', async () => {
    const result = withTimeout(Promise.resolve('done'), 5000, 'thing');
    await expect(result).resolves.toBe('done');
    // Advancing time after settling must not throw an unhandled rejection.
    await vi.advanceTimersByTimeAsync(10_000);
  });
});
