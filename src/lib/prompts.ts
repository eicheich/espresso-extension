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
    id: 'starter-tldr',
    title: 'Quick Summary',
    category: 'Summary',
    instruction:
      'Summarize the provided text into 5 concise, high-signal bullet points. Lead with the core thesis and include only essential facts or numbers.',
    order: 0,
    updatedAt: 1,
  },
  {
    id: 'starter-takeaways',
    title: 'Key Takeaways',
    category: 'Insights',
    instruction:
      'Extract the most actionable takeaways, key decisions, and open questions from this content. Group them cleanly under short Markdown headings.',
    order: 1,
    updatedAt: 1,
  },
  {
    id: 'starter-eli5',
    title: 'Explain Simply',
    category: 'Learning',
    instruction:
      'Explain the main concepts in plain, jargon-free English as if explaining to a curious beginner. Use one concrete everyday analogy.',
    order: 2,
    updatedAt: 1,
  },
  {
    id: 'starter-tech-docs',
    title: 'Technical Breakdown',
    category: 'Engineering',
    instruction:
      'Break down this technical content for a software engineer: state the purpose, architecture or API surface, prerequisites, gotchas, and a minimal usage example if applicable.',
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
