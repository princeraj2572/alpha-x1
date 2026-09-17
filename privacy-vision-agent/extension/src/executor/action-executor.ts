/**
 * Action Executor - Performs browser actions
 * Handles: click, type, scroll, select, navigate, wait, finish
 */

import { findElementByExtractedId } from '@/scanner/dom-scanner';

export type ActionType = 'click' | 'type' | 'scroll' | 'select' | 'navigate' | 'wait' | 'finish';

export interface ActionPayload {
  action: ActionType;
  target_id?: string;
  value?: string | number | boolean;
  duration_ms?: number;
  // For scroll: direction, amount
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  // For navigate: url
  url?: string;
}

export interface ActionResult {
  action_id: string;
  action_type: ActionType;
  success: boolean;
  error?: string;
  execution_time_ms: number;
  state_before?: string;
  state_after?: string;
}

export class ActionExecutor {
  /**
   * Execute a browser action
   */
  async execute(payload: ActionPayload): Promise<ActionResult> {
    const startTime = performance.now();
    const actionId = `${payload.action}-${Date.now()}`;

    try {
      console.log(`[Action Executor] Executing: ${payload.action} on ${payload.target_id}`);

      switch (payload.action) {
        case 'click':
          await this.handleClick(payload);
          break;
        case 'type':
          await this.handleType(payload);
          break;
        case 'scroll':
          await this.handleScroll(payload);
          break;
        case 'select':
          await this.handleSelect(payload);
          break;
        case 'navigate':
          await this.handleNavigate(payload);
          break;
        case 'wait':
          await this.handleWait(payload);
          break;
        case 'finish':
          await this.handleFinish(payload);
          break;
        default:
          throw new Error(`Unknown action type: ${payload.action}`);
      }

      const executionTime = performance.now() - startTime;

      return {
        action_id: actionId,
        action_type: payload.action,
        success: true,
        execution_time_ms: Math.round(executionTime),
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;

      console.error(`[Action Executor] Failed to execute ${payload.action}:`, error);

      return {
        action_id: actionId,
        action_type: payload.action,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        execution_time_ms: Math.round(executionTime),
      };
    }
  }

  /**
   * Handle click action
   */
  private async handleClick(payload: ActionPayload): Promise<void> {
    if (!payload.target_id) {
      throw new Error('target_id required for click action');
    }

    const element = findElementByExtractedId(payload.target_id);
    if (!element) {
      throw new Error(`Element not found: ${payload.target_id}`);
    }

    // Ensure element is visible
    if (!this.isElementVisible(element)) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.delay(300);
    }

    // Simulate click. No `view` field: real Chrome accepts `window` here,
    // but jsdom's MouseEvent constructor rejects it as "not of type Window"
    // in this test environment, and no real click handler needs it for a
    // synthetic dispatch like this.
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });

    element.dispatchEvent(clickEvent);
    console.log(`[Action Executor] Clicked: ${payload.target_id}`);
  }

  /**
   * Handle type action
   */
  private async handleType(payload: ActionPayload): Promise<void> {
    if (!payload.target_id) {
      throw new Error('target_id required for type action');
    }

    if (typeof payload.value !== 'string') {
      throw new Error('value must be a string for type action');
    }

    const element = findElementByExtractedId(payload.target_id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!element) {
      throw new Error(`Element not found: ${payload.target_id}`);
    }

    // Focus and clear
    element.focus();
    element.value = '';

    // Type characters one at a time
    for (const char of payload.value) {
      element.value += char;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      await this.delay(50); // Simulate typing speed
    }

    console.log(`[Action Executor] Typed ${payload.value.length} characters into ${payload.target_id}`);
  }

  /**
   * Handle scroll action
   */
  private async handleScroll(payload: ActionPayload): Promise<void> {
    const direction = payload.direction || 'down';
    const amount = payload.amount || 3;

    const scrollAmount = amount * 100;

    if (direction === 'down') {
      window.scrollBy(0, scrollAmount);
    } else if (direction === 'up') {
      window.scrollBy(0, -scrollAmount);
    } else if (direction === 'left') {
      window.scrollBy(-scrollAmount, 0);
    } else if (direction === 'right') {
      window.scrollBy(scrollAmount, 0);
    }

    await this.delay(300);
    console.log(`[Action Executor] Scrolled ${direction} by ${amount} units`);
  }

  /**
   * Handle select action
   */
  private async handleSelect(payload: ActionPayload): Promise<void> {
    if (!payload.target_id) {
      throw new Error('target_id required for select action');
    }

    const selectElement = findElementByExtractedId(payload.target_id) as HTMLSelectElement | null;
    if (!selectElement || selectElement.tagName !== 'SELECT') {
      throw new Error(`Select element not found: ${payload.target_id}`);
    }

    const optionValue = String(payload.value);
    const option = selectElement.querySelector(`option[value="${optionValue}"]`);

    if (!option) {
      throw new Error(`Option not found: ${optionValue}`);
    }

    selectElement.value = optionValue;
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));

    console.log(`[Action Executor] Selected: ${optionValue} in ${payload.target_id}`);
  }

  /**
   * Handle navigate action
   */
  private async handleNavigate(payload: ActionPayload): Promise<void> {
    if (!payload.url) {
      throw new Error('url required for navigate action');
    }

    console.log(`[Action Executor] Navigating to: ${payload.url}`);
    window.location.href = payload.url;

    // Wait for navigation
    await this.delay(2000);
  }

  /**
   * Handle wait action
   */
  private async handleWait(payload: ActionPayload): Promise<void> {
    const duration = payload.duration_ms || 1000;
    console.log(`[Action Executor] Waiting ${duration}ms`);
    await this.delay(duration);
  }

  /**
   * Handle finish action
   */
  private async handleFinish(_payload: ActionPayload): Promise<void> {
    console.log(`[Action Executor] Task finished`);
    // Task is complete - no further actions needed
  }

  /**
   * Check if element is visible in viewport
   */
  private isElementVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const actionExecutor = new ActionExecutor();
