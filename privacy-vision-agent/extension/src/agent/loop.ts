/**
 * Agent Loop - Multi-step automation with state tracking
 * Orchestrates: observe → sanitize → reason → validate → execute → detect change
 */

import { scanDOM } from '@/scanner/dom-scanner';
import { visionEngine } from '@/vision/vision-engine';
import { visualPrivacyEngine } from '@/vision/privacy';
import { privacyFusionEngine } from '@/vision/fusion';
import { actionExecutor } from '@/executor/action-executor';

export interface AgentLoopConfig {
  maxIterations?: number;
  timeoutMs?: number;
  autoLoop?: boolean;
  task?: string;
}

export interface LoopIteration {
  iteration: number;
  timestamp: number;
  phase: 'observe' | 'sanitize' | 'reason' | 'validate' | 'execute' | 'detect' | 'complete' | 'error';
  context?: {
    domElements: number;
    visualElements: number;
    sensitiveElements: number;
  };
  action?: {
    type: string;
    target?: string;
    confidence?: number;
  };
  result?: {
    success: boolean;
    error?: string;
    executionTimeMs?: number;
  };
  stateChange?: {
    elementsAdded: number;
    elementsRemoved: number;
    elementChanged: number;
  };
}

export class AgentLoop {
  private config: Required<AgentLoopConfig>;
  private iterations: LoopIteration[] = [];
  private previousPageHash: string | null = null;
  private isRunning = false;

  constructor(config: AgentLoopConfig = {}) {
    this.config = {
      maxIterations: config.maxIterations ?? 10,
      timeoutMs: config.timeoutMs ?? 60000,
      autoLoop: config.autoLoop ?? false,
      task: config.task ?? 'Complete the task on this page',
    };
  }

  /**
   * Run the agent loop
   */
  async run(): Promise<LoopIteration[]> {
    if (this.isRunning) {
      throw new Error('Agent loop already running');
    }

    this.isRunning = true;
    this.iterations = [];

    console.log(`[Agent Loop] Starting multi-step automation`);
    console.log(`[Agent Loop] Task: ${this.config.task}`);
    console.log(`[Agent Loop] Max iterations: ${this.config.maxIterations}`);

    const startTime = Date.now();

    for (let i = 0; i < this.config.maxIterations; i++) {
      if (Date.now() - startTime > this.config.timeoutMs) {
        console.warn(`[Agent Loop] Timeout after ${this.config.timeoutMs}ms`);
        break;
      }

      try {
        const iteration = await this.runIteration(i + 1);
        this.iterations.push(iteration);

        // Check if task is complete
        if (iteration.phase === 'complete') {
          console.log(`[Agent Loop] Task completed in ${i + 1} iterations`);
          break;
        }

        // Wait between iterations
        await this.delay(1000);
      } catch (error) {
        console.error(`[Agent Loop] Error in iteration ${i + 1}:`, error);
        this.iterations.push({
          iteration: i + 1,
          timestamp: Date.now(),
          phase: 'error',
          result: {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        break;
      }
    }

    this.isRunning = false;
    console.log(`[Agent Loop] Complete. Ran ${this.iterations.length} iterations`);
    return this.iterations;
  }

  /**
   * Run a single loop iteration
   */
  private async runIteration(iterationNumber: number): Promise<LoopIteration> {
    const startTime = Date.now();
    const iteration: LoopIteration = {
      iteration: iterationNumber,
      timestamp: startTime,
      phase: 'observe',
    };

    console.log(`\n[Agent Loop] === ITERATION ${iterationNumber} ===`);

    try {
      // PHASE 1: Observe
      console.log(`[Agent Loop] PHASE 1: Observe`);
      const observation = await this.observe();
      iteration.context = {
        domElements: observation.domElements.length,
        visualElements: observation.visualElements.length,
        sensitiveElements: observation.sensitiveElements,
      };

      // PHASE 2: Sanitize
      console.log(`[Agent Loop] PHASE 2: Sanitize`);
      iteration.phase = 'sanitize';
      const sanitized = this.sanitize(observation);

      // PHASE 3: Reason
      console.log(`[Agent Loop] PHASE 3: Reason`);
      iteration.phase = 'reason';
      const action = await this.reason(sanitized);
      iteration.action = {
        type: action.action_type,
        target: action.target_id,
        confidence: action.confidence,
      };

      // PHASE 4: Validate
      console.log(`[Agent Loop] PHASE 4: Validate`);
      iteration.phase = 'validate';
      const isValid = this.validate(action);
      if (!isValid) {
        throw new Error('Action validation failed');
      }

      // PHASE 5: Execute
      console.log(`[Agent Loop] PHASE 5: Execute`);
      iteration.phase = 'execute';
      const result = await this.execute(action);
      iteration.result = {
        success: result.success,
        error: result.error,
        executionTimeMs: result.execution_time_ms,
      };

      if (!result.success) {
        throw new Error(result.error || 'Action execution failed');
      }

      // PHASE 6: Detect Change
      console.log(`[Agent Loop] PHASE 6: Detect Change`);
      iteration.phase = 'detect';
      const stateChange = await this.detectStateChange(observation);
      iteration.stateChange = stateChange;

      // Check if we should continue
      if (stateChange.elementsAdded === 0 && stateChange.elementChanged === 0) {
        console.log(`[Agent Loop] No state change detected - task may be complete`);
        iteration.phase = 'complete';
      }

      return iteration;
    } catch (error) {
      iteration.phase = 'error';
      iteration.result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      return iteration;
    }
  }

  /**
   * PHASE 1: Observe current page state
   */
  private async observe() {
    const domResult = scanDOM();
    const visualResult = await visionEngine.detectVisualElements();
    const privacyResult = await visualPrivacyEngine.detectFaces();

    console.log(`  - DOM: ${domResult.elements.length} elements`);
    console.log(`  - Visual: ${visualResult.elements.length} elements`);
    console.log(`  - Faces: ${privacyResult.faces.length} detected`);

    return {
      domElements: domResult.elements,
      visualElements: visualResult.elements,
      privacyThreats: privacyResult.faces,
      timestamp: Date.now(),
      sensitiveElements: domResult.elements.filter((el) => (el as any).sensitivity === 'confidential').length,
    };
  }

  /**
   * PHASE 2: Sanitize sensitive data
   */
  private sanitize(observation: Awaited<ReturnType<typeof this.observe>>) {
    const fused = privacyFusionEngine.fuse(observation.domElements, observation.visualElements);

    console.log(`  - Redacted ${observation.sensitiveElements} sensitive elements`);
    console.log(`  - Detected ${observation.privacyThreats.length} privacy threats`);

    return {
      ...observation,
      fusedElements: fused,
    };
  }

  /**
   * PHASE 3: Reason (send to backend/Claude)
   */
  private async reason(sanitized: Awaited<ReturnType<typeof this.sanitize>>) {
    // TODO: Call backend reasoning endpoint
    // For now, return a mock action
    console.log(`  - Sending context to cloud reasoning`);

    // Mock action - in production, would call backend
    return {
      action_type: 'wait',
      target_id: null,
      duration_ms: 1000,
      confidence: 0.9,
      reason: 'Mock action pending cloud integration',
    };
  }

  /**
   * PHASE 4: Validate action
   */
  private validate(action: Awaited<ReturnType<typeof this.reason>>): boolean {
    // Check action schema
    const validTypes = ['click', 'type', 'scroll', 'select', 'navigate', 'wait', 'finish'];
    if (!validTypes.includes(action.action_type)) {
      console.warn(`  - Invalid action type: ${action.action_type}`);
      return false;
    }

    // Check confidence
    if (action.confidence < 0.5) {
      console.warn(`  - Low confidence: ${action.confidence}`);
      return false;
    }

    console.log(`  - Action validated: ${action.action_type} (confidence: ${action.confidence})`);
    return true;
  }

  /**
   * PHASE 5: Execute action
   */
  private async execute(action: Awaited<ReturnType<typeof this.reason>>) {
    // In browser context, send to content script
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: 'executeAction',
          payload: action,
        },
        (response) => {
          resolve(response || { success: false, error: 'No response' });
        }
      );
    });
  }

  /**
   * PHASE 6: Detect state change
   */
  private async detectStateChange(observation: Awaited<ReturnType<typeof this.observe>>) {
    const currentHash = this.hashPageState(observation);
    let elementsAdded = 0;
    let elementChanged = 0;
    let elementsRemoved = 0;

    if (this.previousPageHash && this.previousPageHash !== currentHash) {
      // Page changed - detect what changed
      elementsAdded = Math.max(0, observation.domElements.length - (this.iterations.length > 0 ? this.iterations[0].context?.domElements ?? 0 : 0));
      elementChanged = 1; // Simplified - in production would do detailed diffing
    }

    this.previousPageHash = currentHash;

    console.log(`  - Elements changed: ${elementChanged + elementsAdded + elementsRemoved}`);

    return {
      elementsAdded,
      elementChanged,
      elementsRemoved,
    };
  }

  /**
   * Hash page state for change detection
   */
  private hashPageState(observation: Awaited<ReturnType<typeof this.observe>>): string {
    const state = `${observation.domElements.length}-${observation.visualElements.length}-${observation.timestamp}`;
    // Simple hash - in production would use proper hashing
    return state;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get loop statistics
   */
  getStats() {
    return {
      iterations: this.iterations.length,
      successful: this.iterations.filter((it) => it.result?.success).length,
      failed: this.iterations.filter((it) => !it.result?.success).length,
      phases: {
        observe: this.iterations.filter((it) => it.phase === 'observe').length,
        execute: this.iterations.filter((it) => it.phase === 'execute').length,
        complete: this.iterations.filter((it) => it.phase === 'complete').length,
      },
    };
  }
}

export const agentLoop = new AgentLoop();
