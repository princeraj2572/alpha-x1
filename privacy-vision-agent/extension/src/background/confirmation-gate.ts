/**
 * Confirmation gate for dangerous cloud-proposed actions (navigate/finish —
 * see ActionPolicyValidator), DECISION-029.
 *
 * Before this existed, `requiresConfirmation` was computed and displayed to
 * the user but nothing actually paused execution on it — the action ran
 * regardless. This module is the pause: `requestConfirmation` returns a
 * promise that only resolves once something calls `resolveConfirmation`
 * (the side panel, via a runtime message) or the timeout elapses.
 *
 * Pulled out of background/index.ts as its own chrome-API-free module so it
 * can be unit tested directly — background/index.ts itself is thin glue
 * around chrome.* APIs and isn't unit tested anywhere in this codebase.
 */

export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 60_000;

export interface ConfirmationDetails {
  actionType: string;
  targetLabel?: unknown;
  reason?: unknown;
  riskLevel?: unknown;
}

type Resolver = (approved: boolean) => void;

export class ConfirmationGate {
  private pending = new Map<string, Resolver>();

  constructor(
    private readonly timeoutMs: number = DEFAULT_CONFIRMATION_TIMEOUT_MS,
    /** Injectable for tests; defaults to the real emitAgentEvent-style callback. */
    private readonly onRequest: (id: string, details: ConfirmationDetails) => void = () => {}
  ) {}

  /** True while `id` is still awaiting a response. */
  isPending(id: string): boolean {
    return this.pending.has(id);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Requests confirmation for `id`. Resolves `true`/`false` once
   * `resolve(id, approved)` is called, or `false` if nothing answers within
   * the timeout. Calling `resolve`/`rejectAll` for an id with no pending
   * request is a no-op.
   */
  request(id: string, details: ConfirmationDetails): Promise<boolean> {
    return new Promise((resolvePromise) => {
      let settled = false;
      const timer = setTimeout(() => finish(false), this.timeoutMs);
      const finish: Resolver = (approved) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(id);
        resolvePromise(approved);
      };
      this.pending.set(id, finish);
      this.onRequest(id, details);
    });
  }

  /** Answers a pending confirmation. No-op if `id` isn't (or is no longer) pending. */
  resolve(id: string, approved: boolean): void {
    this.pending.get(id)?.(approved);
  }

  /** Rejects every still-pending confirmation (used when the user hits Stop). */
  rejectAll(): void {
    for (const resolve of [...this.pending.values()]) {
      resolve(false);
    }
  }
}
