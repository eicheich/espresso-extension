export interface PromptItem {
  id: string;
  title: string;
  instruction: string;
  category?: string;
  order: number;
  updatedAt: number;
}

const STORAGE_KEY = 'lazy_prompt_items';

export const STARTER_PROMPTS: PromptItem[] = [
  {
    id: 'starter-quick-summary',
    title: 'Quick Summary',
    category: 'Summary',
    instruction:
      'Summarize the provided text in up to 5 crisp bullets (max 15 words each). Lead with the main claim and include only facts, numbers, and names directly stated in the text.',
    order: 0,
    updatedAt: 1,
  },
  {
    id: 'starter-key-takeaways',
    title: 'Key Takeaways',
    category: 'Insights',
    instruction:
      'Extract up to 5 actionable takeaways and concrete decisions explicitly supported by the provided text. Output concise Markdown bullets under 2 short headings max.',
    order: 1,
    updatedAt: 1,
  },
  {
    id: 'starter-explain-simply',
    title: "Explain Like I'm 5",
    category: 'Learning',
    instruction:
      "Explain this concept as if I'm 5 years old. Use simple language, relatable analogies, and everyday examples. Break complex ideas into small, easy-to-understand steps. Focus on what it is, why it matters, and how it works. Avoid unnecessary jargon without sacrificing accuracy or losing the core meaning.",
    order: 2,
    updatedAt: 1,
  },
  {
    id: 'starter-code-docs',
    title: 'Code & Docs Breakdown',
    category: 'Engineering',
    instruction:
      'Break down this technical text strictly from the source: **Purpose**, **API / Components**, **Usage Pattern** (short snippet only if in text), and **Constraints**. Keep each item compact.',
    order: 3,
    updatedAt: 1,
  },
];

export function isBuiltInPrompt(prompt: PromptItem): boolean {
  return prompt.id.startsWith('starter-');
}

export function sortPrompts(items: PromptItem[]): PromptItem[] {
  return [...items].sort((a, b) => a.order - b.order || a.updatedAt - b.updatedAt);
}

export function reorderPrompts(
  items: PromptItem[],
  id: string,
  direction: 'up' | 'down',
): PromptItem[] {
  const ordered = sortPrompts(items);
  const index = ordered.findIndex((item) => item.id === id);
  if (index === -1) return ordered;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) return ordered;

  const next = [...ordered];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  const now = Date.now();
  return next.map((item, idx) => ({
    ...item,
    order: idx,
    updatedAt: idx === index || idx === targetIndex ? now : item.updatedAt,
  }));
}

export async function loadLocalPrompts(): Promise<PromptItem[]> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const existing = stored[STORAGE_KEY] as PromptItem[] | undefined;
    if (Array.isArray(existing)) {
      return sortPrompts(existing);
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: STARTER_PROMPTS });
    return STARTER_PROMPTS;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== null) {
    try {
      return sortPrompts(JSON.parse(raw) as PromptItem[]);
    } catch {
      return STARTER_PROMPTS;
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(STARTER_PROMPTS));
  return STARTER_PROMPTS;
}

export async function saveLocalPrompts(items: PromptItem[]): Promise<void> {
  const normalized = sortPrompts(items).map((item, idx) => ({ ...item, order: idx }));
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}
