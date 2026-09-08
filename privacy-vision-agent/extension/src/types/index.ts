/**
 * Bounding box representation [x, y, width, height]
 */
export type BBox = [number, number, number, number];

/**
 * Supported UI element types for extraction
 */
export type ElementType =
  | 'button'
  | 'input'
  | 'link'
  | 'textarea'
  | 'select'
  | 'label'
  | 'div'
  | 'span'
  | 'other';

/**
 * Input element metadata (without exposing actual values)
 */
export interface InputMetadata {
  type?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  autocomplete?: string;
  required?: boolean;
  disabled?: boolean;
}

/**
 * Extracted UI element representation
 */
export interface ExtractedElement {
  id: string;
  type: ElementType;
  text?: string;
  visible: boolean;
  enabled: boolean;
  bbox: BBox;
  metadata?: InputMetadata;
  ariaLabel?: string;
}

/**
 * Page information
 */
export interface PageInfo {
  title: string;
  url: string;
  favicon?: string;
}

/**
 * DOM scan result
 */
export interface DOMScanResult {
  page: PageInfo;
  elements: ExtractedElement[];
  timestamp: number;
}

/**
 * Screenshot capture result
 */
export interface ScreenshotResult {
  dataUrl: string;
  width: number;
  height: number;
  timestamp: number;
}

/**
 * Agent status
 */
export interface AgentStatus {
  ready: boolean;
  activeTab?: chrome.tabs.Tab;
  lastScanTime?: number;
  elementCount?: number;
  screenshotCaptured?: boolean;
}
