export const NANO_TOKEN_LIMIT = 9216;

export type ContextSource = 'selection' | 'page';

export interface PageContext {
  source: ContextSource;
  text: string;
  tokens: number;
  pageTitle: string;
  pageUrl: string;
}

export interface TokenStatus {
  tokens: number;
  limit: number;
  percent: number;
  exceedsNano: boolean;
}

const RESTRICTED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'devtools://',
  'view-source:',
];

export function cleanPageText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function getTokenStatus(tokens: number): TokenStatus {
  const safeTokens = Math.max(0, Math.round(tokens));
  return {
    tokens: safeTokens,
    limit: NANO_TOKEN_LIMIT,
    percent: Math.min(100, Math.round((safeTokens / NANO_TOKEN_LIMIT) * 100)),
    exceedsNano: safeTokens > NANO_TOKEN_LIMIT,
  };
}

export async function extractActiveTabContext(): Promise<PageContext> {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.scripting) {
    throw new Error('Chrome extension APIs are unavailable outside the Chrome Side Panel.');
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active browser tab found.');
  }

  const url = tab.url ?? '';
  if (RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    throw new Error('Chrome system pages cannot be read. Switch to a regular webpage tab.');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (): { source: ContextSource; rawText: string } => {
      const selected = window.getSelection()?.toString().trim() ?? '';
      if (selected) {
        return { source: 'selection', rawText: selected };
      }
      return { source: 'page', rawText: document.body?.innerText ?? '' };
    },
  });

  const payload = results[0]?.result;
  if (!payload) {
    throw new Error('Could not extract text from the active webpage.');
  }

  const text = cleanPageText(payload.rawText);
  if (!text) {
    throw new Error('The active webpage appears to have no readable text.');
  }

  return {
    source: payload.source,
    text,
    tokens: estimateTokens(text),
    pageTitle: tab.title?.trim() || 'Active Tab',
    pageUrl: url,
  };
}
