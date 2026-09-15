import { ShieldAlert } from 'lucide-react';
import { agentStore, useAgentStore } from '../state/agent-store';
import { confirmCloudAction } from '../state/messaging';
import { Card, Button, c } from './primitives';

/**
 * Gate for dangerous cloud-proposed actions (navigate/finish — see
 * ActionPolicyValidator) — DECISION-029. Execution is already paused in the
 * background service worker awaiting this response; closing the panel or
 * ignoring this for 60s auto-rejects.
 */
export function PendingActionConfirm() {
  const { pendingCloudAction: action } = useAgentStore();
  if (!action) {
    return null;
  }

  const respond = (approved: boolean) => {
    // Optimistic clear so the buttons feel instant — the background's own
    // actionValidation follow-up event (approved/blocked) confirms this too.
    agentStore.setPendingCloudAction(null);
    confirmCloudAction(action.id, approved).catch(() => {});
  };

  return (
    <Card
      title="Confirmation Required"
      right={<ShieldAlert size={15} color={c.warn} strokeWidth={2.25} />}
    >
      <p style={{ fontSize: 12, marginBottom: 4 }}>
        The cloud model wants to <strong>{action.actionType}</strong>
        {action.targetLabel ? <> → <strong>{String(action.targetLabel)}</strong></> : null}.
      </p>
      {action.reason && (
        <p style={{ fontSize: 11, color: c.dim, marginBottom: 8 }}>Reason: {action.reason}</p>
      )}
      <p style={{ fontSize: 11, color: c.warn, marginBottom: 4, fontWeight: 700 }}>
        This action ({action.riskLevel ?? 'dangerous'}) needs your approval before it runs.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button tone="primary" onClick={() => respond(true)}>
          Approve
        </Button>
        <Button tone="danger" onClick={() => respond(false)}>
          Reject
        </Button>
      </div>
    </Card>
  );
}
