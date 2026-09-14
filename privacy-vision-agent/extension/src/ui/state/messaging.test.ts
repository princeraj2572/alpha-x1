import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { isRestrictedUrl, requestSanitizePage } from './messaging';

describe('isRestrictedUrl', () => {
  it('flags browser-internal and store pages', () => {
    expect(isRestrictedUrl('chrome://extensions')).toBe(true);
    expect(isRestrictedUrl('chrome-extension://abc123/popup.html')).toBe(true);
    expect(isRestrictedUrl('edge://settings')).toBe(true);
    expect(isRestrictedUrl('about:blank')).toBe(true);
    expect(isRestrictedUrl('https://chrome.google.com/webstore/detail/x')).toBe(true);
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(isRestrictedUrl(undefined)).toBe(true);
  });

  it('allows normal http(s) pages', () => {
    expect(isRestrictedUrl('https://example.com')).toBe(false);
    expect(isRestrictedUrl('http://localhost:3000/checkout')).toBe(false);
  });
});

describe('requestSanitizePage — actionable errors', () => {
  const g = globalThis as unknown as { chrome?: unknown };
  const originalChrome = g.chrome;

  beforeEach(() => {
    g.chrome = undefined;
  });

  afterAll(() => {
    g.chrome = originalChrome;
  });

  it('refuses a restricted-page tab with a clear message before attempting to message it', async () => {
    g.chrome = {
      runtime: { id: 'test-ext-id' },
      tabs: {
        query: vi.fn(async () => [{ id: 1, url: 'chrome://extensions' }]),
        sendMessage: vi.fn(async () => {
          throw new Error('should never be called for a restricted page');
        }),
      },
    };
    await expect(requestSanitizePage()).rejects.toThrow(/does not support the agent/);
    expect((g.chrome as { tabs: { sendMessage: ReturnType<typeof vi.fn> } }).tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('turns "Could not establish connection" into an actionable reload message', async () => {
    g.chrome = {
      runtime: { id: 'test-ext-id' },
      tabs: {
        query: vi.fn(async () => [{ id: 1, url: 'https://example.com' }]),
        sendMessage: vi.fn(async () => {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }),
      },
    };
    await expect(requestSanitizePage()).rejects.toThrow(/reload the page/i);
  });

  it('passes through a normal successful response', async () => {
    const data = { page: { title: 't', url: 'https://example.com' } };
    g.chrome = {
      runtime: { id: 'test-ext-id' },
      tabs: {
        query: vi.fn(async () => [{ id: 1, url: 'https://example.com' }]),
        sendMessage: vi.fn(async () => ({ success: true, data })),
      },
    };
    const result = await requestSanitizePage();
    expect(result).toBe(data);
  });
});
