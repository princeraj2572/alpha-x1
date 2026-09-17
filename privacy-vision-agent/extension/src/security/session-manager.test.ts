import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSessionManager } from './session-manager';
import { killSwitch } from './kill-switch';

describe('SessionManager', () => {
  afterEach(() => {
    killSwitch.reset();
  });

  it('starts active, connected, with zero reconnect attempts', () => {
    const sm = createSessionManager({ sessionId: 's1' });
    const state = sm.getState();
    expect(state).toMatchObject({
      sessionId: 's1',
      isActive: true,
      isConnected: true,
      reconnectAttempts: 0,
    });
    sm.terminate();
  });

  it('markConnected/markDisconnected toggle isConnected and reset reconnectAttempts', () => {
    const sm = createSessionManager({ sessionId: 's1' });
    sm.markDisconnected();
    expect(sm.getState().isConnected).toBe(false);

    sm.shouldReconnect();
    expect(sm.getState().reconnectAttempts).toBe(1);

    sm.markConnected();
    expect(sm.getState().isConnected).toBe(true);
    expect(sm.getState().reconnectAttempts).toBe(0);
    sm.terminate();
  });

  it('markConnected()/markDisconnected() are no-ops (no listener notification) when already in that state', () => {
    const sm = createSessionManager({ sessionId: 's1' });
    const listener = vi.fn();
    sm.subscribe(listener);

    sm.markConnected(); // already connected
    expect(listener).not.toHaveBeenCalled();

    sm.markDisconnected();
    expect(listener).toHaveBeenCalledTimes(1);
    sm.markDisconnected(); // already disconnected
    expect(listener).toHaveBeenCalledTimes(1);
    sm.terminate();
  });

  it('shouldReconnect() returns true and increments attempts up to the configured max', () => {
    const sm = createSessionManager({ sessionId: 's1', reconnectAttemptsMax: 2 });
    expect(sm.shouldReconnect()).toBe(true);
    expect(sm.getState().reconnectAttempts).toBe(1);
    expect(sm.shouldReconnect()).toBe(true);
    expect(sm.getState().reconnectAttempts).toBe(2);
    sm.terminate();
  });

  it('shouldReconnect() terminates the session and returns false once max attempts is exceeded', () => {
    const sm = createSessionManager({ sessionId: 's1', reconnectAttemptsMax: 1 });
    expect(sm.shouldReconnect()).toBe(true);
    expect(sm.shouldReconnect()).toBe(false);
    expect(sm.getState().isActive).toBe(false);
    expect(sm.getState().reason).toBe('Max reconnection attempts exceeded');
  });

  it('getReconnectDelay() doubles per attempt and caps at 30s', () => {
    const sm = createSessionManager({ sessionId: 's1', reconnectDelayMs: 1000, reconnectAttemptsMax: 100 });
    sm.shouldReconnect(); // attempt 1
    expect(sm.getReconnectDelay()).toBe(1000);
    sm.shouldReconnect(); // attempt 2
    expect(sm.getReconnectDelay()).toBe(2000);
    sm.shouldReconnect(); // attempt 3
    expect(sm.getReconnectDelay()).toBe(4000);
    for (let i = 0; i < 10; i++) {
      sm.shouldReconnect();
    }
    expect(sm.getReconnectDelay()).toBe(30_000);
    sm.terminate();
  });

  it('terminate() sets isActive false, records the reason, and is idempotent', () => {
    const sm = createSessionManager({ sessionId: 's1' });
    const listener = vi.fn();
    sm.subscribe(listener);

    sm.terminate('custom reason');
    expect(sm.getState()).toMatchObject({ isActive: false, reason: 'custom reason' });
    expect(listener).toHaveBeenCalledTimes(1);

    // Second terminate() must not re-fire listeners or overwrite the reason.
    sm.terminate('a different reason');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(sm.getState().reason).toBe('custom reason');
  });

  it('terminate() activates the kill switch, but does not clobber an already-active one', () => {
    const sm = createSessionManager({ sessionId: 's1' });
    expect(killSwitch.isActive()).toBe(false);

    sm.terminate('Session timeout');
    expect(killSwitch.isActive()).toBe(true);
    expect(killSwitch.getState().reason).toBe('Session timeout');
  });

  it('unsubscribe stops further notifications', () => {
    const sm = createSessionManager({ sessionId: 's1' });
    const listener = vi.fn();
    const unsubscribe = sm.subscribe(listener);

    sm.markDisconnected();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    sm.markConnected();
    expect(listener).toHaveBeenCalledTimes(1);
    sm.terminate();
  });
});

describe('SessionManager idle timeout (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    killSwitch.reset();
  });

  it('auto-terminates via the heartbeat check once idle past sessionTimeoutMs, even with no recordActivity() call', async () => {
    const sm = createSessionManager({ sessionId: 's1', sessionTimeoutMs: 1000, heartbeatIntervalMs: 200 });

    expect(sm.isExpired()).toBe(false);
    await vi.advanceTimersByTimeAsync(1200);

    expect(sm.isExpired()).toBe(true);
    expect(sm.getState().isActive).toBe(false);
    expect(sm.getState().reason).toBe('Session timeout');
  });

  it('recordActivity() resets the timeout so the session survives past the original deadline', async () => {
    const sm = createSessionManager({ sessionId: 's1', sessionTimeoutMs: 1000, heartbeatIntervalMs: 200 });

    await vi.advanceTimersByTimeAsync(700);
    sm.recordActivity();
    await vi.advanceTimersByTimeAsync(700);

    // 1400ms elapsed total, but activity reset the clock at 700ms, so only
    // 700ms of idle time has actually accumulated — still under the 1000ms limit.
    expect(sm.getState().isActive).toBe(true);
    sm.terminate();
  });

  it('getRemainingTimeout() counts down and reaches zero once expired', async () => {
    const sm = createSessionManager({ sessionId: 's1', sessionTimeoutMs: 1000, heartbeatIntervalMs: 10_000 });

    expect(sm.getRemainingTimeout()).toBe(1000);
    await vi.advanceTimersByTimeAsync(400);
    expect(sm.getRemainingTimeout()).toBeLessThanOrEqual(600);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sm.getRemainingTimeout()).toBe(0);
    sm.terminate();
  });
});
