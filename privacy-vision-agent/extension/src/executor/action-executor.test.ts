import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionExecutor } from './action-executor';
import { scanDOM } from '@/scanner/dom-scanner';

/**
 * These tests exist because this file had ZERO coverage before a critical
 * bug was found here: every handler resolved `payload.target_id` via
 * `document.getElementById(...)`, but the scanner's generated IDs
 * ("elem-5") were never written onto the real DOM — nothing but a
 * coincidental real `id="elem-5"` on the page (never true in practice)
 * could ever be found. Click/type/select were broken against any real
 * website. These tests specifically exercise the real
 * `scanDOM()` -> `target_id` -> execute round trip, not just the executor
 * in isolation with hand-picked IDs that could mask the same bug the way
 * the pre-fix unit tests for `detector.ts` did earlier this session.
 */

function findScanned(target: Element) {
  const result = scanDOM();
  const id = target.getAttribute('data-pva-id');
  const record = result.elements.find((e) => e.id === id);
  if (!id || !record) {
    throw new Error('test setup error: element was not assigned an ID by scanDOM()');
  }
  return record.id;
}

describe('ActionExecutor (real scanDOM() round trip)', () => {
  let executor: ActionExecutor;

  beforeEach(() => {
    executor = new ActionExecutor();
    document.body.innerHTML = '';
  });

  it('click actually finds and clicks the real element scanDOM() assigned the ID to', async () => {
    document.body.innerHTML = `<button>Submit</button>`;
    const button = document.querySelector('button')!;
    const targetId = findScanned(button);

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const result = await executor.execute({ action: 'click', target_id: targetId });

    expect(result.success).toBe(true);
    expect(clicked).toBe(true);
  });

  it('click on an unknown target_id fails cleanly instead of matching the wrong element', async () => {
    document.body.innerHTML = `<button>Submit</button>`;
    scanDOM();

    const result = await executor.execute({ action: 'click', target_id: 'elem-999' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('elem-999');
  });

  it('does not confuse two same-shaped elements — each keeps its own distinct ID', async () => {
    document.body.innerHTML = `<button id="a">First</button><button id="b">Second</button>`;
    const [a, b] = Array.from(document.querySelectorAll('button'));
    const idA = findScanned(a);
    const idB = findScanned(b);
    expect(idA).not.toBe(idB);

    let bClicked = false;
    b.addEventListener('click', () => {
      bClicked = true;
    });

    const result = await executor.execute({ action: 'click', target_id: idB });

    expect(result.success).toBe(true);
    expect(bClicked).toBe(true);
  });

  it('type sets the value character by character and dispatches input/change events on the real scanned element', async () => {
    document.body.innerHTML = `<input type="text" />`;
    const input = document.querySelector('input')!;
    const targetId = findScanned(input);

    let inputEvents = 0;
    let changeEvents = 0;
    input.addEventListener('input', () => inputEvents++);
    input.addEventListener('change', () => changeEvents++);

    const result = await executor.execute({ action: 'type', target_id: targetId, value: 'hi' });

    expect(result.success).toBe(true);
    expect(input.value).toBe('hi');
    expect(inputEvents).toBe(2);
    expect(changeEvents).toBe(2);
  }, 10_000);

  it('type on an unknown target_id fails cleanly', async () => {
    document.body.innerHTML = `<input type="text" />`;
    scanDOM();

    const result = await executor.execute({ action: 'type', target_id: 'elem-999', value: 'hi' });

    expect(result.success).toBe(false);
  });

  it('type with a non-string value fails cleanly instead of throwing', async () => {
    document.body.innerHTML = `<input type="text" />`;
    const input = document.querySelector('input')!;
    const targetId = findScanned(input);

    const result = await executor.execute({ action: 'type', target_id: targetId, value: 42 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('string');
  });

  it('select finds the real scanned <select> and dispatches a change event', async () => {
    document.body.innerHTML = `
      <select>
        <option value="us">United States</option>
        <option value="uk">United Kingdom</option>
      </select>
    `;
    const select = document.querySelector('select')!;
    const targetId = findScanned(select);

    let changed = false;
    select.addEventListener('change', () => {
      changed = true;
    });

    const result = await executor.execute({ action: 'select', target_id: targetId, value: 'uk' });

    expect(result.success).toBe(true);
    expect(select.value).toBe('uk');
    expect(changed).toBe(true);
  });

  it('select fails cleanly when the option value does not exist', async () => {
    document.body.innerHTML = `<select><option value="us">United States</option></select>`;
    const select = document.querySelector('select')!;
    const targetId = findScanned(select);

    const result = await executor.execute({ action: 'select', target_id: targetId, value: 'zz' });

    expect(result.success).toBe(false);
  });

  it('scroll calls window.scrollBy with the right sign per direction, defaulting to down', async () => {
    const spy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    await executor.execute({ action: 'scroll' });
    expect(spy).toHaveBeenLastCalledWith(0, 300);

    await executor.execute({ action: 'scroll', direction: 'up', amount: 2 });
    expect(spy).toHaveBeenLastCalledWith(0, -200);

    await executor.execute({ action: 'scroll', direction: 'left', amount: 1 });
    expect(spy).toHaveBeenLastCalledWith(-100, 0);

    await executor.execute({ action: 'scroll', direction: 'right', amount: 1 });
    expect(spy).toHaveBeenLastCalledWith(100, 0);

    spy.mockRestore();
  });

  it('finish resolves successfully with no side effects', async () => {
    const result = await executor.execute({ action: 'finish' });
    expect(result.success).toBe(true);
    expect(result.action_type).toBe('finish');
  });

  it('an unknown action type fails with a descriptive error', async () => {
    const result = await executor.execute({ action: 'teleport' as never });
    expect(result.success).toBe(false);
    expect(result.error).toContain('teleport');
  });
});

describe('ActionExecutor timing (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('wait resolves only after the requested duration', async () => {
    const executor = new ActionExecutor();
    const promise = executor.execute({ action: 'wait', duration_ms: 500 });

    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(400);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('navigate requires a url and otherwise fails cleanly', async () => {
    const executor = new ActionExecutor();
    const result = await executor.execute({ action: 'navigate' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('url');
  });
});
