import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
} from 'firebase/ai';
import { estimateTokens } from './context';
import { ai } from './firebase';

const CLOUD_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
] as const;
const CLOUD_INITIAL_TIMEOUT_MS = 8_000;
const SAFE_ON_DEVICE_TOKEN_LIMIT = 3_500;

const FAST_GENERATION_CONFIG = {
  maxOutputTokens: 800,
  temperature: 0.4,
};

export interface InferenceBadge {
  kind: 'on-device' | 'cloud';
  label: string;
}

export interface HybridPromptResult {
  text: string;
  inferenceSource: InferenceSource | string | undefined;
}

export interface RunHybridPromptOptions {
  onProgress?: (progress: number) => void;
  onChunk?: (accumulatedText: string, inferenceSource?: string) => void;
}

let cachedHybridModel: GenerativeModel | null = null;
const cachedCloudModels = new Map<string, GenerativeModel>();

function requireAI() {
  if (!ai) {
    throw new Error(
      'Firebase is not configured. Copy .env.example to .env, add your Firebase credentials, and rebuild the extension.',
    );
  }
  return ai;
}

function getHybridModel(): GenerativeModel {
  if (!cachedHybridModel) {
    cachedHybridModel = getGenerativeModel(requireAI(), {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: CLOUD_FALLBACK_MODELS[0],
        generationConfig: FAST_GENERATION_CONFIG,
      },
    });
  }
  return cachedHybridModel;
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

export function isTransientCloudError(error: unknown): boolean {
  const combined = normalizeErrorText(error);
  if (!combined) return false;

  return (
    isStreamParseError(error) ||
    combined.includes('timed out') ||
    combined.includes('timeout') ||
    combined.includes('aborterror') ||
    /\b(429|500|503)\b/.test(combined) ||
    combined.includes('quota') ||
    combined.includes('rate limit') ||
    combined.includes('resource_exhausted') ||
    combined.includes('high demand') ||
    combined.includes('overloaded') ||
    combined.includes('service unavailable') ||
    combined.includes('unavailable') ||
    combined.includes('internal error')
  );
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

const DIRECT_OUTPUT_SYSTEM_INSTRUCTION =
  'Respond directly with the requested output in clean Markdown. Omit conversational filler, preambles, and meta-commentary (e.g., never start with "Here is a summary...").';

export function buildHybridPrompt(instruction: string, contextText: string): string {
  const trimmedInstruction = instruction.trim();
  const trimmedContext = contextText.trim();
  if (!trimmedContext) {
    return `${DIRECT_OUTPUT_SYSTEM_INSTRUCTION}\n\n${trimmedInstruction}`;
  }
  return `${DIRECT_OUTPUT_SYSTEM_INSTRUCTION}\n\n${trimmedInstruction}\n\n---\nWebpage Context:\n${trimmedContext}`;
}

export function resolveInferenceBadge(source: string | undefined): InferenceBadge {
  const normalized = (source ?? '').toLowerCase();
  if (normalized === InferenceSource.ON_DEVICE || normalized === 'in_device' || normalized === 'on-device') {
    return {
      kind: 'on-device',
      label: '⚡ On-Device (Gemini Nano 4 • Private)',
    };
  }
  return {
    kind: 'cloud',
    label: '☁️ Cloud Fallback (Gemini Cloud)',
  };
}

/**
 * Must ONLY be called from an explicit user click handler (never on mount).
 */
export async function warmUpLocalModel(onProgress?: (progress: number) => void): Promise<void> {
  const model = getHybridModel();
  await model.initializeDeviceModel(onProgress);
}

async function consumeStream(
  model: GenerativeModel,
  prompt: string,
  modelName: string,
  forceCloudSource: boolean,
  onChunk?: (accumulatedText: string, inferenceSource?: string) => void,
): Promise<HybridPromptResult> {
  const rawStreamPromise = model.generateContentStream(prompt);
  // Pre-attach rejection handlers so timed-out/aborted SDK streams never trigger unhandled rejections.
  void rawStreamPromise.then(
    (sr) => sr.response.catch(() => undefined),
    () => undefined,
  );

  const streamResult = await withTimeout(rawStreamPromise, CLOUD_INITIAL_TIMEOUT_MS, modelName);
  void streamResult.response.catch(() => undefined);

  const iterator = streamResult.stream[Symbol.asyncIterator]();
  let accumulatedText = '';
  let inferenceSource: InferenceSource | string | undefined = forceCloudSource
    ? InferenceSource.IN_CLOUD
    : undefined;

  try {
    let current = await withTimeout(iterator.next(), CLOUD_INITIAL_TIMEOUT_MS, modelName);
    while (!current.done) {
      const chunk = current.value;
      if (!forceCloudSource && chunk.inferenceSource) {
        inferenceSource = chunk.inferenceSource;
      }
      const delta = chunk.text();
      if (delta) {
        accumulatedText += delta;
        onChunk?.(accumulatedText, inferenceSource);
      }
      current = await iterator.next();
    }
  } catch (err) {
    void iterator.return?.(undefined).catch(() => undefined);
    throw err;
  }

  const finalResponse = await streamResult.response;
  if (!forceCloudSource && finalResponse.inferenceSource) {
    inferenceSource = finalResponse.inferenceSource;
  }

  const finalText = accumulatedText || finalResponse.text();
  if (!accumulatedText && finalText) {
    onChunk?.(finalText, inferenceSource);
  }

  return {
    text: finalText,
    inferenceSource,
  };
}

async function runCloudFallback(
  prompt: string,
  startIndex = 0,
  onChunk?: (accumulatedText: string, inferenceSource?: string) => void,
): Promise<HybridPromptResult> {
  let lastError: unknown;
  for (let i = startIndex; i < CLOUD_FALLBACK_MODELS.length; i++) {
    const modelName = CLOUD_FALLBACK_MODELS[i];
    try {
      return await consumeStream(getCloudModel(modelName), prompt, modelName, true, onChunk);
    } catch (err) {
      lastError = err;
      const hasBackup = i + 1 < CLOUD_FALLBACK_MODELS.length;
      if (hasBackup && isTransientCloudError(err)) {
        console.warn(
          `${modelName} unavailable (${err instanceof Error ? err.message : 'error'}); falling back to ${CLOUD_FALLBACK_MODELS[i + 1]}:`,
          err,
        );
        continue;
      }
      if (!hasBackup && isStreamParseError(err)) {
        break;
      }
      throw err;
    }
  }

  // Last-resort non-streaming cloud call when SSE framing fails across streaming attempts.
  if (isStreamParseError(lastError)) {
    const fallbackName = CLOUD_FALLBACK_MODELS[0];
    console.warn(`Cloud streaming parse failed; retrying non-streaming request on ${fallbackName}.`);
    const result = await withTimeout(
      getCloudModel(fallbackName).generateContent(prompt),
      CLOUD_INITIAL_TIMEOUT_MS,
      fallbackName,
    );
    const text = result.response.text();
    onChunk?.(text, InferenceSource.IN_CLOUD);
    return {
      text,
      inferenceSource: InferenceSource.IN_CLOUD,
    };
  }

  throw lastError instanceof Error ? lastError : new Error('All cloud fallback models failed.');
}

/**
 * Executes a prompt using streaming hybrid inference inside a user click handler.
 */
export async function runHybridPrompt(
  instruction: string,
  contextText: string,
  options?: RunHybridPromptOptions,
): Promise<HybridPromptResult> {
  const prompt = buildHybridPrompt(instruction, contextText);

  // Pre-check: skip on-device execution when payload exceeds safe Gemini Nano window.
  if (estimateTokens(prompt) > SAFE_ON_DEVICE_TOKEN_LIMIT) {
    return runCloudFallback(prompt, 0, options?.onChunk);
  }

  const model = getHybridModel();

  // Trigger device model initialization inside user activation; if unavailable, continue to cloud fallback.
  try {
    await model.initializeDeviceModel(options?.onProgress);
  } catch (err) {
    console.warn('On-device model unavailable; continuing with cloud fallback:', err);
  }

  try {
    return await consumeStream(model, prompt, CLOUD_FALLBACK_MODELS[0], false, options?.onChunk);
  } catch (err) {
    if (isOnDeviceContextLimitError(err)) {
      console.warn('On-device context limit exceeded; retrying via Gemini Cloud:', err);
      return runCloudFallback(prompt, 0, options?.onChunk);
    }
    if (isTransientCloudError(err)) {
      console.warn(
        `${CLOUD_FALLBACK_MODELS[0]} timed out or hit transient 500/503; switching to ${CLOUD_FALLBACK_MODELS[1]}:`,
        err,
      );
      return runCloudFallback(prompt, 1, options?.onChunk);
    }
    throw err;
  }
}
