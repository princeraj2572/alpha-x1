/**
 * WebSocket client for backend communication
 * Handles connection, reconnection, and message routing
 */

import { v4 as uuidv4 } from 'uuid';

export interface Message {
  protocol_version: string;
  session_id: string;
  message_id: string;
  type: 'context' | 'action' | 'action_result' | 'error' | 'heartbeat' | 'page_changed';
  timestamp: string;
  payload: Record<string, unknown>;
}

interface ConnectionState {
  isConnected: boolean;
  sessionId: string | null;
  messagesPending: number;
  lastHeartbeat: number;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start at 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private state: ConnectionState = {
    isConnected: false,
    sessionId: null,
    messagesPending: 0,
    lastHeartbeat: Date.now(),
  };

  // Keyed by message type ('*' for the wildcard). A plain Map<string, handler>
  // meant a second onMessage(sameType, ...) call silently overwrote the
  // first — e.g. the background worker registers two 'heartbeat' handlers
  // (one to auto-ACK, one to track provider/model), and only the last one
  // survived, so heartbeats stopped being ACKed. Arrays let every
  // registered handler for a type actually run.
  private messageHandlers: Map<string, ((msg: Message) => void)[]> = new Map();
  private errorHandlers: ((error: Error) => void)[] = [];
  private connectHandlers: (() => void)[] = [];
  private disconnectHandlers: (() => void)[] = [];
  // Set by disconnect() so the close event it triggers doesn't schedule a
  // reconnect. Without this, calling disconnect() closed the socket but
  // scheduleReconnect() (unconditionally called from onclose) would still
  // fire, reconnecting a client that asked to be shut down.
  private intentionalDisconnect = false;

  constructor(url: string = 'ws://localhost:8000/ws') {
    this.url = url;
    console.log('[WebSocket Client] Initialized with URL:', url);
  }

  /**
   * Connect to backend
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('[WebSocket Client] Connecting to', this.url);

        this.ws = new WebSocket(this.url);
        this.intentionalDisconnect = false;

        this.ws.onopen = () => {
          console.log('[WebSocket Client] Connected');
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          this.state.isConnected = true;

          // Notify listeners
          this.connectHandlers.forEach((h) => h());
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: Message = JSON.parse(event.data);
            this.processMessage(message);
          } catch (error) {
            console.error('[WebSocket Client] Failed to parse message:', error);
            this.notifyError(new Error(`Failed to parse message: ${error}`));
          }
        };

        this.ws.onerror = (_event) => {
          const error = new Error('WebSocket error');
          console.error('[WebSocket Client] Error:', error);
          this.notifyError(error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[WebSocket Client] Disconnected');
          this.state.isConnected = false;
          this.state.sessionId = null;

          // Notify listeners
          this.disconnectHandlers.forEach((h) => h());

          // Attempt reconnect, unless this close was requested via disconnect()
          if (!this.intentionalDisconnect) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from backend
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state.isConnected = false;
  }

  /**
   * Send a message
   */
  async send(type: Message['type'], payload: Record<string, unknown>): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    if (!this.sessionId) {
      throw new Error('No session ID');
    }

    const messageId = uuidv4();
    const message: Message = {
      protocol_version: '1.0',
      session_id: this.sessionId,
      message_id: messageId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };

    this.state.messagesPending++;

    try {
      this.ws.send(JSON.stringify(message));
      console.log('[WebSocket Client] Sent:', type);
      return messageId;
    } catch (error) {
      this.state.messagesPending--;
      throw error;
    }
  }

  /**
   * Send heartbeat ACK
   */
  async sendHeartbeatAck(sequence: number): Promise<void> {
    await this.send('heartbeat', {
      ack: true,
      sequence,
      client_timestamp: new Date().toISOString(),
    });
  }

  /**
   * Register message handler - can pass (type, handler) or just (handler)
   */
  onMessage(typeOrHandler: string | ((msg: Message) => void), maybeHandler?: (msg: Message) => void): void {
    let key: string;
    let handler: (msg: Message) => void;

    if (typeof typeOrHandler === 'string' && maybeHandler) {
      key = typeOrHandler;
      handler = maybeHandler;
    } else if (typeof typeOrHandler === 'function') {
      key = '*';
      handler = typeOrHandler;
    } else {
      return;
    }

    const existing = this.messageHandlers.get(key);
    if (existing) {
      existing.push(handler);
    } else {
      this.messageHandlers.set(key, [handler]);
    }
  }

  /**
   * Register error handler
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Register connect handler
   */
  onConnect(handler: () => void): void {
    this.connectHandlers.push(handler);
  }

  /**
   * Register disconnect handler
   */
  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  /**
   * Get connection state
   */
  getState(): Readonly<ConnectionState> {
    return { ...this.state };
  }

  /**
   * Get session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Handle incoming message
   */
  private processMessage(message: Message): void {
    // Update session ID from first message
    if (!this.sessionId) {
      this.sessionId = message.session_id;
      this.state.sessionId = message.session_id;
      console.log('[WebSocket Client] Session ID received:', message.session_id);
    }

    // Update heartbeat timestamp
    if (message.type === 'heartbeat') {
      this.state.lastHeartbeat = Date.now();
    }

    // Decrement pending message counter
    this.state.messagesPending = Math.max(0, this.state.messagesPending - 1);

    // Call type-specific handlers
    const typeHandlers = this.messageHandlers.get(message.type);
    if (typeHandlers) {
      typeHandlers.forEach((h) => h(message));
    }

    // Call wildcard handlers
    const wildcardHandlers = this.messageHandlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach((h) => h(message));
    }

    console.log('[WebSocket Client] Received:', message.type);
  }

  /**
   * Notify error handlers
   */
  private notifyError(error: Error): void {
    this.errorHandlers.forEach((handler) => handler(error));
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket Client] Max reconnection attempts reached');
      this.notifyError(new Error('Failed to reconnect after ' + this.maxReconnectAttempts + ' attempts'));
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);

    console.log(`[WebSocket Client] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[WebSocket Client] Reconnection failed:', error);
      });
    }, delay);
  }
}

// Export singleton instance
export const wsClient = new WebSocketClient();
