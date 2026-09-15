import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfirmationGate } from './confirmation-gate';

describe('ConfirmationGate', () => {
  it('resolves true when resolve(id, true) is called', async () => {
    const gate = new ConfirmationGate();
    const promise = gate.request('a1', { actionType: 'navigate' });
    expect(gate.isPending('a1')).toBe(true);

    gate.resolve('a1', true);

    await expect(promise).resolves.toBe(true);
    expect(gate.isPending('a1')).toBe(false);
  });

  it('resolves false when resolve(id, false) is called', async () => {
    const gate = new ConfirmationGate();
    const promise = gate.request('a1', { actionType: 'finish' });

    gate.resolve('a1', false);

    await expect(promise).resolves.toBe(false);
  });

  it('calls onRequest with the id and details when a confirmation is requested', () => {
    const onRequest = vi.fn();
    const gate = new ConfirmationGate(60_000, onRequest);
    gate.request('a1', { actionType: 'navigate', targetLabel: null, reason: 'go to checkout', riskLevel: 'dangerous' });

    expect(onRequest).toHaveBeenCalledWith('a1', {
      actionType: 'navigate',
      targetLabel: null,
      reason: 'go to checkout',
      riskLevel: 'dangerous',
    });
  });

  it('resolve() on an unknown or already-settled id is a no-op, never throws', async () => {
    const gate = new ConfirmationGate();
    expect(() => gate.resolve('never-requested', true)).not.toThrow();

    const promise = gate.request('a1', { actionType: 'navigate' });
    gate.resolve('a1', true);
    await promise;
    // Second answer after it already settled — must not throw or resolve again.
    expect(() => gate.resolve('a1', false)).not.toThrow();
  });

  it('rejectAll() resolves every pending request as false and clears them', async () => {
    const gate = new ConfirmationGate();
    const p1 = gate.request('a1', { actionType: 'navigate' });
    const p2 = gate.request('a2', { actionType: 'finish' });
    expect(gate.pendingCount).toBe(2);

    gate.rejectAll();

    await expect(p1).resolves.toBe(false);
    await expect(p2).resolves.toBe(false);
    expect(gate.pendingCount).toBe(0);
  });

  it('rejectAll() with nothing pending does not throw', () => {
    const gate = new ConfirmationGate();
    expect(() => gate.rejectAll()).not.toThrow();
  });
});

describe('ConfirmationGate timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-rejects (resolves false) if nothing answers within the timeout', async () => {
    const gate = new ConfirmationGate(5_000);
    const promise = gate.request('a1', { actionType: 'navigate' });

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toBe(false);
    expect(gate.isPending('a1')).toBe(false);
  });

  it('does not fire the timeout if already resolved earlier', async () => {
    const gate = new ConfirmationGate(5_000);
    const promise = gate.request('a1', { actionType: 'navigate' });
    gate.resolve('a1', true);

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toBe(true);
  });
});
