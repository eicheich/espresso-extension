import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildHybridPrompt,
  CLOUD_FALLBACK_MODELS,
  CLOUD_INFERENCE_SOURCE,
  detectChromeMajorVersion,
  diagnoseLocalAi,
  isLocalAvailabilityReady,
  isNetworkOrOfflineError,
  isOnDeviceContextLimitError,
  isQuotaLimitError,
  isStreamParseError,
  isTransientCloudError,
  isWarmSessionCached,
  LOCAL_INFERENCE_SOURCE,
  LOCAL_MAX_CHARS,
  LOCAL_RETRY_MAX_CHARS,
  LOCAL_TRUNCATED_NOTICE,
  LocalAiSetupRequiredError,
  prewarmLocalSession,
  resetWarmBaseSessionForTests,
  resolveInferenceBadge,
  runHybridPrompt,
  SAFE_ON_DEVICE_TOKEN_LIMIT,
  truncateForLocalContext,
  warmUpLocalAi,
} from './ai';
import {
  capArticleLength,
  cleanPageText,
  ContextExtractionError,
  estimateTokens,
  extractPdfTextFromBytes,
  extractReadableArticle,
  finalizePdfExtractedText,
  getTokenStatus,
  isPdfUrl,
  MAX_ARTICLE_CHARS,
  NANO_TOKEN_LIMIT,
  PDF_MAX_CHARS,
  sanitizeHtmlForReadability,
} from './context';
import { isBuiltInPrompt, reorderPrompts, STARTER_PROMPTS } from './prompts';

describe('context helpers', () => {
  it('cleans excessive whitespace while preserving paragraphs', () => {
    const raw = '  Hello   world \r\n\r\n\r\n   Second\t\tparagraph  ';
    expect(cleanPageText(raw)).toBe('Hello world\n\nSecond paragraph');
  });

  it('estimates tokens and flags window overflow cleanly', () => {
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

  it('strips inline event handlers, scripts, noscripts, and javascript URLs from HTML', () => {
    const dirty =
      '<html><body><script>alert(1)</script><noscript><img src=x onerror=alert(2)></noscript>' +
      '<img src="pic.jpg" onload="init()" onerror=\'bad()\'>' +
      '<a href="javascript:void(0)" onclick="track()">Click</a>' +
      '<article><p>Clean article content.</p></article></body></html>';
    const cleaned = sanitizeHtmlForReadability(dirty);
    expect(cleaned).not.toMatch(/<script/i);
    expect(cleaned).not.toMatch(/<noscript/i);
    expect(cleaned).not.toMatch(/\sonerror\s*=/i);
    expect(cleaned).not.toMatch(/\sonload\s*=/i);
    expect(cleaned).not.toMatch(/\sonclick\s*=/i);
    expect(cleaned).not.toMatch(/javascript:/i);
    expect(cleaned).toContain('Clean article content.');
  });
});

describe('prompt library helpers', () => {
  it('provides exactly 4 Gemini Nano 4 core prompts across expected categories', () => {
    expect(STARTER_PROMPTS).toHaveLength(4);
    expect(STARTER_PROMPTS.every((item) => isBuiltInPrompt(item))).toBe(true);
    expect(STARTER_PROMPTS.map((item) => item.title)).toEqual([
      'Quick Summary',
      'Key Takeaways',
      "Explain Like I'm 5",
      'Code & Docs Breakdown',
    ]);
    expect(STARTER_PROMPTS.map((item) => item.order)).toEqual([0, 1, 2, 3]);
    expect(new Set(STARTER_PROMPTS.map((item) => item.category))).toEqual(
      new Set(['Summary', 'Insights', 'Learning', 'Engineering']),
    );
  });

  it('reorders prompts up and down cleanly and normalizes order indices', () => {
    const movedDown = reorderPrompts(STARTER_PROMPTS, STARTER_PROMPTS[0].id, 'down');
    expect(movedDown[0].id).toBe(STARTER_PROMPTS[1].id);
    expect(movedDown[1].id).toBe(STARTER_PROMPTS[0].id);
    expect(movedDown.map((p) => p.order)).toEqual(STARTER_PROMPTS.map((_, idx) => idx));

    const boundary = reorderPrompts(STARTER_PROMPTS, STARTER_PROMPTS[0].id, 'up');
    expect(boundary.map((p) => p.id)).toEqual(STARTER_PROMPTS.map((p) => p.id));
  });
});

describe('Nano-first hybrid AI engine & diagnostics', () => {
  it('combines instruction and context cleanly and resolves emoji-free badges', () => {
    const combined = buildHybridPrompt('Summarize', 'Article body');
    expect(combined).toContain('Summarize');
    expect(combined).toContain('Article body');
    expect(resolveInferenceBadge(LOCAL_INFERENCE_SOURCE)).toEqual({
      kind: 'on-device',
      label: 'Gemini Nano 4 • On-Device',
    });
    expect(resolveInferenceBadge(CLOUD_INFERENCE_SOURCE)).toEqual({
      kind: 'cloud',
      label: 'Gemini Cloud • Hybrid Fallback',
    });
  });

  it('detects on-device context limit errors and transient cloud errors accurately', () => {
    expect(isOnDeviceContextLimitError(new Error('The input is too large'))).toBe(true);
    const quotaErr = new Error('Input exceeds model quota');
    quotaErr.name = 'QuotaExceededError';
    expect(isOnDeviceContextLimitError(quotaErr)).toBe(true);
    expect(isOnDeviceContextLimitError(new Error('Session destroyed'))).toBe(false);

    expect(isTransientCloudError(new Error('HTTP 503 Service Unavailable'))).toBe(true);
    expect(isTransientCloudError(new Error('Failed to parse stream (AI/parse-failed)'))).toBe(true);
    expect(isStreamParseError(new Error('Failed to parse stream (AI/parse-failed)'))).toBe(true);
    expect(isQuotaLimitError({ status: 429, message: 'RESOURCE_EXHAUSTED' })).toBe(true);
    expect(isTransientCloudError({ status: 429, message: 'RESOURCE_EXHAUSTED' })).toBe(true);
    expect(isNetworkOrOfflineError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(true);
    expect(isTransientCloudError(new Error('400 Invalid API key'))).toBe(false);
  });

  it('keeps priority cloud fallback order without gemini-3.8-flash or thinkingConfig', () => {
    expect(CLOUD_FALLBACK_MODELS).toEqual(['gemini-3.5-flash-lite', 'gemini-4-hydrogen']);
    const aiSource = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/ai.ts'), 'utf8');
    expect(aiSource).toContain('firebase/ai');
    expect(aiSource).not.toContain('gemini-3.8-flash');
    expect(aiSource).not.toContain('thinkingConfig');
  });

  it('truncates long context cleanly at sentence boundaries within 4,800 chars', () => {
    expect(LOCAL_MAX_CHARS).toBe(4800);
    expect(SAFE_ON_DEVICE_TOKEN_LIMIT).toBe(2000);

    const short = 'First sentence. Second sentence!';
    expect(truncateForLocalContext(short)).toBe(short);

    const long = `${'A'.repeat(4_770)}. Tail sentence that exceeds 4800 characters! Extra words.`;
    const truncated = truncateForLocalContext(long);
    expect(truncated.length).toBeLessThanOrEqual(LOCAL_MAX_CHARS);
    expect(truncated.endsWith('.')).toBe(true);
  });

  it('parses Chrome major version and maps LanguageModel availability states', async () => {
    expect(
      detectChromeMajorVersion('Mozilla/5.0 Chrome/139.0.0.0 Safari/537.36'),
    ).toBe(139);
    expect(detectChromeMajorVersion('Firefox/135.0')).toBeNull();

    const globalObj = globalThis as { LanguageModel?: unknown };
    const previousLanguageModel = globalObj.LanguageModel;

    try {
      delete globalObj.LanguageModel;
      expect((await diagnoseLocalAi()).status).toBe('flags-required');

      globalObj.LanguageModel = { availability: async () => 'downloadable' };
      expect((await diagnoseLocalAi()).status).toBe('downloadable');

      globalObj.LanguageModel = { availability: async () => 'downloading' };
      expect((await diagnoseLocalAi()).status).toBe('downloading');

      globalObj.LanguageModel = { availability: async () => 'available' };
      expect((await diagnoseLocalAi()).status).toBe('ready');
      expect(isLocalAvailabilityReady('readily')).toBe(true);
      expect(isLocalAvailabilityReady('available')).toBe(true);
      expect(isLocalAvailabilityReady('downloadable')).toBe(false);
    } finally {
      if (previousLanguageModel === undefined) {
        delete globalObj.LanguageModel;
      } else {
        globalObj.LanguageModel = previousLanguageModel;
      }
    }
  });

  it('prioritizes local Gemini Nano 4 in Hybrid mode when ready and within token limit', async () => {
    const createCalls: Array<Record<string, unknown>> = [];
    let cloneCalls = 0;
    const sources: string[] = [];
    const globalObj = globalThis as { LanguageModel?: unknown };
    const previousLanguageModel = globalObj.LanguageModel;
    resetWarmBaseSessionForTests();

    globalObj.LanguageModel = {
      availability: async () => 'available',
      create: async (options: Record<string, unknown> = {}) => {
        createCalls.push(options);
        return {
          clone: async () => {
            cloneCalls += 1;
            return {
              promptStreaming: () =>
                new ReadableStream<string>({
                  start(controller) {
                    controller.enqueue(`Nano #${cloneCalls}`);
                    controller.close();
                  },
                }),
              destroy: () => {},
            };
          },
          destroy: () => {},
        };
      },
    };

    try {
      expect(await prewarmLocalSession()).toBe(true);
      expect(isWarmSessionCached()).toBe(true);

      const res = await runHybridPrompt('Quick Summary', 'Short article within Nano 4 limit.', {
        onSourceChange: (s) => sources.push(s),
      });
      expect(res.inferenceSource).toBe(LOCAL_INFERENCE_SOURCE);
      expect(res.text).toBe('Nano #1');
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]).toMatchObject({
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      expect(sources).toEqual([LOCAL_INFERENCE_SOURCE]);
    } finally {
      resetWarmBaseSessionForTests();
      if (previousLanguageModel === undefined) {
        delete globalObj.LanguageModel;
      } else {
        globalObj.LanguageModel = previousLanguageModel;
      }
    }
  });

  it('never falls back to Cloud when localOnly is true and Nano 4 is unavailable', async () => {
    await expect(
      runHybridPrompt('Summarize', 'Short local article text.', { localOnly: true }),
    ).rejects.toBeInstanceOf(LocalAiSetupRequiredError);
    await expect(
      runHybridPrompt('Summarize', 'Short local article text.', { localOnly: true }),
    ).rejects.toMatchObject({
      name: 'LocalAiSetupRequiredError',
      status: 'flags-required',
      requiresSetup: true,
    });
  });

  it('recovers warmBaseSession on clone() failure and trims oversized context in Local Only mode', async () => {
    let createCount = 0;
    let staleBaseDestroys = 0;
    let promptAttempt = 0;
    const capturedPrompts: string[] = [];
    const globalObj = globalThis as { LanguageModel?: unknown };
    const previousLanguageModel = globalObj.LanguageModel;
    resetWarmBaseSessionForTests();

    globalObj.LanguageModel = {
      availability: async () => 'available',
      create: async () => {
        createCount += 1;
        if (createCount === 1) {
          return {
            clone: async () => {
              throw new Error('Session destroyed');
            },
            destroy: () => {
              staleBaseDestroys += 1;
            },
          };
        }
        return {
          clone: async () => ({
            promptStreaming: (prompt: string) => {
              capturedPrompts.push(prompt);
              promptAttempt += 1;
              if (promptAttempt === 1) {
                const quotaErr = new Error('Input exceeds model quota');
                quotaErr.name = 'QuotaExceededError';
                throw quotaErr;
              }
              return new ReadableStream<string>({
                start(controller) {
                  controller.enqueue('Compact retry succeeded.');
                  controller.close();
                },
              });
            },
            destroy: () => {},
          }),
          destroy: () => {},
        };
      },
    };

    try {
      await warmUpLocalAi();
      const longBody = `${'Local PDF paragraph text. '.repeat(260)}End.`;
      const result = await runHybridPrompt('Quick Summary', longBody, { localOnly: true });
      expect(createCount).toBe(2);
      expect(staleBaseDestroys).toBe(1);
      expect(promptAttempt).toBe(2);
      expect(capturedPrompts[1].length).toBeLessThanOrEqual(LOCAL_RETRY_MAX_CHARS + 300);
      expect(result.text).toBe('Compact retry succeeded.');
      expect(result.notice).toBe(LOCAL_TRUNCATED_NOTICE);
    } finally {
      resetWarmBaseSessionForTests();
      if (previousLanguageModel === undefined) {
        delete globalObj.LanguageModel;
      } else {
        globalObj.LanguageModel = previousLanguageModel;
      }
    }
  });

  it('cancels gracefully with AbortError when signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runHybridPrompt('Quick Summary', 'Some text.', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function buildMinimalPdfBytes(text: string): Uint8Array {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe('offline PDF extraction helpers', () => {
  it('detects PDF URLs accurately regardless of query string', () => {
    expect(isPdfUrl('file:///C:/Users/doc/report.PDF?page=2')).toBe(true);
    expect(isPdfUrl('https://example.com/paper.pdf#section')).toBe(true);
    expect(isPdfUrl('https://example.com/article.html')).toBe(false);
  });

  it('falls back to PDF_ISOLATED on empty PDF text and caps valid PDF text at 18,000 chars', () => {
    expect(() => finalizePdfExtractedText('   \n\n\t  ')).toThrowError(ContextExtractionError);
    try {
      finalizePdfExtractedText('');
    } catch (err) {
      expect(err).toBeInstanceOf(ContextExtractionError);
      expect((err as ContextExtractionError).code).toBe('PDF_ISOLATED');
    }

    const valid = finalizePdfExtractedText('  Page 1   text. \n\n\n  Page 2 text.  ');
    expect(valid).toBe('Page 1 text.\n\nPage 2 text.');

    const oversized = `${'X'.repeat(18_500)}. Tail.`;
    expect(finalizePdfExtractedText(oversized).length).toBeLessThanOrEqual(PDF_MAX_CHARS);
  });

  it('requests file://*/* host permission in manifest.json for local PDF reading', () => {
    const manifestPath = path.resolve(process.cwd(), 'public/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      host_permissions?: string[];
    };
    expect(manifest.host_permissions).toContain('file://*/*');
  });

  it('extracts text cleanly from real PDF bytes offline via pdfjs-dist', async () => {
    const pdfBytes = buildMinimalPdfBytes('Offline Gemini Nano PDF test');
    const extracted = await extractPdfTextFromBytes(pdfBytes);
    expect(extracted).toContain('Offline Gemini Nano PDF test');
  });
});
