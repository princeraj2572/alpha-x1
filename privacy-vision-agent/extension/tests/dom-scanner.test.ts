import { describe, it, expect, beforeEach } from 'vitest';
import { scanDOM } from '@/scanner/dom-scanner';

/**
 * Mock DOM for testing
 */
function createMockDOM(): void {
  document.body.innerHTML = `
    <div id="test-container">
      <h1>Test Page</h1>

      <!-- Visible button -->
      <button id="btn-submit" style="display: block;">Submit</button>

      <!-- Hidden button -->
      <button id="btn-hidden" style="display: none;">Hidden Button</button>

      <!-- Disabled button -->
      <button id="btn-disabled" disabled>Disabled Button</button>

      <!-- Text input with placeholder -->
      <input id="input-name" type="text" placeholder="Enter your name" />

      <!-- Password input -->
      <input id="input-password" type="password" placeholder="Enter password" />

      <!-- Disabled input -->
      <input id="input-disabled" type="text" disabled />

      <!-- Link -->
      <a id="link-google" href="https://google.com">Google</a>

      <!-- Textarea -->
      <textarea id="textarea-message" placeholder="Enter message"></textarea>

      <!-- Select -->
      <select id="select-country">
        <option value="us">United States</option>
        <option value="uk">United Kingdom</option>
      </select>

      <!-- Clickable div -->
      <div id="div-clickable" role="button" style="cursor: pointer;">Click me</div>

      <!-- Label -->
      <label id="label-agree">I agree to terms</label>

      <!-- Invisible element (opacity 0) -->
      <button id="btn-invisible" style="opacity: 0;">Invisible Button</button>

      <!-- Element with aria-label -->
      <button id="btn-aria" aria-label="Custom aria label">Button</button>
    </div>
  `;
}

describe('DOM Scanner', () => {
  beforeEach(() => {
    createMockDOM();
    // Mock window dimensions
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true });
  });

  it('should scan DOM and return result with page info', () => {
    const result = scanDOM();
    expect(result).toHaveProperty('page');
    expect(result).toHaveProperty('elements');
    expect(result).toHaveProperty('timestamp');
    expect(result.page).toHaveProperty('title');
    expect(result.page).toHaveProperty('url');
  });

  it('should extract buttons', () => {
    const result = scanDOM();
    const buttons = result.elements.filter((el) => el.type === 'button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('should extract input elements', () => {
    const result = scanDOM();
    const inputs = result.elements.filter((el) => el.type === 'input');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('should extract links', () => {
    const result = scanDOM();
    const links = result.elements.filter((el) => el.type === 'link');
    expect(links.length).toBeGreaterThan(0);
  });

  it('should extract textareas', () => {
    const result = scanDOM();
    const textareas = result.elements.filter((el) => el.type === 'textarea');
    expect(textareas.length).toBeGreaterThan(0);
  });

  it('should extract select elements', () => {
    const result = scanDOM();
    const selects = result.elements.filter((el) => el.type === 'select');
    expect(selects.length).toBeGreaterThan(0);
  });

  it('should mark hidden elements as not visible', () => {
    const result = scanDOM();
    const hiddenBtn = result.elements.find((el) => el.text === 'Hidden Button');
    expect(hiddenBtn).toBeDefined();
    expect(hiddenBtn?.visible).toBe(false);
  });

  it('should mark disabled elements as not enabled', () => {
    const result = scanDOM();
    const disabledBtn = result.elements.find((el) => el.text === 'Disabled Button');
    expect(disabledBtn).toBeDefined();
    expect(disabledBtn?.enabled).toBe(false);
  });

  it('should include bbox for all elements', () => {
    const result = scanDOM();
    result.elements.forEach((el) => {
      expect(el.bbox).toBeDefined();
      expect(el.bbox).toHaveLength(4);
      expect(typeof el.bbox[0]).toBe('number');
      expect(typeof el.bbox[1]).toBe('number');
      expect(typeof el.bbox[2]).toBe('number');
      expect(typeof el.bbox[3]).toBe('number');
    });
  });

  it('should include metadata for input elements', () => {
    const result = scanDOM();
    const inputWithMetadata = result.elements.find(
      (el) => el.type === 'input' && el.metadata?.type === 'text'
    );
    expect(inputWithMetadata).toBeDefined();
    expect(inputWithMetadata?.metadata).toBeDefined();
    expect(inputWithMetadata?.metadata?.type).toBeDefined();
  });

  it('should NOT expose input values in metadata', () => {
    const result = scanDOM();
    result.elements.forEach((el) => {
      if (el.metadata) {
        expect(el.metadata).not.toHaveProperty('value');
      }
    });
  });

  it('should mark password input as type password', () => {
    const result = scanDOM();
    const passwordInput = result.elements.find((el) => el.metadata?.type === 'password');
    expect(passwordInput).toBeDefined();
    expect(passwordInput?.metadata?.type).toBe('password');
  });

  it('should extract aria-label', () => {
    const result = scanDOM();
    const ariaBtn = result.elements.find((el) => el.ariaLabel === 'Custom aria label');
    expect(ariaBtn).toBeDefined();
  });

  it('should mark invisible elements (opacity 0) as not visible', () => {
    const result = scanDOM();
    const invisibleBtn = result.elements.find((el) => el.text === 'Invisible Button');
    expect(invisibleBtn).toBeDefined();
    expect(invisibleBtn?.visible).toBe(false);
  });

  it('should extract clickable divs with role="button"', () => {
    const result = scanDOM();
    const clickableDiv = result.elements.find((el) => el.text === 'Click me');
    expect(clickableDiv).toBeDefined();
    expect(clickableDiv?.type).toBe('div');
  });

  it('should extract labels', () => {
    const result = scanDOM();
    const labels = result.elements.filter((el) => el.type === 'label');
    expect(labels.length).toBeGreaterThan(0);
  });

  it('should generate unique IDs for elements', () => {
    const result = scanDOM();
    const ids = result.elements.map((el) => el.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should limit text length to prevent large payloads', () => {
    const longText = 'a'.repeat(500);
    document.body.innerHTML = `<button>${longText}</button>`;
    const result = scanDOM();
    const button = result.elements.find((el) => el.type === 'button');
    expect(button?.text?.length).toBeLessThanOrEqual(200);
  });

  it('should set correct timestamp', () => {
    const before = Date.now();
    const result = scanDOM();
    const after = Date.now();
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it('should handle page with no interactive elements', () => {
    document.body.innerHTML = '<div>Just some text</div>';
    const result = scanDOM();
    expect(result.elements.length).toBeGreaterThanOrEqual(0);
    expect(result.page.url).toBeDefined();
  });

  it('should extract input placeholder text', () => {
    const result = scanDOM();
    const nameInput = result.elements.find((el) => el.metadata?.placeholder === 'Enter your name');
    expect(nameInput).toBeDefined();
  });

  it('should include required attribute in metadata', () => {
    document.body.innerHTML = '<input id="required-field" type="email" required />';
    const result = scanDOM();
    const requiredInput = result.elements.find((el) => el.metadata?.required);
    expect(requiredInput).toBeDefined();
  });

  it('should NOT include actual input values in any field', () => {
    document.body.innerHTML = `
      <input type="text" value="secret-value" />
      <textarea>secret-content</textarea>
      <input type="email" value="test@example.com" />
    `;
    const result = scanDOM();
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain('secret-value');
    expect(resultJson).not.toContain('secret-content');
    expect(resultJson).not.toContain('test@example.com');
  });
});
