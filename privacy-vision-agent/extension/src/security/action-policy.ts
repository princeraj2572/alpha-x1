/**
 * Action Security Policy
 * Validates actions against allowlists and dangerous-action rules
 */

import { ActionPayload, ActionType } from '@/executor/action-executor';

export enum ActionRiskLevel {
  SAFE = 'safe',
  MODERATE = 'moderate',
  DANGEROUS = 'dangerous',
  BLOCKED = 'blocked',
}

export interface ActionPolicy {
  type: ActionType;
  riskLevel: ActionRiskLevel;
  requiresConfirmation?: boolean;
  requiresTargetValidation?: boolean;
  maxPayloadBytes?: number;
  allowedDomains?: string[];
  deniedDomains?: string[];
}

export class ActionPolicyValidator {
  private static readonly SAFE_ACTIONS: Set<ActionType> = new Set(['click', 'scroll', 'wait']);

  private static readonly MODERATE_ACTIONS: Set<ActionType> = new Set(['type', 'select']);

  private static readonly DANGEROUS_ACTIONS: Set<ActionType> = new Set(['navigate', 'finish']);

  private static readonly BLOCKED_ACTIONS: Set<ActionType> = new Set([]);

  private static readonly MAX_PAYLOAD_BYTES = 10240; // 10KB

  private static readonly DANGEROUS_URLS = [
    'javascript:',
    'data:',
    'file://',
    'about:',
    'blob:',
  ];

  private static readonly DANGEROUS_DOMAINS = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
  ];

  /**
   * Validate action against security policy
   */
  static validate(action: ActionPayload): {
    valid: boolean;
    riskLevel: ActionRiskLevel;
    requiresConfirmation: boolean;
    reason?: string;
  } {
    // Check action type is allowed
    if (this.BLOCKED_ACTIONS.has(action.action)) {
      return {
        valid: false,
        riskLevel: ActionRiskLevel.BLOCKED,
        requiresConfirmation: false,
        reason: `Action type "${action.action}" is blocked by policy`,
      };
    }

    // Determine risk level
    let riskLevel = ActionRiskLevel.SAFE;
    if (this.DANGEROUS_ACTIONS.has(action.action)) {
      riskLevel = ActionRiskLevel.DANGEROUS;
    } else if (this.MODERATE_ACTIONS.has(action.action)) {
      riskLevel = ActionRiskLevel.MODERATE;
    }

    // Validate payload size
    const payloadSize = JSON.stringify(action).length;
    if (payloadSize > this.MAX_PAYLOAD_BYTES) {
      return {
        valid: false,
        riskLevel: ActionRiskLevel.BLOCKED,
        requiresConfirmation: false,
        reason: `Payload too large: ${payloadSize} bytes (max: ${this.MAX_PAYLOAD_BYTES})`,
      };
    }

    // Validate action-specific constraints
    const actionValidation = this.validateActionSpecific(action);
    if (!actionValidation.valid) {
      return actionValidation;
    }

    // Determine if confirmation needed
    const requiresConfirmation = riskLevel === ActionRiskLevel.DANGEROUS;

    return {
      valid: true,
      riskLevel,
      requiresConfirmation,
    };
  }

  /**
   * Validate action-specific constraints
   */
  private static validateActionSpecific(action: ActionPayload): {
    valid: boolean;
    riskLevel: ActionRiskLevel;
    requiresConfirmation: boolean;
    reason?: string;
  } {
    switch (action.action) {
      case 'navigate':
        return this.validateNavigate(action);
      case 'type':
        return this.validateType(action);
      case 'scroll':
        return this.validateScroll(action);
      case 'click':
      case 'select':
      case 'wait':
      case 'finish':
        return {
          valid: true,
          riskLevel: ActionRiskLevel.SAFE,
          requiresConfirmation: false,
        };
      default:
        return {
          valid: false,
          riskLevel: ActionRiskLevel.BLOCKED,
          requiresConfirmation: false,
          reason: `Unknown action type: ${action.action}`,
        };
    }
  }

  /**
   * Validate navigate action
   */
  private static validateNavigate(action: ActionPayload): {
    valid: boolean;
    riskLevel: ActionRiskLevel;
    requiresConfirmation: boolean;
    reason?: string;
  } {
    if (!action.url) {
      return {
        valid: false,
        riskLevel: ActionRiskLevel.BLOCKED,
        requiresConfirmation: false,
        reason: 'Navigate action requires URL',
      };
    }

    // Check for dangerous URL schemes
    const url = action.url.toLowerCase();
    for (const dangerous of this.DANGEROUS_URLS) {
      if (url.startsWith(dangerous)) {
        return {
          valid: false,
          riskLevel: ActionRiskLevel.BLOCKED,
          requiresConfirmation: false,
          reason: `URL scheme not allowed: ${dangerous}`,
        };
      }
    }

    // Check for dangerous domains
    try {
      const urlObj = new URL(action.url);
      const hostname = urlObj.hostname.toLowerCase();

      for (const dangerous of this.DANGEROUS_DOMAINS) {
        if (hostname === dangerous || hostname.endsWith(`.${dangerous}`)) {
          return {
            valid: false,
            riskLevel: ActionRiskLevel.BLOCKED,
            requiresConfirmation: false,
            reason: `Navigation to ${hostname} not allowed`,
          };
        }
      }
    } catch (error) {
      return {
        valid: false,
        riskLevel: ActionRiskLevel.BLOCKED,
        requiresConfirmation: false,
        reason: `Invalid URL: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return {
      valid: true,
      riskLevel: ActionRiskLevel.DANGEROUS,
      requiresConfirmation: true,
    };
  }

  /**
   * Validate type action
   */
  private static validateType(action: ActionPayload): {
    valid: boolean;
    riskLevel: ActionRiskLevel;
    requiresConfirmation: boolean;
    reason?: string;
  } {
    if (typeof action.value !== 'string') {
      return {
        valid: false,
        riskLevel: ActionRiskLevel.BLOCKED,
        requiresConfirmation: false,
        reason: 'Type action value must be a string',
      };
    }

    // Check for suspicious patterns
    const value = action.value;
    if (value.includes('<script') || value.includes('javascript:')) {
      return {
        valid: false,
        riskLevel: ActionRiskLevel.BLOCKED,
        requiresConfirmation: false,
        reason: 'Suspicious script content detected in type value',
      };
    }

    return {
      valid: true,
      riskLevel: ActionRiskLevel.MODERATE,
      requiresConfirmation: false,
    };
  }

  /**
   * Validate scroll action
   */
  private static validateScroll(action: ActionPayload): {
    valid: boolean;
    riskLevel: ActionRiskLevel;
    requiresConfirmation: boolean;
    reason?: string;
  } {
    if (action.amount && typeof action.amount !== 'number') {
      return {
        valid: false,
        riskLevel: ActionRiskLevel.BLOCKED,
        requiresConfirmation: false,
        reason: 'Scroll amount must be a number',
      };
    }

    if (action.amount && action.amount > 1000) {
      return {
        valid: false,
        riskLevel: ActionRiskLevel.BLOCKED,
        requiresConfirmation: false,
        reason: 'Scroll amount too large (max: 1000)',
      };
    }

    return {
      valid: true,
      riskLevel: ActionRiskLevel.SAFE,
      requiresConfirmation: false,
    };
  }

  /**
   * Get policy for action type
   */
  static getPolicy(actionType: ActionType): ActionPolicy {
    if (this.SAFE_ACTIONS.has(actionType)) {
      return {
        type: actionType,
        riskLevel: ActionRiskLevel.SAFE,
        requiresConfirmation: false,
      };
    }

    if (this.MODERATE_ACTIONS.has(actionType)) {
      return {
        type: actionType,
        riskLevel: ActionRiskLevel.MODERATE,
        requiresConfirmation: false,
      };
    }

    if (this.DANGEROUS_ACTIONS.has(actionType)) {
      return {
        type: actionType,
        riskLevel: ActionRiskLevel.DANGEROUS,
        requiresConfirmation: true,
      };
    }

    return {
      type: actionType,
      riskLevel: ActionRiskLevel.BLOCKED,
      requiresConfirmation: false,
    };
  }
}

export const actionPolicyValidator = new ActionPolicyValidator();
