export interface UsageStats {
  totalShots: number;
  onDeviceShots: number;
  cloudShots: number;
  tokensSavedOnDevice: number;
}

const USAGE_STATS_KEY = 'espresso_usage_stats';

const DEFAULT_USAGE_STATS: UsageStats = {
  totalShots: 0,
  onDeviceShots: 0,
  cloudShots: 0,
  tokensSavedOnDevice: 0,
};

function sanitizeUsageStats(raw: unknown): UsageStats {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_USAGE_STATS };
  const obj = raw as Partial<UsageStats>;
  return {
    totalShots: typeof obj.totalShots === 'number' && obj.totalShots >= 0 ? obj.totalShots : 0,
    onDeviceShots:
      typeof obj.onDeviceShots === 'number' && obj.onDeviceShots >= 0 ? obj.onDeviceShots : 0,
    cloudShots: typeof obj.cloudShots === 'number' && obj.cloudShots >= 0 ? obj.cloudShots : 0,
    tokensSavedOnDevice:
      typeof obj.tokensSavedOnDevice === 'number' && obj.tokensSavedOnDevice >= 0
        ? obj.tokensSavedOnDevice
        : 0,
  };
}

export async function loadUsageStats(): Promise<UsageStats> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const stored = await chrome.storage.local.get(USAGE_STATS_KEY);
    return sanitizeUsageStats(stored[USAGE_STATS_KEY]);
  }

  const raw = localStorage.getItem(USAGE_STATS_KEY);
  if (!raw) return { ...DEFAULT_USAGE_STATS };
  try {
    return sanitizeUsageStats(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_USAGE_STATS };
  }
}

export async function recordUsageShot(isOnDevice: boolean, tokens: number): Promise<UsageStats> {
  const current = await loadUsageStats();
  const safeTokens = Math.max(0, Math.round(tokens));
  const next: UsageStats = {
    totalShots: current.totalShots + 1,
    onDeviceShots: current.onDeviceShots + (isOnDevice ? 1 : 0),
    cloudShots: current.cloudShots + (isOnDevice ? 0 : 1),
    tokensSavedOnDevice: current.tokensSavedOnDevice + (isOnDevice ? safeTokens : 0),
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [USAGE_STATS_KEY]: next });
    return next;
  }

  localStorage.setItem(USAGE_STATS_KEY, JSON.stringify(next));
  return next;
}

export function formatCompactTokens(tokens: number): string {
  const safe = Math.max(0, Math.round(tokens));
  if (safe >= 1000) {
    return `${(safe / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(safe);
}

export function formatUsageFooter(stats: UsageStats): string {
  if (stats.totalShots <= 0) return '';
  const onDevicePercentage = Math.round((stats.onDeviceShots / stats.totalShots) * 100);
  const formattedTokensSaved = formatCompactTokens(stats.tokensSavedOnDevice);
  return `☕ ${stats.totalShots} shots • ⚡ ${onDevicePercentage}% local (~${formattedTokensSaved} tokens saved)`;
}
