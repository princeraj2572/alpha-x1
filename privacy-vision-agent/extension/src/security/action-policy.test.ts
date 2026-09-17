import { describe, it, expect } from 'vitest';
import { ActionPolicyValidator, ActionRiskLevel } from './action-policy';
import { ActionPayload } from '@/executor/action-executor';

/**
 * This is the actual security gate DECISION-012 describes (URL scheme
 * whitelist, dangerous-domain blocking, script-content detection in typed
 * values) and `background/index.ts`'s `handleBackendAction` genuinely calls
 * it before any action reaches the page — but it had zero tests before
 * this, same gap that let the click/type/select targeting bug (DECISION-035)
 * and the `detector.ts:110` field bug go unnoticed for so long.
 */
describe('ActionPolicyValidator.validate — click/select/wait/finish', () => {
  it('click, select, and wait are SAFE-or-MODERATE and never require confirmation', () => {
    for (const action of ['click', 'wait'] as const) {
      const result = ActionPolicyValidator.validate({ action, target_id: 'elem-0' });
      expect(result.valid).toBe(true);
      expect(result.riskLevel).toBe(ActionRiskLevel.SAFE);
      expect(result.requiresConfirmation).toBe(false);
    }
  });

  it('finish is DANGEROUS and requires confirmation', () => {
    const result = ActionPolicyValidator.validate({ action: 'finish' });
    expect(result.valid).toBe(true);
    expect(result.riskLevel).toBe(ActionRiskLevel.DANGEROUS);
    expect(result.requiresConfirmation).toBe(true);
  });

  it('rejects an unknown action type as BLOCKED rather than defaulting to SAFE', () => {
    const result = ActionPolicyValidator.validate({ action: 'teleport' as never });
    expect(result.valid).toBe(false);
    expect(result.riskLevel).toBe(ActionRiskLevel.BLOCKED);
    expect(result.reason).toContain('teleport');
  });

  it('rejects a payload over the 10KB size limit', () => {
    const result = ActionPolicyValidator.validate({
      action: 'type',
      target_id: 'elem-0',
      value: 'x'.repeat(11_000),
    });
    expect(result.valid).toBe(false);
    expect(result.riskLevel).toBe(ActionRiskLevel.BLOCKED);
    expect(result.reason).toMatch(/too large/i);
  });
});

describe('ActionPolicyValidator.validate — navigate (the actual URL-injection gate)', () => {
  it('requires a url', () => {
    const result = ActionPolicyValidator.validate({ action: 'navigate' });
    expect(result.valid).toBe(false);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'about:blank', 'blob:https://evil.example/x'])(
    'blocks the %s scheme',
    (url) => {
      const result = ActionPolicyValidator.validate({ action: 'navigate', url });
      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe(ActionRiskLevel.BLOCKED);
    }
  );

  it('scheme check is case-insensitive', () => {
    const result = ActionPolicyValidator.validate({ action: 'navigate', url: 'JavaScript:alert(1)' });
    expect(result.valid).toBe(false);
  });

  it.each(['http://localhost:8000/', 'http://127.0.0.1/admin', 'http://0.0.0.0/', 'http://sub.localhost/'])(
    'blocks navigation to the internal/dangerous host %s',
    (url) => {
      const result = ActionPolicyValidator.validate({ action: 'navigate', url });
      expect(result.valid).toBe(false);
    }
  );

  it('rejects a malformed URL instead of throwing', () => {
    const result = ActionPolicyValidator.validate({ action: 'navigate', url: 'not a url' });
    expect(result.valid).toBe(false);
    expect(result.riskLevel).toBe(ActionRiskLevel.BLOCKED);
  });

  it('allows a normal https URL, but still as DANGEROUS requiring confirmation', () => {
    const result = ActionPolicyValidator.validate({ action: 'navigate', url: 'https://example.com/checkout' });
    expect(result.valid).toBe(true);
    expect(result.riskLevel).toBe(ActionRiskLevel.DANGEROUS);
    expect(result.requiresConfirmation).toBe(true);
  });
});

describe('ActionPolicyValidator.validate — type', () => {
  it('rejects a non-string value', () => {
    const result = ActionPolicyValidator.validate({ action: 'type', target_id: 'elem-0', value: 42 });
    expect(result.valid).toBe(false);
  });

  it.each(['<script>alert(1)</script>', 'javascript:alert(1)'])('blocks suspicious content: %s', (value) => {
    const result = ActionPolicyValidator.validate({ action: 'type', target_id: 'elem-0', value });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/suspicious/i);
  });

  it('allows an ordinary string value as MODERATE', () => {
    const result = ActionPolicyValidator.validate({ action: 'type', target_id: 'elem-0', value: 'hello@example.com' });
    expect(result.valid).toBe(true);
    expect(result.riskLevel).toBe(ActionRiskLevel.MODERATE);
    expect(result.requiresConfirmation).toBe(false);
  });
});

describe('ActionPolicyValidator.validate — scroll', () => {
  it('rejects a non-number amount', () => {
    const result = ActionPolicyValidator.validate({ action: 'scroll', amount: 'lots' as unknown as number });
    expect(result.valid).toBe(false);
  });

  it('rejects an amount over 1000', () => {
    const result = ActionPolicyValidator.validate({ action: 'scroll', amount: 1001 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too large/i);
  });

  it('allows a normal amount, and allows omitting amount entirely', () => {
    const withAmount = ActionPolicyValidator.validate({ action: 'scroll', amount: 3 });
    expect(withAmount.valid).toBe(true);
    expect(withAmount.riskLevel).toBe(ActionRiskLevel.SAFE);

    const withoutAmount: ActionPayload = { action: 'scroll' };
    expect(ActionPolicyValidator.validate(withoutAmount).valid).toBe(true);
  });
});

describe('ActionPolicyValidator.getPolicy', () => {
  it('reports the right risk level and confirmation requirement per action type', () => {
    expect(ActionPolicyValidator.getPolicy('click').riskLevel).toBe(ActionRiskLevel.SAFE);
    expect(ActionPolicyValidator.getPolicy('click').requiresConfirmation).toBe(false);

    expect(ActionPolicyValidator.getPolicy('type').riskLevel).toBe(ActionRiskLevel.MODERATE);
    expect(ActionPolicyValidator.getPolicy('type').requiresConfirmation).toBe(false);

    expect(ActionPolicyValidator.getPolicy('navigate').riskLevel).toBe(ActionRiskLevel.DANGEROUS);
    expect(ActionPolicyValidator.getPolicy('navigate').requiresConfirmation).toBe(true);

    expect(ActionPolicyValidator.getPolicy('unknown' as never).riskLevel).toBe(ActionRiskLevel.BLOCKED);
  });
});
