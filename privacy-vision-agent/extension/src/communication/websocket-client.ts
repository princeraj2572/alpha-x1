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

  private messageHandlers: Map<string, (msg: Message) => void> = new Map();
  private errorHandlers: ((error: Error) => void)[] = [];
  private connectHandlers: (() => void)[] = [];
  private disconnectHandlers: (() => void)[] = [];

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

          // Attempt reconnect
          this.scheduleReconnect();
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
    if (typeof typeOrHandler === 'string' && maybeHandler) {
      this.messageHandlers.set(typeOrHandler, maybeHandler);
    } else if (typeof typeOrHandler === 'function') {
      this.messageHandlers.set('*', typeOrHandler);
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
    const typeHandler = this.messageHandlers.get(message.type);
    if (typeHandler) {
      typeHandler(message);
    }

    // Call wildcard handler
    const wildcardHandler = this.messageHandlers.get('*');
    if (wildcardHandler) {
      wildcardHandler(message);
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
