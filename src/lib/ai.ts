import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
} from 'firebase/ai';
import { estimateTokens } from './context';
import { ai } from './firebase';

const CLOUD_FALLBACK_MODEL = 'gemini-2.5-flash';
const SAFE_ON_DEVICE_TOKEN_LIMIT = 9000;

export interface InferenceBadge {
  kind: 'on-device' | 'cloud';
  label: string;
}

export interface HybridPromptResult {
  text: string;
  inferenceSource: InferenceSource | string | undefined;
}

let cachedHybridModel: GenerativeModel | null = null;
let cachedCloudModel: GenerativeModel | null = null;

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
        model: CLOUD_FALLBACK_MODEL,
      },
    });
  }
  return cachedHybridModel;
}

function getCloudFallbackModel(): GenerativeModel {
  if (!cachedCloudModel) {
    cachedCloudModel = getGenerativeModel(requireAI(), {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: CLOUD_FALLBACK_MODEL,
      },
    });
  }
  return cachedCloudModel;
}

export function isOnDeviceContextLimitError(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : String((error as { name?: unknown }).name ?? '');
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String((error as { message?: unknown }).message ?? '');
  const combined = `${name} ${message}`.toLowerCase();

  return (
    combined.includes('quotaexceedederror') ||
    combined.includes('input is too large') ||
    combined.includes('too large') ||
    combined.includes('context window') ||
    combined.includes('token limit') ||
    combined.includes('context length')
  );
}

export function buildHybridPrompt(instruction: string, contextText: string): string {
  const trimmedInstruction = instruction.trim();
  const trimmedContext = contextText.trim();
  if (!trimmedContext) {
    return trimmedInstruction;
  }
  return `${trimmedInstruction}\n\n---\nWebpage Context:\n${trimmedContext}`;
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

async function runCloudFallback(prompt: string): Promise<HybridPromptResult> {
  const cloudResult = await getCloudFallbackModel().generateContent(prompt);
  return {
    text: cloudResult.response.text(),
    inferenceSource: InferenceSource.IN_CLOUD,
  };
}

/**
 * Executes a prompt using hybrid inference inside a user click handler.
 */
export async function runHybridPrompt(
  instruction: string,
  contextText: string,
  onProgress?: (progress: number) => void,
): Promise<HybridPromptResult> {
  const prompt = buildHybridPrompt(instruction, contextText);

  // Pre-check: skip on-device execution when payload exceeds safe Gemini Nano window.
  if (estimateTokens(prompt) > SAFE_ON_DEVICE_TOKEN_LIMIT) {
    return runCloudFallback(prompt);
  }

  const model = getHybridModel();

  // Trigger device model initialization inside user activation; if unavailable, continue to cloud fallback.
  try {
    await model.initializeDeviceModel(onProgress);
  } catch (err) {
    console.warn('On-device model unavailable; continuing with cloud fallback:', err);
  }

  try {
    const result = await model.generateContent(prompt);
    return {
      text: result.response.text(),
      inferenceSource: result.response.inferenceSource,
    };
  } catch (err) {
    if (isOnDeviceContextLimitError(err)) {
      console.warn('On-device context limit exceeded; retrying via Gemini Cloud:', err);
      return runCloudFallback(prompt);
    }
    throw err;
  }
}
