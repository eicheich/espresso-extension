import { describe, expect, it } from 'vitest';
import { buildHybridPrompt, resolveInferenceBadge } from './ai';
import { cleanPageText, estimateTokens, getTokenStatus, NANO_TOKEN_LIMIT } from './context';
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
});
