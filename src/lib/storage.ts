const PINNED_PROMPT_IDS_KEY = 'espresso_pinned_prompt_ids';
const LOCAL_ONLY_MODE_KEY = 'espresso_local_only_mode';

async function readLocalSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(key);
      return result?.[key] !== undefined ? (result[key] as T) : fallback;
    }
    const raw = localStorage.getItem(key);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeLocalSetting<T>(key: string, value: T): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

export async function loadPinnedPromptIds(): Promise<string[]> {
  const stored = await readLocalSetting<unknown>(PINNED_PROMPT_IDS_KEY, []);
  if (!Array.isArray(stored)) return [];
  return Array.from(
    new Set(stored.filter((id): id is string => typeof id === 'string' && id.length > 0)),
  );
}

export async function savePinnedPromptIds(ids: string[]): Promise<void> {
  const uniqueIds = Array.from(
    new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)),
  );
  await writeLocalSetting(PINNED_PROMPT_IDS_KEY, uniqueIds);
}

export async function loadLocalOnlyMode(): Promise<boolean> {
  const stored = await readLocalSetting<unknown>(LOCAL_ONLY_MODE_KEY, false);
  return stored === true;
}

export async function saveLocalOnlyMode(enabled: boolean): Promise<void> {
  await writeLocalSetting(LOCAL_ONLY_MODE_KEY, Boolean(enabled));
}
