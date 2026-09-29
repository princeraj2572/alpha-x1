import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketClient } from './websocket-client';

/**
 * Minimal fake WebSocket: no real networking, just enough of the browser
 * WebSocket surface (readyState, send, close, on* handlers) for
 * WebSocketClient to drive against. Each instance is captured on
 * FakeWebSocket.instances so a test can reach in and fire events.
 */
class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  /** Test helper: simulate the connection succeeding. */
  triggerOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test helper: simulate a message arriving from the server. */
  triggerMessage(payload: Record<string, unknown>, type = 'context', sessionId = 'sess-1'): void {
    this.onmessage?.({
      data: JSON.stringify({
        protocol_version: '1.0',
        session_id: sessionId,
        message_id: 'm1',
        type,
        timestamp: new Date().toISOString(),
        payload,
      }),
    });
  }
}

describe('WebSocketClient', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function connectedClient(): Promise<{ client: WebSocketClient; socket: FakeWebSocket }> {
    const client = new WebSocketClient('ws://fake/ws');
    const connectPromise = client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.triggerOpen();
    await connectPromise;
    return { client, socket };
  }

  it('calls every handler registered for a message type, not just the last one', async () => {
    const { client, socket } = await connectedClient();

    const first = vi.fn();
    const second = vi.fn();
    client.onMessage('heartbeat', first);
    client.onMessage('heartbeat', second);

    socket.triggerMessage({ sequence: 1 }, 'heartbeat');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('still calls a type-specific handler and a wildcard handler for the same message', async () => {
    const { client, socket } = await connectedClient();

    const typed = vi.fn();
    const wildcard = vi.fn();
    client.onMessage('action', typed);
    client.onMessage(wildcard);

    socket.triggerMessage({}, 'action');

    expect(typed).toHaveBeenCalledTimes(1);
    expect(wildcard).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a reconnect when disconnect() is called intentionally', async () => {
    vi.useFakeTimers();
    const { client, socket } = await connectedClient();

    client.disconnect();
    // The close() call synchronously invokes onclose, which is where a
    // reconnect would previously have been scheduled unconditionally.
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);

    const instancesBefore = FakeWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeWebSocket.instances.length).toBe(instancesBefore); // no reconnect attempt created a new socket
  });

  it('still reconnects after an unexpected close (not via disconnect())', async () => {
    vi.useFakeTimers();
    const { socket } = await connectedClient();

    const instancesBefore = FakeWebSocket.instances.length;
    socket.onclose?.(); // simulate the server dropping the connection
    await vi.advanceTimersByTimeAsync(1500); // first backoff is 1000ms

    expect(FakeWebSocket.instances.length).toBe(instancesBefore + 1);
  });
});
