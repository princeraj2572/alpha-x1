import {
  DOMScanResult,
  ExtractedElement,
  ElementType,
  BBox,
  InputMetadata,
  PageInfo,
} from '@/types/index';
import { privacyDetector } from '@/privacy/detector';

/**
 * Generates a unique ID for an element
 */
function generateElementId(index: number): string {
  return `elem-${index}`;
}

/**
 * Attribute the generated element ID is written to on the real DOM node so
 * `findElementByExtractedId` can find it again later. This ID is what the
 * cloud reasoning provider is shown (`elements[i].id`, see
 * `_build_context_summary` on the backend) and echoes back as `target_id`
 * for click/type/select actions — until this attribute existed, nothing
 * ever wrote it onto the page, so `action-executor.ts`'s
 * `document.getElementById(target_id)` could never find a real element
 * (scanner-generated IDs like "elem-5" essentially never match a page's own
 * `id` attribute) and every click/type/select action failed with "Element
 * not found" against any real website.
 */
export const ELEMENT_ID_ATTR = 'data-pva-id';

/**
 * Checks if an element is visible in the viewport
 */
function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  // Check if element is within viewport or near viewport
  if (
    rect.bottom < -100 ||
    rect.top > window.innerHeight + 100 ||
    rect.right < -100 ||
    rect.left > window.innerWidth + 100
  ) {
    return false;
  }

  // Check if any parent is hidden
  let parent = element.parentElement;
  while (parent) {
    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') {
      return false;
    }
    parent = parent.parentElement;
  }

  return true;
}

/**
 * Checks if an element is enabled
 */
function isElementEnabled(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return true;
  }

  const htmlElement = element as HTMLElement & { disabled?: boolean };
  if ('disabled' in htmlElement) {
    return !htmlElement.disabled;
  }

  return true;
}

/**
 * Gets bounding box for an element
 */
function getBBox(element: Element): BBox {
  const rect = element.getBoundingClientRect();
  return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
}

/**
 * Extracts input element metadata without exposing values
 */
function getInputMetadata(element: HTMLInputElement | HTMLTextAreaElement): InputMetadata {
  const metadata: InputMetadata = {
    type: element instanceof HTMLInputElement ? element.type : 'textarea',
    name: element.name || undefined,
    id: element.id || undefined,
    placeholder: element.placeholder || undefined,
    ariaLabel: element.getAttribute('aria-label') || undefined,
    required: element.required || undefined,
    disabled: element.disabled || undefined,
  };

  // Add autocomplete for inputs
  if (element instanceof HTMLInputElement && element.autocomplete) {
    metadata.autocomplete = element.autocomplete;
  }

  return metadata;
}

/**
 * Gets text content from an element (trimmed and limited)
 */
function getElementText(element: Element): string {
  let text = '';

  if (element instanceof HTMLInputElement) {
    text = element.placeholder || element.value?.substring(0, 1) || '';
  } else if (element instanceof HTMLTextAreaElement) {
    text = element.placeholder || '';
  } else if (element instanceof HTMLSelectElement) {
    text = element.options[element.selectedIndex]?.text || '';
  } else {
    text = (element.textContent || '').trim();
  }

  // Limit text length to avoid large payloads
  return text.substring(0, 200);
}

/**
 * Determines element type
 */
function getElementType(element: Element): ElementType {
  const tag = element.tagName.toLowerCase();
  const isButtonInput = tag === 'input' && (element as HTMLInputElement).type === 'button';

  if (tag === 'button' || isButtonInput) {
    return 'button';
  } else if (tag === 'input') {
    return 'input';
  } else if (tag === 'textarea') {
    return 'textarea';
  } else if (tag === 'a') {
    return 'link';
  } else if (tag === 'select') {
    return 'select';
  } else if (tag === 'label') {
    return 'label';
  } else if (tag === 'div') {
    return 'div';
  } else if (tag === 'span') {
    return 'span';
  }

  return 'other';
}

/**
 * Checks if element should be scanned
 */
function shouldScanElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase();

  const interactiveElements = ['button', 'input', 'a', 'select', 'textarea', 'label'];
  if (interactiveElements.includes(tag)) {
    return true;
  }

  // Also include divs/spans that might be clickable
  if ((tag === 'div' || tag === 'span') && element.getAttribute('role') === 'button') {
    return true;
  }

  return false;
}

/**
 * Gets page information
 */
function getPageInfo(): PageInfo {
  return {
    title: document.title || 'Untitled',
    url: window.location.href,
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href') || undefined,
  };
}

/**
 * Scans the DOM and extracts UI elements
 * Returns a structured representation without sensitive data
 */
export function scanDOM(): DOMScanResult {
  const elements: ExtractedElement[] = [];
  let elementIndex = 0;

  const walker = document.createTreeWalker(
    document.documentElement,
    NodeFilter.SHOW_ELEMENT,
    null
  );

  let node: Element | null;
  while ((node = walker.nextNode() as Element)) {
    if (!shouldScanElement(node)) {
      continue;
    }

    const visible = isElementVisible(node);
    const enabled = isElementEnabled(node);

    // Always scan, but mark visibility
    const elementId = generateElementId(elementIndex++);
    node.setAttribute(ELEMENT_ID_ATTR, elementId);
    const type = getElementType(node);

    let metadata: InputMetadata | undefined;
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      metadata = getInputMetadata(node);
    }

    const element: ExtractedElement = {
      id: elementId,
      type,
      text: getElementText(node),
      visible,
      enabled,
      bbox: getBBox(node),
      metadata,
      ariaLabel: node.getAttribute('aria-label') || undefined,
    };

    // Apply privacy redaction
    const redacted = privacyDetector.redactElement(
      element as unknown as Record<string, unknown>
    ) as unknown as ExtractedElement;

    elements.push(redacted);
  }

  return {
    page: getPageInfo(),
    elements,
    timestamp: Date.now(),
  };
}

/**
 * Finds the real DOM element a previous `scanDOM()` call assigned this
 * extracted ID to, via the attribute `scanDOM()` writes onto it
 * (`ELEMENT_ID_ATTR`) — what `action-executor.ts` uses to resolve a
 * cloud-provided `target_id` back to a real element.
 *
 * This replaces an earlier version of this function that re-walked the DOM
 * counting elements to find the Nth one, matching purely by traversal
 * position with no check that the element found is actually the SAME node
 * that was scanned. Any DOM change between the scan and the action
 * (elements added/removed/reordered — routine on real, especially dynamic,
 * pages, and an action always happens after a network round trip to the
 * cloud reasoning provider) could silently shift which node a given index
 * pointed to, targeting the wrong element rather than failing. Matching on
 * the attribute instead means this can only ever return the exact node that
 * was scanned, or `null` if it's gone — never a different one.
 */
export function findElementByExtractedId(extractedId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${ELEMENT_ID_ATTR}="${escapeAttrSelectorValue(extractedId)}"]`);
}

/**
 * Escapes a value for safe use inside a double-quoted CSS attribute
 * selector (`[attr="…"]`). Deliberately not `CSS.escape` — that targets
 * unquoted-identifier escaping rules and isn't implemented in jsdom (this
 * function needs to run correctly under both the real extension and the
 * test suite); only backslash and double-quote are actually unsafe inside
 * a double-quoted attribute value.
 */
function escapeAttrSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
