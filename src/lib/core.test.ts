import { describe, expect, it } from 'vitest';
import {
  buildHybridPrompt,
  isOnDeviceContextLimitError,
  isTransientCloudError,
  resolveInferenceBadge,
} from './ai';
import {
  capArticleLength,
  cleanPageText,
  estimateTokens,
  extractReadableArticle,
  getTokenStatus,
  MAX_ARTICLE_CHARS,
  NANO_TOKEN_LIMIT,
} from './context';
import { reorderPrompts, STARTER_PROMPTS } from './prompts';

describe('context helpers', () => {
  it('cleans excessive whitespace while preserving paragraphs', () => {
    const raw = '  Hello   world \r\n\r\n\r\n   Second\t\tparagraph  ';
    expect(cleanPageText(raw)).toBe('Hello world\n\nSecond paragraph');
  });

  it('estimates tokens and flags Nano window overflow at > 9216', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('12345')).toBe(2);

    const under = getTokenStatus(4608);
    expect(under.exceedsNano).toBe(false);
    expect(under.percent).toBe(50);

    const over = getTokenStatus(NANO_TOKEN_LIMIT + 1);
    expect(over.exceedsNano).toBe(true);
    expect(over.percent).toBe(100);
  });

  it('falls back cleanly to cleaned innerText when DOMParser is unavailable or HTML is empty', () => {
    expect(extractReadableArticle('', '  Fallback   body \n\n\n text  ')).toBe(
      'Fallback body\n\ntext',
    );
    expect(extractReadableArticle('<article><p>Body</p></article>', 'Clean fallback  text')).toBe(
      'Clean fallback text',
    );
  });

  it('caps extracted article text at 15,000 characters cleanly', () => {
    const shortText = 'Short article.';
    expect(capArticleLength(shortText)).toBe(shortText);

    const longText = `${'a'.repeat(14_800)}. ${'b'.repeat(1_000)}`;
    const capped = capArticleLength(longText);
    expect(capped.length).toBeLessThanOrEqual(MAX_ARTICLE_CHARS);
    expect(capped.endsWith('.')).toBe(true);
  });
});

describe('prompt library helpers', () => {
  it('reorders prompts up and down cleanly and normalizes order indices', () => {
    const movedDown = reorderPrompts(STARTER_PROMPTS, STARTER_PROMPTS[0].id, 'down');
    expect(movedDown[0].id).toBe(STARTER_PROMPTS[1].id);
    expect(movedDown[1].id).toBe(STARTER_PROMPTS[0].id);
    expect(movedDown.map((p) => p.order)).toEqual([0, 1, 2, 3]);

    const boundary = reorderPrompts(STARTER_PROMPTS, STARTER_PROMPTS[0].id, 'up');
    expect(boundary.map((p) => p.id)).toEqual(STARTER_PROMPTS.map((p) => p.id));
  });
});

describe('hybrid AI helpers', () => {
  it('combines instruction and webpage context', () => {
    const combined = buildHybridPrompt('Summarize', 'Article body');
    expect(combined).toContain('Summarize');
    expect(combined).toContain('Article body');
  });

  it('maps inferenceSource values to transparent UI badges', () => {
    expect(resolveInferenceBadge('on_device').label).toBe(
      '⚡ On-Device (Gemini Nano 4 • Private)',
    );
    expect(resolveInferenceBadge('IN_DEVICE').kind).toBe('on-device');
    expect(resolveInferenceBadge('in_cloud').label).toBe('☁️ Cloud Fallback (Gemini Cloud)');
    expect(resolveInferenceBadge(undefined).kind).toBe('cloud');
  });

  it('detects on-device context limit errors and ignores unrelated errors', () => {
    expect(isOnDeviceContextLimitError(new Error('The input is too large'))).toBe(true);
    const quotaErr = new Error('Input exceeds model quota');
    quotaErr.name = 'QuotaExceededError';
    expect(isOnDeviceContextLimitError(quotaErr)).toBe(true);
    expect(isOnDeviceContextLimitError(new Error('Exceeds context window limit'))).toBe(true);
    expect(isOnDeviceContextLimitError(new Error('Token limit reached'))).toBe(true);
    expect(isOnDeviceContextLimitError(new Error('Network request failed'))).toBe(false);
    expect(isOnDeviceContextLimitError(null)).toBe(false);
  });

  it('detects timeouts and transient 500/503 errors while ignoring non-transient errors', () => {
    expect(isTransientCloudError(new Error('HTTP 503 Service Unavailable: high demand'))).toBe(true);
    expect(isTransientCloudError(new Error('500 Internal error encountered'))).toBe(true);
    expect(isTransientCloudError({ status: 503, message: 'overloaded' })).toBe(true);
    expect(isTransientCloudError(new Error('Request to gemini-3.5-flash-lite timed out after 8s.'))).toBe(true);
    expect(isTransientCloudError(new Error('400 Invalid API key'))).toBe(false);
    expect(isTransientCloudError(new Error('Permission denied'))).toBe(false);
    expect(isTransientCloudError(null)).toBe(false);
  });
});
