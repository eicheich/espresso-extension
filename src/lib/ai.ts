import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
} from 'firebase/ai';
import { ai } from './firebase';

const CLOUD_FALLBACK_MODEL = 'gemini-2.5-flash';

export interface InferenceBadge {
  kind: 'on-device' | 'cloud';
  label: string;
}

export interface HybridPromptResult {
  text: string;
  inferenceSource: InferenceSource | string | undefined;
}

let cachedModel: GenerativeModel | null = null;

function getHybridModel(): GenerativeModel {
  if (!ai) {
    throw new Error(
      'Firebase is not configured. Copy .env.example to .env, add your Firebase credentials, and rebuild the extension.',
    );
  }
  if (!cachedModel) {
    cachedModel = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: CLOUD_FALLBACK_MODEL,
      },
    });
  }
  return cachedModel;
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

/**
 * Executes a prompt using hybrid inference inside a user click handler.
 */
export async function runHybridPrompt(
  instruction: string,
  contextText: string,
  onProgress?: (progress: number) => void,
): Promise<HybridPromptResult> {
  const model = getHybridModel();

  // Trigger device model initialization inside user activation; if unavailable, continue to cloud fallback.
  try {
    await model.initializeDeviceModel(onProgress);
  } catch (err) {
    console.warn('On-device model unavailable; continuing with cloud fallback:', err);
  }

  const prompt = buildHybridPrompt(instruction, contextText);
  const result = await model.generateContent(prompt);
  return {
    text: result.response.text(),
    inferenceSource: result.response.inferenceSource,
  };
}
