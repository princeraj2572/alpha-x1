/**
 * Privacy-Safe Logger
 * Logs events while stripping sensitive data
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
  sessionId?: string;
}

export class SafeLogger {
  private static readonly SENSITIVE_PATTERNS = [
    /password/i,
    /secret/i,
    /token/i,
    /api[_-]?key/i,
    /authorization/i,
    /bearer/i,
    /cookie/i,
    /session/i,
    /credit[_-]?card/i,
    /card[_-]?number/i,
    /cvv/i,
    /ssn/i,
    /email/i,
    /phone/i,
    /address/i,
  ];

  private static readonly SENSITIVE_VALUES = [
    /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/, // Credit card
    /\d{3}-\d{2}-\d{4}/, // SSN
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // Email
    /\+?1?\d{9,15}/, // Phone
  ];

  private logs: LogEntry[] = [];
  private readonly maxLogs = 1000;
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Log debug message
   */
  debug(component: string, message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.DEBUG, component, message, data);
  }

  /**
   * Log info message
   */
  info(component: string, message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.INFO, component, message, data);
  }

  /**
   * Log warning message
   */
  warn(component: string, message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.WARN, component, message, data);
  }

  /**
   * Log error message
   */
  error(component: string, message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.ERROR, component, message, data);
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>) {
    // Sanitize data
    const sanitized = this.sanitizeData(data);

    // Create log entry
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      component,
      message: this.sanitizeMessage(message),
      data: sanitized,
      sessionId: this.sessionId,
    };

    // Add to internal log
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Also log to console (sanitized)
    this.logToConsole(entry);
  }

  /**
   * Sanitize data object
   */
  private sanitizeData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!data) return undefined;

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      // Check if key is sensitive
      if (this.isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        // Check if value contains sensitive patterns
        if (this.isSensitiveValue(value)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = value;
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively sanitize nested objects
        if (Array.isArray(value)) {
          sanitized[key] = value.map((v) => (typeof v === 'string' && this.isSensitiveValue(v) ? '[REDACTED]' : v));
        } else {
          sanitized[key] = this.sanitizeData(value as Record<string, unknown>);
        }
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Sanitize message
   */
  private sanitizeMessage(message: string): string {
    let sanitized = message;

    // Redact email addresses
    sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');

    // Redact credit card numbers
    sanitized = sanitized.replace(/\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/g, '[CARD]');

    // Redact SSN
    sanitized = sanitized.replace(/\d{3}-\d{2}-\d{4}/g, '[SSN]');

    // Redact phone numbers
    sanitized = sanitized.replace(/\+?1?\d{9,15}/g, '[PHONE]');

    return sanitized;
  }

  /**
   * Check if key is sensitive
   */
  private isSensitiveKey(key: string): boolean {
    return this.SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
  }

  /**
   * Check if value is sensitive
   */
  private isSensitiveValue(value: string): boolean {
    if (value.length > 1000) return false; // Don't check very long strings

    return this.SENSITIVE_VALUES.some((pattern) => pattern.test(value));
  }

  /**
   * Log to console
   */
  private logToConsole(entry: LogEntry) {
    const prefix = `[${entry.component}] [${entry.level}]`;
    const message = entry.data ? `${entry.message} ${JSON.stringify(entry.data)}` : entry.message;

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(prefix, message);
        break;
      case LogLevel.INFO:
        console.info(prefix, message);
        break;
      case LogLevel.WARN:
        console.warn(prefix, message);
        break;
      case LogLevel.ERROR:
        console.error(prefix, message);
        break;
    }
  }

  /**
   * Get all logs
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Get logs filtered by component
   */
  getLogsByComponent(component: string): LogEntry[] {
    return this.logs.filter((log) => log.component === component);
  }

  /**
   * Clear logs
   */
  clearLogs() {
    this.logs = [];
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Verify no sensitive data in logs
   */
  verifySensitivityFree(): { safe: boolean; issues: string[] } {
    const issues: string[] = [];

    for (const log of this.logs) {
      // Check message
      if (log.message.includes('[REDACTED]') === false && this.containsSensitiveData(log.message)) {
        issues.push(`Sensitive data in message at ${new Date(log.timestamp).toISOString()}`);
      }

      // Check data values
      if (log.data) {
        for (const [key, value] of Object.entries(log.data)) {
          if (value === '[REDACTED]') continue;
          if (typeof value === 'string' && this.containsSensitiveData(value)) {
            issues.push(`Sensitive data in ${key} at ${new Date(log.timestamp).toISOString()}`);
          }
        }
      }
    }

    return {
      safe: issues.length === 0,
      issues,
    };
  }

  /**
   * Check if string contains sensitive data
   */
  private containsSensitiveData(str: string): boolean {
    if (str.length > 1000) return false;

    // Check for email
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(str)) return true;

    // Check for credit card
    if (/\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/.test(str)) return true;

    // Check for SSN
    if (/\d{3}-\d{2}-\d{4}/.test(str)) return true;

    return false;
  }
}

export const createSafeLogger = (sessionId: string) => new SafeLogger(sessionId);
