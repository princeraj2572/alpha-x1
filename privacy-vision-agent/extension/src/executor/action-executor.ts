/**
 * Action execution engine
 * Handles browser automation actions: click, type, scroll, select, navigate, wait, finish
 */

export interface ActionPayload {
  action: string;
  target_id?: string;
  value?: string;
  value_ref?: string;
  direction?: string;
  amount?: number;
  option?: string;
  url?: string;
  duration_ms?: number;
  success?: boolean;
  message?: string;
  confidence?: number;
  reason?: string;
}

export interface ActionResult {
  action_id: string;
  action_type: string;
  success: boolean;
  error?: string;
  execution_time_ms: number;
  details?: Record<string, unknown>;
}

class ActionExecutor {
  private elementMap: Map<string, HTMLElement> = new Map();

  setElementMap(elements: Map<string, HTMLElement>): void {
    this.elementMap = elements;
  }

  async execute(payload: ActionPayload): Promise<ActionResult> {
    const startTime = performance.now();
    const actionType = payload.action || 'unknown';

    try {
      switch (actionType) {
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
          throw new Error(`Unknown action type: ${actionType}`);
      }

      return {
        action_id: payload.target_id || 'unknown',
        action_type: actionType,
        success: true,
        execution_time_ms: Math.round(performance.now() - startTime),
        details: { confidence: payload.confidence },
      };
    } catch (error) {
      return {
        action_id: payload.target_id || 'unknown',
        action_type: actionType,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        execution_time_ms: Math.round(performance.now() - startTime),
      };
    }
  }

  private async handleClick(payload: ActionPayload): Promise<void> {
    const { target_id } = payload;
    if (!target_id) throw new Error('Missing target_id for click action');

    const element = this.findElement(target_id);
    if (!element) throw new Error(`Element not found: ${target_id}`);

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(300);
    (element as HTMLElement).click();
  }

  private async handleType(payload: ActionPayload): Promise<void> {
    const { target_id, value } = payload;
    if (!target_id) throw new Error('Missing target_id for type action');
    if (!value) throw new Error('Missing value for type action');

    const element = this.findElement(target_id) as HTMLInputElement | HTMLTextAreaElement;
    if (!element) throw new Error(`Element not found: ${target_id}`);

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(300);
    element.focus();
    await this.delay(100);
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));

    for (const char of value) {
      element.value += char;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await this.delay(20);
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private async handleScroll(payload: ActionPayload): Promise<void> {
    const { direction = 'down', amount = 300 } = payload;

    const scrollMap: Record<string, [number, number]> = {
      up: [0, -amount],
      down: [0, amount],
      left: [-amount, 0],
      right: [amount, 0],
    };

    const [x, y] = scrollMap[direction] || scrollMap.down;
    window.scrollBy({ left: x, top: y, behavior: 'smooth' });
    await this.delay(500);
  }

  private async handleSelect(payload: ActionPayload): Promise<void> {
    const { target_id, option } = payload;
    if (!target_id) throw new Error('Missing target_id for select action');
    if (!option) throw new Error('Missing option for select action');

    const element = this.findElement(target_id) as HTMLSelectElement;
    if (!element) throw new Error(`Element not found: ${target_id}`);

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(300);
    element.value = option;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private async handleNavigate(payload: ActionPayload): Promise<void> {
    const { url } = payload;
    if (!url) throw new Error('Missing url for navigate action');

    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error(`Invalid protocol: ${urlObj.protocol}`);
      }
    } catch (error) {
      throw new Error(`Invalid URL: ${url}`);
    }

    window.location.href = url;
    await this.delay(1000);
  }

  private async handleWait(payload: ActionPayload): Promise<void> {
    const { duration_ms = 1000 } = payload;
    const clampedDuration = Math.min(Math.max(duration_ms, 100), 10000);
    await this.delay(clampedDuration);
  }

  private async handleFinish(payload: ActionPayload): Promise<void> {
    const { success = true, message } = payload;
    console.log(`Task ${success ? 'completed' : 'failed'}: ${message || ''}`);
  }

  private findElement(targetId: string): HTMLElement | null {
    return this.elementMap.get(targetId) || document.getElementById(targetId);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const actionExecutor = new ActionExecutor();
