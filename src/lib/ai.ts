import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
} from 'firebase/ai';
import { estimateTokens } from './context';
import { ai } from './firebase';

export const CLOUD_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-4-hydrogen',
] as const;
const CLOUD_INITIAL_TIMEOUT_MS = 8_000;
const FAST_GENERATION_CONFIG = {
  maxOutputTokens: 800,
  temperature: 0.4,
};

export const LOCAL_INFERENCE_SOURCE = 'on_device' as const;
export const CLOUD_INFERENCE_SOURCE = 'in_cloud' as const;
export const SAFE_ON_DEVICE_TOKEN_LIMIT = 2_000;
export const LOCAL_MAX_CHARS = 4_800;
export const LOCAL_FALLBACK_MAX_CHARS = LOCAL_MAX_CHARS;
export const LOCAL_RETRY_MAX_CHARS = 2_400;

export const LOCAL_TRUNCATED_NOTICE =
  'Analyzed the primary section (~4,800 chars) locally on Gemini Nano 4 for fast on-device speed. Tip: Highlight specific text to analyze any exact passage.';
export const LOCAL_FALLBACK_NOTICE =
  'Cloud capacity reached — summarized the primary section privately on Gemini Nano 4.';
export const OFFLINE_LOCAL_NOTICE =
  'Offline mode — summarized the primary section privately on Gemini Nano 4.';

export const BASE_SYSTEM_PROMPT =
  'Respond directly with the requested output in clean Markdown. Omit conversational filler, preambles, and meta-commentary (e.g., never start with "Here is a summary...").';

export type LocalAiDiagnosticStatus =
  | 'ready'
  | 'downloadable'
  | 'downloading'
  | 'flags-required';

export interface LocalAiDiagnostics {
  status: LocalAiDiagnosticStatus;
  rawAvailability: string;
  chromeVersion: number | null;
  supportsChromeVersion: boolean;
}

export interface InferenceBadge {
  kind: 'on-device' | 'cloud';
  label: string;
}

export interface HybridPromptResult {
  text: string;
  inferenceSource: InferenceSource | string | undefined;
  notice?: string;
}

export interface RunHybridPromptOptions {
  localOnly?: boolean;
  onProgress?: (progress: number) => void;
  onChunk?: (accumulatedText: string, inferenceSource?: string) => void;
  onSourceChange?: (inferenceSource: string) => void;
  signal?: AbortSignal;
}

export class LocalAiSetupRequiredError extends Error {
  readonly status: LocalAiDiagnosticStatus;
  readonly requiresSetup = true;

  constructor(status: LocalAiDiagnosticStatus = 'flags-required', message?: string) {
    const defaultMessage =
      status === 'downloadable'
        ? 'Gemini Nano 4 needs a quick one-time download to run locally or offline.'
        : status === 'downloading'
          ? 'Gemini Nano 4 is currently downloading in Chrome. Wait for it to finish, then try again.'
          : 'Gemini Nano 4 is not enabled in Chrome yet. Follow the quick setup guide or switch to Hybrid mode.';
    super(message ?? defaultMessage);
    this.name = 'LocalAiSetupRequiredError';
    this.status = status;
  }
}

interface NativeLanguageModelSession {
  promptStreaming: (input: string) => ReadableStream<string>;
  clone?: (options?: Record<string, unknown>) => Promise<NativeLanguageModelSession>;
  destroy?: () => void;
}

interface NativeLanguageModelAPI {
  availability?: (options?: Record<string, unknown>) => Promise<string>;
  create?: (options?: Record<string, unknown>) => Promise<NativeLanguageModelSession>;
}

const LANGUAGE_MODEL_OUTPUT_OPTIONS = {
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

let warmBaseSession: NativeLanguageModelSession | null = null;
let warmBaseSessionPromise: Promise<NativeLanguageModelSession> | null = null;
const cachedCloudModels = new Map<string, GenerativeModel>();

function getNativeLanguageModelAPI(): NativeLanguageModelAPI | undefined {
  return (globalThis as { LanguageModel?: NativeLanguageModelAPI }).LanguageModel;
}

export function resetWarmBaseSessionForTests(): void {
  try {
    warmBaseSession?.destroy?.();
  } catch {
    // ignore
  }
  warmBaseSession = null;
  warmBaseSessionPromise = null;
}

function requireAI() {
  if (!ai) {
    throw new Error(
      'Firebase is not configured for Gemini Cloud fallback. Add your .env credentials or enable Gemini Nano 4 for local AI.',
    );
  }
  return ai;
}

function getCloudModel(modelName: string): GenerativeModel {
  let model = cachedCloudModels.get(modelName);
  if (!model) {
    model = getGenerativeModel(requireAI(), {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: modelName,
        generationConfig: FAST_GENERATION_CONFIG,
      },
    });
    cachedCloudModels.set(modelName, model);
  }
  return model;
}

export function detectChromeMajorVersion(userAgent?: string): number | null {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const match = ua.match(/Chrome\/(\d+)/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isLocalAvailabilityReady(status: string | undefined): boolean {
  const normalized = (status ?? '').trim().toLowerCase();
  return normalized === 'readily' || normalized === 'available';
}

export async function getLocalModelAvailability(): Promise<string> {
  const api = getNativeLanguageModelAPI();
  if (!api?.availability) return 'no';
  try {
    return await api.availability(LANGUAGE_MODEL_OUTPUT_OPTIONS);
  } catch {
    try {
      return await api.availability();
    } catch (err) {
      console.warn('[Espresso Local AI] availability() check failed:', err);
      return 'no';
    }
  }
}

export async function diagnoseLocalAi(): Promise<LocalAiDiagnostics> {
  const chromeVersion = detectChromeMajorVersion();
  const supportsChromeVersion = chromeVersion === null || chromeVersion >= 138;
  const rawAvailability = await getLocalModelAvailability();
  const normalized = rawAvailability.trim().toLowerCase();

  let status: LocalAiDiagnosticStatus;
  if (isLocalAvailabilityReady(normalized)) {
    status = 'ready';
  } else if (normalized === 'downloadable' || normalized === 'after-download') {
    status = 'downloadable';
  } else if (normalized === 'downloading') {
    status = 'downloading';
  } else {
    status = 'flags-required';
  }

  return {
    status,
    rawAvailability,
    chromeVersion,
    supportsChromeVersion,
  };
}

function normalizeErrorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error.toLowerCase();
  const errObj = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    httpStatusCode?: unknown;
    code?: unknown;
    customErrorData?: { status?: unknown };
  };
  const name = error instanceof Error ? error.name : String(errObj.name ?? '');
  const message = error instanceof Error ? error.message : String(errObj.message ?? '');
  const status = errObj.status ?? errObj.httpStatusCode ?? errObj.customErrorData?.status ?? '';
  const code = errObj.code !== undefined ? String(errObj.code) : '';
  return `${name} ${String(status)} ${code} ${message}`.toLowerCase();
}

export function isOnDeviceContextLimitError(error: unknown): boolean {
  const combined = normalizeErrorText(error);
  if (!combined) return false;

  return (
    combined.includes('quotaexceedederror') ||
    combined.includes('input is too large') ||
    combined.includes('too large') ||
    combined.includes('context window') ||
    combined.includes('token limit') ||
    combined.includes('context length')
  );
}

export function isStreamParseError(error: unknown): boolean {
  const combined = normalizeErrorText(error);
  if (!combined) return false;

  return (
    combined.includes('parse-failed') ||
    combined.includes('failed to parse stream') ||
    combined.includes('error parsing json response')
  );
}

export function isQuotaLimitError(error: unknown): boolean {
  const combined = normalizeErrorText(error);
  if (!combined) return false;

  return (
    /\b429\b/.test(combined) ||
    combined.includes('quota') ||
    combined.includes('rate limit') ||
    combined.includes('resource_exhausted')
  );
}

export function isNetworkOrOfflineError(error: unknown): boolean {
  const combined = normalizeErrorText(error);
  if (!combined) return false;

  return (
    combined.includes('failed to fetch') ||
    combined.includes('networkerror') ||
    combined.includes('network request failed') ||
    combined.includes('err_internet_disconnected') ||
    combined.includes('load failed') ||
    combined.includes('offline')
  );
}

function isOfflineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function isTransientCloudError(error: unknown): boolean {
  const combined = normalizeErrorText(error);
  if (!combined) return false;

  return (
    isStreamParseError(error) ||
    isQuotaLimitError(error) ||
    isNetworkOrOfflineError(error) ||
    combined.includes('timed out') ||
    combined.includes('timeout') ||
    combined.includes('aborterror') ||
    /\b(500|503)\b/.test(combined) ||
    combined.includes('high demand') ||
    combined.includes('overloaded') ||
    combined.includes('service unavailable') ||
    combined.includes('unavailable') ||
    combined.includes('internal error')
  );
}

export function buildHybridPrompt(instruction: string, contextText: string): string {
  const trimmedInstruction = instruction.trim();
  const trimmedContext = contextText.trim();
  if (!trimmedContext) {
    return `${BASE_SYSTEM_PROMPT}\n\n${trimmedInstruction}`;
  }
  return `${BASE_SYSTEM_PROMPT}\n\n${trimmedInstruction}\n\n---\nContext:\n${trimmedContext}`;
}

export const buildLocalPrompt = buildHybridPrompt;

export function resolveInferenceBadge(source: string | undefined): InferenceBadge {
  const normalized = (source ?? '').toLowerCase();
  if (
    normalized === InferenceSource.ON_DEVICE ||
    normalized === 'on_device' ||
    normalized === 'in_device' ||
    normalized === 'on-device'
  ) {
    return {
      kind: 'on-device',
      label: 'Gemini Nano 4 • On-Device',
    };
  }
  return {
    kind: 'cloud',
    label: 'Gemini Cloud • Hybrid Fallback',
  };
}

export function truncateForLocalContext(
  text: string,
  maxChars = LOCAL_MAX_CHARS,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const sliced = trimmed.slice(0, maxChars);
  const lastBoundary = Math.max(
    sliced.lastIndexOf('. '),
    sliced.lastIndexOf('! '),
    sliced.lastIndexOf('? '),
  );
  if (lastBoundary > 0) {
    return sliced.slice(0, lastBoundary + 1).trim();
  }
  return sliced.trim();
}

export const truncateForLocalFallback = truncateForLocalContext;

async function createNativeBaseSession(
  onProgress?: (progress: number) => void,
): Promise<NativeLanguageModelSession> {
  const api = getNativeLanguageModelAPI();
  if (!api?.create) {
    throw new Error('Chrome LanguageModel API is unavailable.');
  }

  const monitor = onProgress
    ? (m: { addEventListener: (type: string, fn: (e: { loaded?: number }) => void) => void }) => {
        m.addEventListener('downloadprogress', (e) => {
          if (typeof e.loaded === 'number') onProgress(e.loaded);
        });
      }
    : undefined;

  try {
    return await api.create({
      systemPrompt: BASE_SYSTEM_PROMPT,
      topK: 1,
      temperature: 0.2,
      ...LANGUAGE_MODEL_OUTPUT_OPTIONS,
      ...(monitor ? { monitor } : {}),
    });
  } catch {
    try {
      return await api.create({
        initialPrompts: [{ role: 'system', content: BASE_SYSTEM_PROMPT }],
        topK: 1,
        temperature: 0.2,
        ...LANGUAGE_MODEL_OUTPUT_OPTIONS,
        ...(monitor ? { monitor } : {}),
      });
    } catch {
      return await api.create({
        initialPrompts: [{ role: 'system', content: BASE_SYSTEM_PROMPT }],
        ...(monitor ? { monitor } : {}),
      });
    }
  }
}

async function ensureWarmBaseSession(
  onProgress?: (progress: number) => void,
  forceRefresh = false,
): Promise<NativeLanguageModelSession> {
  if (forceRefresh && warmBaseSession) {
    try {
      warmBaseSession.destroy?.();
    } catch {
      // ignore
    }
    warmBaseSession = null;
    warmBaseSessionPromise = null;
  }

  if (warmBaseSession) {
    return warmBaseSession;
  }
  if (warmBaseSessionPromise) {
    return warmBaseSessionPromise;
  }

  warmBaseSessionPromise = createNativeBaseSession(onProgress)
    .then((session) => {
      warmBaseSession = session;
      warmBaseSessionPromise = null;
      return session;
    })
    .catch((err) => {
      warmBaseSessionPromise = null;
      throw err;
    });

  return warmBaseSessionPromise;
}

async function acquireClonedRunSession(
  onProgress?: (progress: number) => void,
): Promise<NativeLanguageModelSession> {
  const base = await ensureWarmBaseSession(onProgress);
  try {
    if (typeof base.clone !== 'function') {
      throw new Error('LanguageModel session clone() is unavailable.');
    }
    return await base.clone();
  } catch (cloneErr) {
    console.warn('[Espresso Local AI] warmBaseSession.clone() failed, recreating session:', cloneErr);
    warmBaseSession = null;
    warmBaseSessionPromise = null;
    try {
      base.destroy?.();
    } catch {
      // ignore
    }
    const refreshed = await ensureWarmBaseSession(onProgress, true);
    if (typeof refreshed.clone !== 'function') {
      throw new Error('LanguageModel session clone() is unavailable.');
    }
    return await refreshed.clone();
  }
}

function createAbortError(): Error {
  const err = new Error('Generation cancelled.');
  err.name = 'AbortError';
  return err;
}

async function executeClonedStream(
  instruction: string,
  contextText: string,
  options?: RunHybridPromptOptions,
): Promise<string> {
  if (options?.signal?.aborted) {
    throw createAbortError();
  }

  const runSession = await acquireClonedRunSession(options?.onProgress);
  if (options?.signal?.aborted) {
    runSession.destroy?.();
    throw createAbortError();
  }

  const userPrompt = contextText.trim()
    ? `${instruction.trim()}\n\n---\nContext:\n${contextText.trim()}`
    : instruction.trim();

  let accumulatedText = '';
  const stream = runSession.promptStreaming(userPrompt);
  const reader = stream.getReader();

  const handleAbort = () => {
    void reader.cancel().catch(() => undefined);
    try {
      runSession.destroy?.();
    } catch {
      // ignore
    }
  };

  options?.signal?.addEventListener('abort', handleAbort, { once: true });

  try {
    while (true) {
      if (options?.signal?.aborted) {
        throw createAbortError();
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (accumulatedText && value.startsWith(accumulatedText)) {
        accumulatedText = value;
      } else {
        accumulatedText += value;
      }
      options?.onChunk?.(accumulatedText, LOCAL_INFERENCE_SOURCE);
    }
    return accumulatedText;
  } finally {
    options?.signal?.removeEventListener('abort', handleAbort);
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    try {
      runSession.destroy?.();
    } catch {
      // ignore
    }
  }
}

async function runNativeLocalAttempt(
  instruction: string,
  contextText: string,
  options?: RunHybridPromptOptions,
  forceTrim = false,
): Promise<HybridPromptResult> {
  options?.onSourceChange?.(LOCAL_INFERENCE_SOURCE);

  const trimmedContext = contextText.trim();
  const shouldTrim = forceTrim || trimmedContext.length > LOCAL_MAX_CHARS;
  const initialContext = shouldTrim
    ? truncateForLocalContext(trimmedContext, LOCAL_MAX_CHARS)
    : trimmedContext;

  try {
    const text = await executeClonedStream(instruction, initialContext, options);
    return {
      text,
      inferenceSource: LOCAL_INFERENCE_SOURCE,
      ...(shouldTrim ? { notice: LOCAL_TRUNCATED_NOTICE } : {}),
    };
  } catch (err) {
    if (options?.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw err;
    }
    if (isOnDeviceContextLimitError(err) && initialContext.length > LOCAL_RETRY_MAX_CHARS) {
      const compactContext = truncateForLocalContext(trimmedContext, LOCAL_RETRY_MAX_CHARS);
      const text = await executeClonedStream(instruction, compactContext, options);
      return {
        text,
        inferenceSource: LOCAL_INFERENCE_SOURCE,
        notice: LOCAL_TRUNCATED_NOTICE,
      };
    }
    throw err;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, modelName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Request to ${modelName} timed out after ${ms / 1000}s.`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function consumeCloudStream(
  model: GenerativeModel,
  prompt: string,
  modelName: string,
  options?: RunHybridPromptOptions,
): Promise<HybridPromptResult> {
  if (options?.signal?.aborted) {
    throw createAbortError();
  }

  options?.onSourceChange?.(CLOUD_INFERENCE_SOURCE);

  const rawStreamPromise = model.generateContentStream(prompt);
  // Pre-attach rejection handlers so timed-out/aborted SDK streams never trigger unhandled rejections.
  void rawStreamPromise.then(
    (sr) => sr.response.catch(() => undefined),
    () => undefined,
  );

  const streamResult = await withTimeout(rawStreamPromise, CLOUD_INITIAL_TIMEOUT_MS, modelName);
  void streamResult.response.catch(() => undefined);

  const iterator = streamResult.stream[Symbol.asyncIterator]();
  const handleAbort = () => {
    void iterator.return?.(undefined).catch(() => undefined);
  };
  options?.signal?.addEventListener('abort', handleAbort, { once: true });

  let accumulatedText = '';
  try {
    let current = await withTimeout(iterator.next(), CLOUD_INITIAL_TIMEOUT_MS, modelName);
    while (!current.done) {
      if (options?.signal?.aborted) {
        throw createAbortError();
      }
      const delta = current.value.text();
      if (delta) {
        accumulatedText += delta;
        options?.onChunk?.(accumulatedText, CLOUD_INFERENCE_SOURCE);
      }
      current = await iterator.next();
    }
  } catch (err) {
    void iterator.return?.(undefined).catch(() => undefined);
    throw err;
  } finally {
    options?.signal?.removeEventListener('abort', handleAbort);
  }

  const finalResponse = await streamResult.response;
  const finalText = accumulatedText || finalResponse.text();
  if (!accumulatedText && finalText) {
    options?.onChunk?.(finalText, CLOUD_INFERENCE_SOURCE);
  }

  return {
    text: finalText,
    inferenceSource: CLOUD_INFERENCE_SOURCE,
  };
}

async function runCloudFallback(
  instruction: string,
  contextText: string,
  diagnostics: LocalAiDiagnostics,
  options?: RunHybridPromptOptions,
): Promise<HybridPromptResult> {
  const prompt = buildHybridPrompt(instruction, contextText);
  const errors: unknown[] = [];
  let lastError: unknown;

  for (const modelName of CLOUD_FALLBACK_MODELS) {
    if (options?.signal?.aborted) {
      throw createAbortError();
    }
    try {
      return await consumeCloudStream(getCloudModel(modelName), prompt, modelName, options);
    } catch (err) {
      if (options?.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw err;
      }
      console.warn(`Model ${modelName} failed:`, err);
      errors.push(err);
      lastError = err;
    }
  }

  // Last-resort non-streaming cloud call when SSE framing fails across streaming attempts.
  if (isStreamParseError(lastError)) {
    const fallbackName = CLOUD_FALLBACK_MODELS[0];
    try {
      options?.onSourceChange?.(CLOUD_INFERENCE_SOURCE);
      const result = await withTimeout(
        getCloudModel(fallbackName).generateContent(prompt),
        CLOUD_INITIAL_TIMEOUT_MS,
        fallbackName,
      );
      const text = result.response.text();
      options?.onChunk?.(text, CLOUD_INFERENCE_SOURCE);
      return {
        text,
        inferenceSource: CLOUD_INFERENCE_SOURCE,
      };
    } catch (err) {
      console.warn(`Model ${fallbackName} non-streaming fallback failed:`, err);
      errors.push(err);
      lastError = err;
    }
  }

  // Smart Local Fallback when Cloud hits 429 quota or device is offline.
  const offlineOrNetwork = isOfflineNow() || errors.some(isNetworkOrOfflineError);
  if (offlineOrNetwork || errors.some(isQuotaLimitError)) {
    if (diagnostics.status === 'ready') {
      try {
        const localResult = await runNativeLocalAttempt(instruction, contextText, options, true);
        return {
          ...localResult,
          notice: offlineOrNetwork ? OFFLINE_LOCAL_NOTICE : LOCAL_FALLBACK_NOTICE,
        };
      } catch (localErr) {
        if (options?.signal?.aborted || (localErr instanceof Error && localErr.name === 'AbortError')) {
          throw localErr;
        }
        console.warn('[Espresso Local AI]', localErr);
      }
    }
    throw new LocalAiSetupRequiredError(
      diagnostics.status,
      offlineOrNetwork
        ? 'You appear to be offline and Gemini Nano 4 is not active yet. Enable Nano 4 in Chrome Setup to run offline.'
        : 'Cloud daily quota reached and Gemini Nano 4 is not active yet. Enable Nano 4 in Chrome Setup to continue privately.',
    );
  }

  throw lastError instanceof Error ? lastError : new Error('All cloud fallback models failed.');
}

/**
 * Must ONLY be called from an explicit user click handler (never on mount).
 */
export async function warmUpLocalModel(onProgress?: (progress: number) => void): Promise<boolean> {
  const api = getNativeLanguageModelAPI();
  if (!api?.create) {
    return false;
  }
  await ensureWarmBaseSession(onProgress, true);
  return isLocalAvailabilityReady(await getLocalModelAvailability());
}

export const warmUpLocalAi = warmUpLocalModel;

export function isWarmSessionCached(): boolean {
  return warmBaseSession !== null;
}

/**
 * Silently pre-warms the local Gemini Nano 4 base session when already available on disk.
 */
export async function prewarmLocalSession(): Promise<boolean> {
  const diagnostics = await diagnoseLocalAi();
  if (diagnostics.status !== 'ready') return false;
  await ensureWarmBaseSession();
  return true;
}

/**
 * Nano-First Hybrid execution: prioritizes Gemini Nano 4 on-device,
 * falling back seamlessly to Gemini Cloud via Firebase AI Logic when needed.
 */
export async function runHybridPrompt(
  instruction: string,
  contextText: string,
  options?: RunHybridPromptOptions,
): Promise<HybridPromptResult> {
  if (options?.signal?.aborted) {
    throw createAbortError();
  }

  const diagnostics = await diagnoseLocalAi();
  const localReady = diagnostics.status === 'ready';
  const prompt = buildHybridPrompt(instruction, contextText);
  const fitsLocal = estimateTokens(prompt) <= SAFE_ON_DEVICE_TOKEN_LIMIT;

  // Tier 1: Forced Local-Only or Offline execution (never sends data to Cloud).
  if (options?.localOnly || isOfflineNow()) {
    if (!localReady) {
      throw new LocalAiSetupRequiredError(diagnostics.status);
    }
    const result = await runNativeLocalAttempt(instruction, contextText, options, !fitsLocal);
    if (!fitsLocal && !result.notice) {
      return { ...result, notice: LOCAL_TRUNCATED_NOTICE };
    }
    return result;
  }

  // Tier 2: Primary On-Device Gemini Nano 4 path in Hybrid mode.
  if (localReady && fitsLocal) {
    try {
      return await runNativeLocalAttempt(instruction, contextText, options, false);
    } catch (err) {
      if (options?.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw err;
      }
      console.warn('[Espresso Local AI] Falling back to Gemini Cloud:', err);
    }
  }

  // Tier 3: Seamless Gemini Cloud fallback (long pages/PDFs, Nano not enabled, or local runtime error).
  return runCloudFallback(instruction, contextText, diagnostics, options);
}

export const runLocalPrompt = runHybridPrompt;
