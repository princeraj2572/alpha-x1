/**
 * Session Manager
 * Handles session timeouts, reconnection, and authentication
 */

import { killSwitch } from './kill-switch';
import { createSafeLogger } from './safe-logger';

export interface SessionConfig {
  sessionId: string;
  sessionTimeoutMs?: number;
  reconnectAttemptsMax?: number;
  reconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
}

export interface SessionState {
  sessionId: string;
  isActive: boolean;
  createdAt: number;
  lastActivityAt: number;
  reconnectAttempts: number;
  isConnected: boolean;
}

export class SessionManager {
  private config: Required<SessionConfig>;
  private state: SessionState;
  private logger: ReturnType<typeof createSafeLogger>;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<(state: SessionState) => void> = new Set();

  constructor(config: SessionConfig) {
    this.config = {
      sessionId: config.sessionId,
      sessionTimeoutMs: config.sessionTimeoutMs ?? 600000, // 10 minutes
      reconnectAttemptsMax: config.reconnectAttemptsMax ?? 5,
      reconnectDelayMs: config.reconnectDelayMs ?? 1000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000, // 30 seconds
    };

    this.logger = createSafeLogger(config.sessionId);

    this.state = {
      sessionId: config.sessionId,
      isActive: true,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      reconnectAttempts: 0,
      isConnected: true,
    };

    this.logger.info('SessionManager', 'Session created', { sessionId: config.sessionId });
    this.startHeartbeat();
  }

  /**
   * Record activity (resets timeout)
   */
  recordActivity(): void {
    this.state.lastActivityAt = Date.now();
    this.resetTimeoutTimer();
  }

  /**
   * Mark session as connected
   */
  markConnected(): void {
    if (!this.state.isConnected) {
      this.state.isConnected = true;
      this.state.reconnectAttempts = 0;
      this.logger.info('SessionManager', 'Session reconnected');
      this.notifyListeners();
    }
  }

  /**
   * Mark session as disconnected
   */
  markDisconnected(): void {
    if (this.state.isConnected) {
      this.state.isConnected = false;
      this.state.reconnectAttempts = 0;
      this.logger.warn('SessionManager', 'Session disconnected');
      this.notifyListeners();
    }
  }

  /**
   * Handle reconnection attempt
   */
  shouldReconnect(): boolean {
    if (this.state.reconnectAttempts < this.config.reconnectAttemptsMax) {
      this.state.reconnectAttempts++;
      this.logger.info('SessionManager', 'Attempting reconnection', {
        attempt: this.state.reconnectAttempts,
        maxAttempts: this.config.reconnectAttemptsMax,
      });
      return true;
    }

    this.logger.error('SessionManager', 'Max reconnection attempts reached');
    this.terminate('Max reconnection attempts exceeded');
    return false;
  }

  /**
   * Get reconnection delay (exponential backoff)
   */
  getReconnectDelay(): number {
    const exponentialDelay = Math.pow(2, this.state.reconnectAttempts - 1) * this.config.reconnectDelayMs;
    const maxDelay = 30000; // 30 seconds max
    return Math.min(exponentialDelay, maxDelay);
  }

  /**
   * Check if session is expired
   */
  isExpired(): boolean {
    const inactiveTime = Date.now() - this.state.lastActivityAt;
    return inactiveTime > this.config.sessionTimeoutMs;
  }

  /**
   * Get session state
   */
  getState(): Readonly<SessionState> {
    return { ...this.state };
  }

  /**
   * Get remaining timeout in ms
   */
  getRemainingTimeout(): number {
    const inactiveTime = Date.now() - this.state.lastActivityAt;
    return Math.max(0, this.config.sessionTimeoutMs - inactiveTime);
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.checkTimeout();
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Reset timeout timer
   */
  private resetTimeoutTimer(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }

    this.timeoutTimer = setTimeout(() => {
      this.handleTimeout();
    }, this.config.sessionTimeoutMs);
  }

  /**
   * Check if session has timed out
   */
  private checkTimeout(): void {
    if (this.isExpired()) {
      this.handleTimeout();
    }
  }

  /**
   * Handle session timeout
   */
  private handleTimeout(): void {
    this.logger.warn('SessionManager', 'Session timeout');
    this.terminate('Session timeout');
  }

  /**
   * Terminate session
   */
  terminate(reason: string = 'Session terminated'): void {
    if (!this.state.isActive) {
      return;
    }

    this.state.isActive = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    this.logger.info('SessionManager', 'Session terminated', { reason });

    // Activate kill switch on session termination
    if (!killSwitch.isActive()) {
      killSwitch.activate(reason);
    }

    this.notifyListeners();
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: (state: SessionState) => void): () => void {
    this.listeners.add(callback);

    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify listeners
   */
  private notifyListeners(): void {
    const stateCopy = { ...this.state };
    for (const listener of this.listeners) {
      try {
        listener(stateCopy);
      } catch (error) {
        this.logger.error('SessionManager', 'Listener error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Get logger
   */
  getLogger() {
    return this.logger;
  }
}

export const createSessionManager = (config: SessionConfig) => new SessionManager(config);
