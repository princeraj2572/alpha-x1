import { describe, it, expect, vi } from 'vitest';
import { KillSwitch } from './kill-switch';

/**
 * The actual "stop everything" mechanism — `background/index.ts` checks
 * `killSwitch.isActive()` before executing any cloud-directed action, and
 * `session-manager.ts`'s idle-timeout terminate() activates it. Had no
 * dedicated test of its own before this (only incidentally exercised via
 * the shared singleton inside `session-manager.test.ts`).
 */
describe('KillSwitch', () => {
  it('starts inactive', () => {
    const ks = new KillSwitch();
    expect(ks.isActive()).toBe(false);
    expect(ks.getState()).toMatchObject({ isActive: false, activatedAt: null, reason: null, loopIterationsStopped: 0 });
  });

  it('activate() sets isActive, records the reason and a timestamp', () => {
    const ks = new KillSwitch();
    const before = Date.now();
    ks.activate('user stop');

    expect(ks.isActive()).toBe(true);
    const state = ks.getState();
    expect(state.reason).toBe('user stop');
    expect(state.activatedAt).toBeGreaterThanOrEqual(before);
    expect(state.loopIterationsStopped).toBe(0);
  });

  it('activate() defaults to "Manual stop" when no reason is given', () => {
    const ks = new KillSwitch();
    ks.activate();
    expect(ks.getState().reason).toBe('Manual stop');
  });

  it('activate() is a no-op when already active — does not overwrite the original reason or timestamp', () => {
    const ks = new KillSwitch();
    ks.activate('first reason');
    const firstState = ks.getState();

    ks.activate('second reason');
    expect(ks.getState()).toEqual(firstState);
  });

  it('deactivate() resets to the initial state', () => {
    const ks = new KillSwitch();
    ks.activate('stop');
    ks.recordIterationStopped();

    ks.deactivate();

    expect(ks.getState()).toEqual({
      isActive: false,
      activatedAt: null,
      reason: null,
      loopIterationsStopped: 0,
    });
  });

  it('deactivate() when not active is a harmless no-op', () => {
    const ks = new KillSwitch();
    expect(() => ks.deactivate()).not.toThrow();
    expect(ks.isActive()).toBe(false);
  });

  it('recordIterationStopped() only counts while active', () => {
    const ks = new KillSwitch();
    ks.recordIterationStopped(); // not active yet — must not count
    expect(ks.getState().loopIterationsStopped).toBe(0);

    ks.activate('stop');
    ks.recordIterationStopped();
    ks.recordIterationStopped();
    expect(ks.getState().loopIterationsStopped).toBe(2);
  });

  it('getState() returns a snapshot, not a live reference', () => {
    const ks = new KillSwitch();
    const snapshot = ks.getState();
    ks.activate('stop');
    expect(snapshot.isActive).toBe(false); // the earlier snapshot is untouched
    expect(ks.getState().isActive).toBe(true);
  });

  it('subscribe() notifies listeners on activate/deactivate, with the new state', () => {
    const ks = new KillSwitch();
    const listener = vi.fn();
    ks.subscribe(listener);

    ks.activate('stop');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ isActive: true, reason: 'stop' });

    ks.deactivate();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0]).toMatchObject({ isActive: false });
  });

  it('activate()/deactivate() no-ops do not notify listeners', () => {
    const ks = new KillSwitch();
    const listener = vi.fn();
    ks.subscribe(listener);

    ks.deactivate(); // not active — no-op
    expect(listener).not.toHaveBeenCalled();

    ks.activate('stop');
    ks.activate('ignored'); // already active — no-op
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops further notifications', () => {
    const ks = new KillSwitch();
    const listener = vi.fn();
    const unsubscribe = ks.subscribe(listener);

    unsubscribe();
    ks.activate('stop');
    expect(listener).not.toHaveBeenCalled();
  });

  it('a listener that throws does not prevent other listeners from running or activate() from completing', () => {
    const ks = new KillSwitch();
    const badListener = vi.fn(() => {
      throw new Error('boom');
    });
    const goodListener = vi.fn();
    ks.subscribe(badListener);
    ks.subscribe(goodListener);

    expect(() => ks.activate('stop')).not.toThrow();
    expect(goodListener).toHaveBeenCalledTimes(1);
    expect(ks.isActive()).toBe(true);
  });

  it('reset() returns to the initial state and notifies, even from an inactive state', () => {
    const ks = new KillSwitch();
    const listener = vi.fn();
    ks.subscribe(listener);

    ks.reset();

    expect(ks.getState()).toEqual({
      isActive: false,
      activatedAt: null,
      reason: null,
      loopIterationsStopped: 0,
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reset() clears an active kill switch', () => {
    const ks = new KillSwitch();
    ks.activate('stop');
    ks.recordIterationStopped();

    ks.reset();

    expect(ks.isActive()).toBe(false);
    expect(ks.getState().loopIterationsStopped).toBe(0);
  });
});
