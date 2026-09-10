/**
 * Kill Switch - Emergency stop mechanism for agent loop
 * Allows immediate termination of running automations
 */

export interface KillSwitchState {
  isActive: boolean;
  activatedAt: number | null;
  reason: string | null;
  loopIterationsStopped: number;
}

export class KillSwitch {
  private state: KillSwitchState = {
    isActive: false,
    activatedAt: null,
    reason: null,
    loopIterationsStopped: 0,
  };

  private listeners: Set<(state: KillSwitchState) => void> = new Set();

  /**
   * Check if kill switch is active
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * Activate kill switch
   */
  activate(reason: string = 'Manual stop'): void {
    if (this.state.isActive) {
      console.warn('[Kill Switch] Already active');
      return;
    }

    this.state = {
      isActive: true,
      activatedAt: Date.now(),
      reason,
      loopIterationsStopped: 0,
    };

    console.log(`[Kill Switch] ACTIVATED: ${reason}`);
    this.notifyListeners();
  }

  /**
   * Deactivate kill switch
   */
  deactivate(): void {
    if (!this.state.isActive) {
      console.warn('[Kill Switch] Not active');
      return;
    }

    const activeDuration = Date.now() - (this.state.activatedAt || Date.now());
    console.log(
      `[Kill Switch] DEACTIVATED after ${activeDuration}ms, stopped ${this.state.loopIterationsStopped} iterations`
    );

    this.state = {
      isActive: false,
      activatedAt: null,
      reason: null,
      loopIterationsStopped: 0,
    };

    this.notifyListeners();
  }

  /**
   * Record iteration stopped
   */
  recordIterationStopped(): void {
    if (this.state.isActive) {
      this.state.loopIterationsStopped++;
    }
  }

  /**
   * Get current state
   */
  getState(): Readonly<KillSwitchState> {
    return { ...this.state };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: (state: KillSwitchState) => void): () => void {
    this.listeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    const stateCopy = { ...this.state };
    for (const listener of this.listeners) {
      try {
        listener(stateCopy);
      } catch (error) {
        console.error('[Kill Switch] Listener error:', error);
      }
    }
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.state = {
      isActive: false,
      activatedAt: null,
      reason: null,
      loopIterationsStopped: 0,
    };
    this.notifyListeners();
  }
}

export const killSwitch = new KillSwitch();
