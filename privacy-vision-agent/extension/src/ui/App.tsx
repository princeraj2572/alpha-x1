import { useEffect } from 'react';
import { ShieldCheck, Play, Square, RotateCcw } from 'lucide-react';
import { agentStore, useAgentStore } from './state/agent-store';
import { getBackendStatus, onAgentEvent, stopAgent } from './state/messaging';
import { runInspection, markStopped, resumeFromStop, isStopped } from './state/pipeline-runner';
import { getVisionModel } from './state/vision-loader';
import { ensureLocalFaceModel } from './state/face-loader';
import { ensureRealOcrEngine } from './state/ocr-loader';
import { Button, Card, c } from './components/primitives';
import { AgentStatus } from './components/AgentStatus';
import { ProcessingPipeline } from './components/ProcessingPipeline';
import { DetectionSummary } from './components/DetectionSummary';
import { DetectionList } from './components/DetectionList';
import { ScreenshotInspector } from './components/ScreenshotInspector';
import { PrivacyGate } from './components/PrivacyGate';
import { PrivacyReview } from './components/PrivacyReview';
import { CloudDecision } from './components/CloudDecision';
import { ActionValidation } from './components/ActionValidation';
import { ExecutionStatus } from './components/ExecutionStatus';
import { SessionTimeline } from './components/SessionTimeline';
import { MetricsPanel } from './components/MetricsPanel';

export function App() {
  const s = useAgentStore();

  // Pre-warm the vision model as soon as the panel opens, off the critical
  // path of the user's first inspection. This is the only place the ~1.9s
  // WebGPU shader-compile cost (DECISION-018) can be hidden from the user —
  // by the time they click Start Agent, the session is (usually) already
  // built. Fire-and-forget: failure here is silent and just means the
  // VISION_DETECTION stage reports its own "unavailable" warning later.
  useEffect(() => {
    getVisionModel().catch(() => {});
    // Same rationale, for the local face-detection fallback (YuNet) used
    // when the platform Shape Detection API isn't available — which is most
    // browsers outside ChromeOS/Android.
    ensureLocalFaceModel().catch(() => {});
    // Same rationale: the Tesseract worker + WASM core + language data load
    // takes real time (network/disk + wasm compile); doing it at mount hides
    // that behind the time the user spends looking at the panel before
    // clicking Start Agent, instead of stalling the VISION_DETECTION stage.
    ensureRealOcrEngine().catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const st = await getBackendStatus();
        if (!alive) {
          return;
        }
        agentStore.setBackendConnected(st.connected);
        if (st.provider) {
          agentStore.setCloud({ provider: st.provider, model: st.model });
        }
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 2500);

    const off = onAgentEvent((e) => {
      if (e.kind === 'cloudAction') {
        const p = e.payload as Record<string, unknown>;
        agentStore.setCloud({
          status: 'received',
          actionType: String(p.actionType ?? ''),
          targetLabel: (p.targetLabel as string) ?? undefined,
          confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
        });
        agentStore.setStage('CLOUD_REASONING', 'success', String(p.actionType ?? ''));
        agentStore.setStage('ACTION_VALIDATION', 'running');
        agentStore.addEvent(`Cloud action received: ${p.actionType}`, 'cloud');
      } else if (e.kind === 'actionValidation') {
        const p = e.payload as Record<string, unknown>;
        const approved = p.status === 'approved';
        agentStore.setActionValidation({
          status: approved ? 'approved' : 'blocked',
          actionSummary: (p.actionSummary as string) ?? undefined,
          reason: (p.reason as string) ?? undefined,
          checks: {
            actionAllowed: approved,
            schemaValid: Boolean(p.schemaValid),
            targetExists: approved ? true : undefined,
            targetVisible: approved ? true : undefined,
            pageStateValid: approved ? true : undefined,
          },
        });
        agentStore.setStage('ACTION_VALIDATION', approved ? 'success' : 'blocked', (p.reason as string) ?? undefined);
        if (approved) {
          agentStore.setStage('EXECUTION', 'running');
        }
        agentStore.addEvent(`Local validation ${approved ? 'passed' : 'blocked'}`, 'validate');
      } else if (e.kind === 'execution') {
        const p = e.payload as Record<string, unknown>;
        if (p.status === 'executing') {
          agentStore.setExecution({ status: 'executing' });
        } else {
          agentStore.setExecution({
            status: p.status === 'done' ? 'done' : 'failed',
            success: Boolean(p.success),
            error: (p.error as string) ?? undefined,
            executionTimeMs: typeof p.executionTimeMs === 'number' ? p.executionTimeMs : undefined,
          });
          agentStore.setStage('EXECUTION', p.success ? 'success' : 'error');
          agentStore.addEvent(`Browser action ${p.success ? 'executed' : 'failed'}`, 'execute');
        }
      } else if (e.kind === 'stopped') {
        markStopped('backend');
      }
    });

    return () => {
      alive = false;
      clearInterval(id);
      off();
    };
  }, []);

  const stopped = isStopped();

  return (
    <div style={{ paddingBottom: 24 }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${c.borderSoft}`,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 8,
            background: c.accentSoft,
            color: c.accent2,
          }}
        >
          <ShieldCheck size={15} strokeWidth={2.25} />
        </span>
        <strong style={{ fontSize: 12.5, letterSpacing: 0.1 }}>Alpha X1 Privacy Browser Agent</strong>
      </header>

      <Card>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: c.dim, fontWeight: 600 }}>Task</label>
          <textarea
            value={s.task}
            onChange={(e) => agentStore.setTask(e.target.value)}
            rows={2}
            style={{
              width: '100%',
              marginTop: 5,
              background: c.panel2,
              color: c.text,
              border: `1px solid ${c.border}`,
              borderRadius: c.radiusSm,
              padding: 8,
              fontSize: 12,
              fontFamily: 'inherit',
              resize: 'vertical',
              outline: 'none',
              transition: 'border-color 120ms ease',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = c.accent)}
            onBlur={(e) => (e.currentTarget.style.borderColor = c.border)}
          />
        </div>
        {!stopped ? (
          <Button
            tone="primary"
            disabled={s.status === 'processing'}
            icon={<Play size={13} strokeWidth={2.5} fill="currentColor" />}
            onClick={() => runInspection()}
          >
            {s.status === 'processing' ? 'Processing…' : s.sent ? 'Run New Inspection' : 'Start Agent'}
          </Button>
        ) : (
          <Button tone="default" icon={<RotateCcw size={13} strokeWidth={2.5} />} onClick={() => resumeFromStop()}>
            Resume (clear stop)
          </Button>
        )}
        <Button
          tone="danger"
          disabled={stopped}
          icon={<Square size={12} strokeWidth={2.5} fill="currentColor" />}
          onClick={async () => {
            await stopAgent();
            markStopped('user');
          }}
        >
          Stop Agent
        </Button>
      </Card>

      <AgentStatus />
      <ProcessingPipeline />
      <DetectionSummary />
      <ScreenshotInspector />
      <DetectionList />
      <PrivacyGate />
      <PrivacyReview />
      <CloudDecision />
      <ActionValidation />
      <ExecutionStatus />
      <MetricsPanel />
      <SessionTimeline />
    </div>
  );
}
