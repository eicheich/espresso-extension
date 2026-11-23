import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileText,
  FolderLock,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { isFirebaseConfigured } from './lib/firebase';
import {
  buildHybridPrompt,
  LocalAiWarmupRequiredError,
  resolveInferenceBadge,
  runHybridPrompt,
  warmUpLocalModel,
} from './lib/ai';
import {
  ContextExtractionError,
  estimateTokens,
  extractActiveTabContext,
  getTokenStatus,
  NANO_TOKEN_LIMIT,
  type ContextErrorCode,
  type PageContext,
} from './lib/context';
import {
  isBuiltInPrompt,
  loadLocalPrompts,
  reorderPrompts,
  saveLocalPrompts,
  sortPrompts,
  STARTER_PROMPTS,
  type PromptItem,
} from './lib/prompts';
import {
  formatUsageFooter,
  loadUsageStats,
  recordUsageShot,
  type UsageStats,
} from './lib/storage';
import {
  deleteCloudPrompt,
  saveAllCloudPrompts,
  subscribeToAuth,
  syncPromptsOnSignIn,
  upsertCloudPrompt,
} from './lib/sync';
import { AuthModal } from './components/AuthModal';
import { OutputCard } from './components/OutputCard';
import { PromptFormModal } from './components/PromptFormModal';

type LocalAiStatus = 'idle' | 'warming' | 'ready' | 'fallback';
type AppView = 'prompts' | 'results';
type LibraryTab = 'discover' | 'my-prompts';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('prompts');
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('discover');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [context, setContext] = useState<PageContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextErrorCode, setContextErrorCode] = useState<ContextErrorCode | null>(null);
  const [refreshingContext, setRefreshingContext] = useState(false);

  const [activePromptTokens, setActivePromptTokens] = useState<number | null>(null);
  const [localAiStatus, setLocalAiStatus] = useState<LocalAiStatus>('idle');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  const [runningPromptId, setRunningPromptId] = useState<string | null>(null);
  const [outputState, setOutputState] = useState<{
    prompt: PromptItem;
    isRunning: boolean;
    outputText: string;
    inferenceSource: string | undefined;
    notice: string | null;
    needsLocalWarmup: boolean;
    elapsedMs: number | null;
    error: string | null;
  } | null>(null);

  const runStartRef = useRef<number | null>(null);
  const [liveElapsedMs, setLiveElapsedMs] = useState<number | null>(null);

  const targetTextRef = useRef('');
  const displayedLenRef = useRef(0);
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    const target = outputState?.outputText ?? '';
    targetTextRef.current = target;

    if (!outputState || outputState.error || !target) {
      displayedLenRef.current = 0;
      setDisplayedText('');
      return;
    }

    if (displayedLenRef.current >= target.length) {
      return;
    }

    let rafId = 0;
    const tick = () => {
      const currentTarget = targetTextRef.current;
      const prevLen = displayedLenRef.current;
      if (prevLen >= currentTarget.length) {
        return;
      }
      const step = Math.max(2, Math.ceil((currentTarget.length - prevLen) / 8));
      const nextLen = Math.min(currentTarget.length, prevLen + step);
      displayedLenRef.current = nextLen;
      setDisplayedText(currentTarget.slice(0, nextLen));
      if (nextLen < currentTarget.length) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [outputState?.outputText, outputState?.isRunning, outputState?.error]);

  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshContext = useCallback(async (): Promise<PageContext | null> => {
    setRefreshingContext(true);
    setContextError(null);
    setContextErrorCode(null);
    try {
      const next = await extractActiveTabContext();
      setContext(next);
      return next;
    } catch (err) {
      setContext(null);
      setContextError(err instanceof Error ? err.message : 'Unable to read active webpage.');
      setContextErrorCode(err instanceof ContextExtractionError ? err.code : 'UNAVAILABLE');
      return null;
    } finally {
      setRefreshingContext(false);
    }
  }, []);

  const handleOpenExtensionSettings = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.id) {
      void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    }
  };

  useEffect(() => {
    void loadLocalPrompts().then(setPrompts);
    void loadUsageStats().then(setUsageStats);
    void refreshContext();
  }, [refreshContext]);

  const performCloudSync = useCallback(async (uid: string, localList: PromptItem[]) => {
    setIsSyncing(true);
    try {
      const merged = await syncPromptsOnSignIn(uid, localList);
      setPrompts(merged);
      await saveLocalPrompts(merged);
    } catch (err) {
      console.error('Cloud sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        void loadLocalPrompts().then((localList) => performCloudSync(nextUser.uid, localList));
      }
    });
    return unsubscribe;
  }, [performCloudSync]);

  const handleWarmUpLocalAi = async () => {
    setLocalAiStatus('warming');
    setDownloadProgress(0);
    try {
      await warmUpLocalModel((progress) => setDownloadProgress(progress));
      setLocalAiStatus('ready');
    } catch {
      setLocalAiStatus('fallback');
    } finally {
      setDownloadProgress(null);
    }
  };

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage((prev) => (prev === message ? null : prev));
    }, 2600);
  }, []);

  const handleRunPrompt = async (prompt: PromptItem) => {
    if (runningPromptId !== null) return;

    const startTime = performance.now();
    runStartRef.current = startTime;
    setLiveElapsedMs(0);
    setRunningPromptId(prompt.id);
    setDownloadProgress(null);
    setActiveView('results');
    targetTextRef.current = '';
    displayedLenRef.current = 0;
    setDisplayedText('');
    setOutputState({
      prompt,
      isRunning: true,
      outputText: '',
      inferenceSource: undefined,
      notice: null,
      needsLocalWarmup: false,
      elapsedMs: null,
      error: null,
    });

    try {
      const freshContext = await refreshContext();
      if (!freshContext) {
        throw new Error('Could not extract readable text from the active tab.');
      }

      const combinedTokens = estimateTokens(
        buildHybridPrompt(prompt.instruction, freshContext.text),
      );
      setActivePromptTokens(combinedTokens);

      const result = await runHybridPrompt(prompt.instruction, freshContext.text, {
        onProgress: (progress) => setDownloadProgress(progress),
        onChunk: (accumulatedText, inferenceSource) => {
          targetTextRef.current = accumulatedText;
          setOutputState((prev) =>
            prev
              ? {
                  ...prev,
                  outputText: accumulatedText,
                  inferenceSource: inferenceSource ?? prev.inferenceSource,
                }
              : prev,
          );
        },
      });

      const finalElapsedMs = performance.now() - startTime;
      const isOnDevice = resolveInferenceBadge(result.inferenceSource).kind === 'on-device';
      void recordUsageShot(isOnDevice, combinedTokens).then(setUsageStats);

      targetTextRef.current = result.text;
      setOutputState({
        prompt,
        isRunning: false,
        outputText: result.text,
        inferenceSource: result.inferenceSource,
        notice: result.notice ?? null,
        needsLocalWarmup: false,
        elapsedMs: finalElapsedMs,
        error: null,
      });
    } catch (err) {
      setOutputState({
        prompt,
        isRunning: false,
        outputText: '',
        inferenceSource: undefined,
        notice: null,
        needsLocalWarmup: err instanceof LocalAiWarmupRequiredError,
        elapsedMs: null,
        error: err instanceof Error ? err.message : 'Inference failed. Please try again.',
      });
    } finally {
      setRunningPromptId(null);
      setDownloadProgress(null);
      setActivePromptTokens(null);
    }
  };

  const handleSavePrompt = async (values: {
    title: string;
    category: string;
    instruction: string;
  }) => {
    const now = Date.now();
    let updatedItem: PromptItem;
    let nextList: PromptItem[];

    if (editingPrompt) {
      updatedItem = {
        ...editingPrompt,
        title: values.title,
        category: values.category || undefined,
        instruction: values.instruction,
        updatedAt: now,
      };
      nextList = prompts.map((item) => (item.id === editingPrompt.id ? updatedItem : item));
    } else {
      updatedItem = {
        id: crypto.randomUUID(),
        title: values.title,
        category: values.category || undefined,
        instruction: values.instruction,
        order: prompts.length,
        updatedAt: now,
      };
      nextList = sortPrompts([...prompts, updatedItem]);
    }

    const isEditing = Boolean(editingPrompt);
    setPrompts(nextList);
    setShowCreateModal(false);
    setEditingPrompt(null);
    if (!isEditing) {
      setLibraryTab('my-prompts');
      setSelectedCategory('All');
      setSearchQuery('');
      setActiveView('prompts');
    }
    showToast(isEditing ? 'Prompt updated' : 'Prompt saved to My Prompts');
    await saveLocalPrompts(nextList);

    if (user) {
      void upsertCloudPrompt(user.uid, updatedItem);
    }
  };

  const handleDeletePrompt = async (promptId: string) => {
    const nextList = prompts
      .filter((item) => item.id !== promptId)
      .map((item, idx) => ({ ...item, order: idx }));
    setPrompts(nextList);
    showToast('Prompt deleted');
    await saveLocalPrompts(nextList);
    if (user) {
      void deleteCloudPrompt(user.uid, promptId);
    }
  };

  const handleReorder = async (promptId: string, direction: 'up' | 'down') => {
    const builtInStored = prompts.filter(isBuiltInPrompt);
    const customStored = prompts.filter((item) => !isBuiltInPrompt(item));
    const reorderedCustom = reorderPrompts(customStored, promptId, direction);
    const nextList = [...builtInStored, ...reorderedCustom].map((item, idx) => ({
      ...item,
      order: idx,
    }));
    setPrompts(nextList);
    await saveLocalPrompts(nextList);
    if (user) {
      void saveAllCloudPrompts(user.uid, nextList);
    }
  };

  const customPrompts = useMemo(
    () => sortPrompts(prompts.filter((item) => !isBuiltInPrompt(item))),
    [prompts],
  );
  const activeTabPrompts = libraryTab === 'discover' ? STARTER_PROMPTS : customPrompts;
  const availableCategories = useMemo(() => {
    const unique = new Set<string>();
    for (const item of activeTabPrompts) {
      if (item.category?.trim()) unique.add(item.category.trim());
    }
    return ['All', ...unique];
  }, [activeTabPrompts]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isFiltered = Boolean(normalizedQuery || selectedCategory !== 'All');
  const filteredPrompts = useMemo(
    () =>
      activeTabPrompts.filter((item) => {
        const matchesCategory =
          selectedCategory === 'All' || item.category?.trim() === selectedCategory;
        if (!matchesCategory) return false;
        if (!normalizedQuery) return true;
        return (
          item.title.toLowerCase().includes(normalizedQuery) ||
          item.instruction.toLowerCase().includes(normalizedQuery) ||
          (item.category?.toLowerCase().includes(normalizedQuery) ?? false)
        );
      }),
    [activeTabPrompts, normalizedQuery, selectedCategory],
  );

  const displayedTokens = activePromptTokens ?? context?.tokens ?? 0;
  const tokenStatus = getTokenStatus(displayedTokens);
  const isOutputStreaming = Boolean(
    outputState &&
      !outputState.error &&
      (outputState.isRunning || displayedText.length < outputState.outputText.length),
  );

  useEffect(() => {
    if (!isOutputStreaming || runStartRef.current === null) return;
    const startTime = runStartRef.current;
    const interval = setInterval(() => {
      setLiveElapsedMs(performance.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [isOutputStreaming]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col gap-3 px-3.5 py-3.5">
      {/* Header */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <img
            src="/icons/icon-48.png"
            alt="Espresso logo"
            className="h-8 w-8 rounded-xl bg-white object-contain p-0.5 shadow-xs ring-1 ring-black/6"
          />
          <div>
            <h1 className="text-[15px] font-semibold leading-tight tracking-tight text-[#1D1D1F]">
              Espresso
            </h1>
            <p className="text-[11px] text-neutral-500">Your prompts, one click away</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleWarmUpLocalAi()}
            disabled={localAiStatus === 'warming'}
            title="Enable private on-device AI (Chrome Gemini Nano, falls back to Gemini Cloud when needed)"
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition ${
              localAiStatus === 'ready'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : localAiStatus === 'fallback'
                  ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
                  : 'bg-white text-[#1D1D1F] ring-1 ring-black/8 hover:bg-neutral-50'
            }`}
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>
              {localAiStatus === 'warming'
                ? downloadProgress !== null
                  ? `Preparing ${Math.round(downloadProgress * 100)}%`
                  : 'Preparing...'
                : localAiStatus === 'ready'
                  ? 'Private AI Ready'
                  : localAiStatus === 'fallback'
                    ? 'Cloud AI Active'
                    : 'Enable Private AI'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            aria-label={user ? `Account & Prompt Sync: ${user.email}` : 'Sign in for Prompt Sync'}
            title={user ? `Synced: ${user.email}` : 'Account & Prompt Sync'}
            className={`inline-flex items-center gap-1.5 rounded-full text-[11px] font-medium ring-1 transition ${
              user
                ? 'relative h-7 w-7 justify-center bg-[#0071E3]/10 text-[#0071E3] ring-[#0071E3]/30'
                : 'bg-white px-2.5 py-1.5 text-[#1D1D1F] ring-black/8 hover:bg-neutral-50'
            }`}
          >
            {user ? (
              <>
                <span className="text-[11px] font-semibold uppercase">
                  {(user.email?.[0] ?? 'U').toUpperCase()}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-[#F5F5F7]"
                />
              </>
            ) : (
              <>
                <UserIcon className="h-3.5 w-3.5 text-neutral-600" />
                <span>Sign in</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Primary View Switcher: Prompts | Results */}
      <nav
        aria-label="Main view"
        className="grid grid-cols-2 rounded-xl bg-black/5 p-1"
      >
        <button
          type="button"
          onClick={() => setActiveView('prompts')}
          className={`rounded-lg py-1.5 text-[12px] font-medium transition ${
            activeView === 'prompts'
              ? 'bg-white text-[#1D1D1F] shadow-xs'
              : 'text-neutral-600 hover:text-[#1D1D1F]'
          }`}
        >
          Prompts
        </button>
        <button
          type="button"
          onClick={() => setActiveView('results')}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-medium transition ${
            activeView === 'results'
              ? 'bg-white text-[#1D1D1F] shadow-xs'
              : 'text-neutral-600 hover:text-[#1D1D1F]'
          }`}
        >
          <span>Results</span>
          {outputState && (
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isOutputStreaming
                  ? 'animate-pulse bg-[#0071E3]'
                  : outputState.error
                    ? 'bg-red-500'
                    : 'bg-emerald-500'
              }`}
            />
          )}
        </button>
      </nav>

      {toastMessage && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>{toastMessage}</span>
        </div>
      )}

      {!isFirebaseConfigured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          Firebase is not configured yet. Add your <code className="font-mono">.env</code> keys and rebuild to enable AI execution and Cloud Sync.
        </div>
      )}

      {activeView === 'results' ? (
        outputState ? (
          <OutputCard
            promptTitle={outputState.prompt.title}
            pageTitle={context?.pageTitle}
            isRunning={isOutputStreaming}
            downloadProgress={downloadProgress}
            outputText={displayedText}
            inferenceSource={outputState.inferenceSource}
            notice={outputState.notice}
            needsLocalWarmup={outputState.needsLocalWarmup}
            isWarmingLocalAi={localAiStatus === 'warming'}
            elapsedMs={outputState.elapsedMs ?? liveElapsedMs}
            error={outputState.error}
            onWarmUpLocalAi={() => void handleWarmUpLocalAi()}
            onRegenerate={() => void handleRunPrompt(outputState.prompt)}
            onBack={() => setActiveView('prompts')}
          />
        ) : (
          <section className="rounded-2xl border border-dashed border-black/12 bg-white/80 p-6 text-center">
            <Sparkles className="mx-auto h-5 w-5 text-neutral-400" />
            <p className="mt-2 text-[13px] font-medium text-[#1D1D1F]">No results yet</p>
            <p className="mt-1 text-[11.5px] text-neutral-500">
              Run any prompt on the current webpage to view its answer here.
            </p>
            <button
              type="button"
              onClick={() => setActiveView('prompts')}
              className="mt-3 rounded-full bg-[#0071E3] px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#0077ED]"
            >
              Browse Prompts
            </button>
          </section>
        )
      ) : (
        <>
          {/* Webpage Context Card */}
          <section className="rounded-2xl border border-black/8 bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  context?.source === 'selection'
                    ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                    : 'bg-[#F5F5F7] text-neutral-700 ring-1 ring-black/6'
                }`}
              >
                <FileText className="h-3 w-3" />
                <span>
                  {context?.source === 'selection'
                    ? 'Running on selected text'
                    : 'Running on this page'}
                </span>
              </span>

              <button
                type="button"
                onClick={() => void refreshContext()}
                disabled={refreshingContext}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-[#0071E3] transition hover:bg-[#0071E3]/8 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${refreshingContext ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            <p className="mt-1.5 truncate text-[12.5px] font-medium text-[#1D1D1F]">
              {context?.pageTitle ??
                (contextErrorCode === 'FILE_ACCESS_REQUIRED'
                  ? 'Local file permission needed'
                  : 'Page content unavailable')}
            </p>

            {contextErrorCode === 'FILE_ACCESS_REQUIRED' ? (
              <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50/80 p-2.5 text-[11px] text-amber-900">
                <div className="flex items-start gap-2">
                  <FolderLock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                  <div className="space-y-1">
                    <p className="font-semibold">Allow access to local files (file://)</p>
                    <ol className="list-decimal space-y-0.5 pl-4 text-amber-800">
                      <li>Click Open Extension Settings</li>
                      <li>Toggle on &ldquo;Allow access to file URLs&rdquo;</li>
                      <li>Return here and click Refresh</li>
                    </ol>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenExtensionSettings}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#1D1D1F] px-3 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-black"
                >
                  <span>Open Extension Settings</span>
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>
            ) : contextErrorCode === 'PDF_ISOLATED' && contextError ? (
              <div className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-sky-200/80 bg-sky-50/70 px-2.5 py-2 text-[11px] leading-snug text-sky-900">
                <span>{contextError}</span>
                <button
                  type="button"
                  onClick={() => void refreshContext()}
                  className="shrink-0 font-semibold text-sky-800 underline"
                >
                  Refresh
                </button>
              </div>
            ) : contextError ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                <span>{contextError}</span>
                <button
                  type="button"
                  onClick={() => void refreshContext()}
                  className="shrink-0 font-semibold text-amber-900 underline"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span
                    className={
                      tokenStatus.exceedsNano
                        ? 'font-medium text-sky-700'
                        : 'font-medium text-emerald-700'
                    }
                  >
                    {tokenStatus.exceedsNano
                      ? 'Uses Cloud AI (long page)'
                      : 'Private AI ready'}
                  </span>
                  <span
                    title={`Approximate payload size (${tokenStatus.tokens.toLocaleString()} of ${NANO_TOKEN_LIMIT.toLocaleString()} local Gemini Nano tokens)`}
                    className="tabular-nums text-neutral-400"
                  >
                    ~{tokenStatus.tokens.toLocaleString()} / {NANO_TOKEN_LIMIT.toLocaleString()} tokens
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F5F5F7]">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      tokenStatus.exceedsNano ? 'bg-sky-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${tokenStatus.percent}%` }}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Prompt Library */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div
                role="tablist"
                aria-label="Prompt library tabs"
                className="inline-flex rounded-xl bg-black/5 p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={libraryTab === 'discover'}
                  onClick={() => {
                    setLibraryTab('discover');
                    setSelectedCategory('All');
                  }}
                  className={`rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition ${
                    libraryTab === 'discover'
                      ? 'bg-white text-[#1D1D1F] shadow-xs'
                      : 'text-neutral-600 hover:text-[#1D1D1F]'
                  }`}
                >
                  Discover
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={libraryTab === 'my-prompts'}
                  onClick={() => {
                    setLibraryTab('my-prompts');
                    setSelectedCategory('All');
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition ${
                    libraryTab === 'my-prompts'
                      ? 'bg-white text-[#1D1D1F] shadow-xs'
                      : 'text-neutral-600 hover:text-[#1D1D1F]'
                  }`}
                >
                  <span>My Prompts</span>
                  <span className="rounded-full bg-black/6 px-1.5 text-[10px] text-neutral-600">
                    {customPrompts.length}
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1 rounded-full bg-[#1D1D1F] px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-black"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Prompt</span>
              </button>
            </div>

            {/* Search & Category Filters */}
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search prompts..."
                  aria-label="Search prompts"
                  className="w-full rounded-xl border border-black/8 bg-white py-1.5 pr-7 pl-8 text-[12px] text-[#1D1D1F] placeholder:text-neutral-400 outline-none transition focus:border-[#0071E3]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {availableCategories.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {availableCategories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setSelectedCategory(category)}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                        selectedCategory === category
                          ? 'bg-[#1D1D1F] text-white'
                          : 'bg-white text-neutral-600 ring-1 ring-black/8 hover:bg-neutral-50'
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Account Sync nudge inside My Prompts when signed out */}
            {libraryTab === 'my-prompts' && !user && isFirebaseConfigured && (
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="flex w-full items-center justify-between rounded-xl border border-black/6 bg-white/80 px-3 py-2 text-left text-[11px] text-neutral-600 transition hover:border-[#0071E3]/30 hover:text-[#0071E3]"
              >
                <span>Sign in to back up &amp; sync your custom prompts across devices</span>
                <UserIcon className="h-3.5 w-3.5 shrink-0" />
              </button>
            )}

            {/* Prompt List / Empty States */}
            {libraryTab === 'my-prompts' && customPrompts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/12 bg-white/80 p-5 text-center">
                <p className="text-[13px] font-medium text-[#1D1D1F]">No custom prompts yet</p>
                <p className="mt-1 text-[11.5px] text-neutral-500">
                  Save your favorite instructions to run them on any page in one click.
                </p>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="mt-3 inline-flex items-center gap-1 rounded-full bg-[#0071E3] px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#0077ED]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create Your First Prompt</span>
                </button>
              </div>
            ) : filteredPrompts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/12 bg-white/80 p-5 text-center">
                <p className="text-[12.5px] font-medium text-[#1D1D1F]">
                  No prompts match your filter
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCategory('All');
                  }}
                  className="mt-2 text-[11.5px] font-medium text-[#0071E3] hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 pb-4">
                {filteredPrompts.map((prompt, index) => (
                  <article
                    key={prompt.id}
                    className="group rounded-2xl border border-black/8 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-black/14"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="truncate text-[13px] font-semibold text-[#1D1D1F]">
                            {prompt.title}
                          </h3>
                          {prompt.category && (
                            <span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                              {prompt.category}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-neutral-500">
                          {prompt.instruction}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={runningPromptId !== null}
                        onClick={() => void handleRunPrompt(prompt)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#0071E3] px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#0077ED] disabled:opacity-50"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        <span>{runningPromptId === prompt.id ? 'Running' : 'Run'}</span>
                      </button>
                    </div>

                    {libraryTab === 'my-prompts' && (
                      <div className="mt-2 flex items-center justify-end gap-1 border-t border-black/5 pt-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {!isFiltered && (
                          <>
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => void handleReorder(prompt.id, 'up')}
                              aria-label={`Move ${prompt.title} up`}
                              className="rounded-md p-1 text-neutral-400 transition hover:bg-[#F5F5F7] hover:text-neutral-700 disabled:opacity-30"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === filteredPrompts.length - 1}
                              onClick={() => void handleReorder(prompt.id, 'down')}
                              aria-label={`Move ${prompt.title} down`}
                              className="rounded-md p-1 text-neutral-400 transition hover:bg-[#F5F5F7] hover:text-neutral-700 disabled:opacity-30"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingPrompt(prompt)}
                          aria-label={`Edit ${prompt.title}`}
                          className="rounded-md p-1 text-neutral-400 transition hover:bg-[#F5F5F7] hover:text-neutral-700"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeletePrompt(prompt.id)}
                          aria-label={`Delete ${prompt.title}`}
                          className="rounded-md p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {usageStats && usageStats.totalShots > 0 && (
        <footer className="mt-auto border-t border-black/5 pt-2.5 pb-1 text-center text-[11px] text-neutral-500">
          {formatUsageFooter(usageStats)}
        </footer>
      )}

      {(showCreateModal || editingPrompt) && (
        <PromptFormModal
          initial={editingPrompt}
          onSave={(values) => void handleSavePrompt(values)}
          onClose={() => {
            setShowCreateModal(false);
            setEditingPrompt(null);
          }}
        />
      )}

      {showAuthModal && (
        <AuthModal
          user={user}
          isSyncing={isSyncing}
          onSyncNow={() => (user ? performCloudSync(user.uid, prompts) : Promise.resolve())}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
}
