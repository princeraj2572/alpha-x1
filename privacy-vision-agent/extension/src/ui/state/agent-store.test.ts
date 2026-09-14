import { describe, it, expect, beforeEach } from 'vitest';
import { agentStore } from './agent-store';
import { PrivacyType, DetectionSource } from '@/privacy/types';
import { makeRawCapture } from './outbound';
import { UiFinding } from './types';

const uf = (type: PrivacyType, key: string): UiFinding => ({
  key,
  type,
  source: DetectionSource.REGEX,
  confidence: 0.9,
});

describe('agentStore', () => {
  beforeEach(() => agentStore.reset());

  it('starts in ready with all stages pending', () => {
    const s = agentStore.getState();
    expect(s.status).toBe('ready');
    expect(s.stages.every((st) => st.status === 'pending')).toBe(true);
    expect(s.screenshotPhase).toBe('none');
  });

  it('updates a stage', () => {
    agentStore.setStage('SCREEN_CAPTURE', 'success', '800×600', 12);
    const st = agentStore.getState().stages.find((x) => x.id === 'SCREEN_CAPTURE')!;
    expect(st.status).toBe('success');
    expect(st.detail).toBe('800×600');
    expect(st.durationMs).toBe(12);
  });

  it('derives detection counts from findings', () => {
    agentStore.setFindings([uf(PrivacyType.EMAIL, 'a'), uf(PrivacyType.EMAIL, 'b'), uf(PrivacyType.PASSWORD, 'c')]);
    expect(agentStore.getState().detectionCounts).toEqual({ EMAIL: 2, PASSWORD: 1 });
  });

  it('tracks screenshot phase through raw and sanitized', () => {
    agentStore.setRawCapture(makeRawCapture('data:,x', 10, 10, 1));
    expect(agentStore.getState().screenshotPhase).toBe('raw-ready');
    agentStore.setSanitizedScreenshot({ dataUrl: 'data:,y', width: 10, height: 10, sha256: 'h' });
    expect(agentStore.getState().screenshotPhase).toBe('sanitized-ready');
  });

  it('releaseRawCapture drops the raw reference', () => {
    agentStore.setRawCapture(makeRawCapture('data:,x', 10, 10, 1));
    agentStore.releaseRawCapture();
    expect(agentStore.getState().rawCapture).toBeNull();
  });

  it('selecting a finding is a toggle-friendly setter', () => {
    agentStore.selectFinding('f1');
    expect(agentStore.getState().selectedFindingKey).toBe('f1');
    agentStore.selectFinding(null);
    expect(agentStore.getState().selectedFindingKey).toBeNull();
  });

  it('resetForNewCapture keeps mode + task but clears results', () => {
    agentStore.setMode('automatic');
    agentStore.setTask('do the thing');
    agentStore.setFindings([uf(PrivacyType.EMAIL, 'a')]);
    agentStore.setSent(true);
    agentStore.resetForNewCapture();
    const s = agentStore.getState();
    expect(s.privacyMode).toBe('automatic');
    expect(s.task).toBe('do the thing');
    expect(s.findings).toEqual([]);
    expect(s.sent).toBe(false);
  });

  it('notifies subscribers on change', () => {
    let hits = 0;
    const off = agentStore.subscribe(() => hits++);
    agentStore.setStatus('processing');
    agentStore.addEvent('x', 'user');
    off();
    agentStore.setStatus('ready');
    expect(hits).toBe(2);
  });

  it('swaps the whole state object each change (stable snapshot for React)', () => {
    const a = agentStore.getState();
    agentStore.setStatus('processing');
    const b = agentStore.getState();
    expect(a).not.toBe(b);
    expect(agentStore.getState()).toBe(b);
  });
});
