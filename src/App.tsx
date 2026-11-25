import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileText,
  FileUp,
  FolderLock,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { isFirebaseConfigured } from './lib/firebase';
import {
  CLOUD_INFERENCE_SOURCE,
  diagnoseLocalAi,
  isWarmSessionCached,
  LOCAL_INFERENCE_SOURCE,
  LocalAiSetupRequiredError,
  prewarmLocalSession,
  runHybridPrompt,
  SAFE_ON_DEVICE_TOKEN_LIMIT,
  warmUpLocalModel,
  type LocalAiDiagnostics,
} from './lib/ai';
import {
  ContextExtractionError,
  estimateTokens,
  extractActiveTabContext,
  extractPdfContextFromFile,
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
  loadLocalOnlyMode,
  loadPinnedPromptIds,
  saveLocalOnlyMode,
  savePinnedPromptIds,
} from './lib/storage';
import {
  deleteCloudPrompt,
  saveAllCloudPrompts,
  saveCloudPinnedPromptIds,
  subscribeToAuth,
  syncPinnedPromptIdsOnSignIn,
  syncPromptsOnSignIn,
  upsertCloudPrompt,
} from './lib/sync';
import { AuthModal } from './components/AuthModal';
import { NanoSetupGuide } from './components/NanoSetupGuide';
import { OutputCard } from './components/OutputCard';
import { PromptFormModal } from './components/PromptFormModal';

type AppView = 'prompts' | 'results';
type LibraryTab = 'core' | 'custom';

const INITIAL_DIAGNOSTICS: LocalAiDiagnostics = {
  status: 'flags-required',
  rawAvailability: 'checking',
  chromeVersion: null,
  supportsChromeVersion: true,
};

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('prompts');
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('core');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [pinnedPromptIds, setPinnedPromptIds] = useState<string[]>([]);
  const [localOnlyMode, setLocalOnlyMode] = useState(false);
  const [context, setContext] = useState<PageContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextErrorCode, setContextErrorCode] = useState<ContextErrorCode | null>(null);
  const [refreshingContext, setRefreshingContext] = useState(false);

  const [diagnostics, setDiagnostics] = useState<LocalAiDiagnostics>(INITIAL_DIAGNOSTICS);
  const [diagnosticsLoaded, setDiagnosticsLoaded] = useState(false);
  const [showSetupView, setShowSetupView] = useState(false);
  const [isPrewarming, setIsPrewarming] = useState(false);
  const [isWarming, setIsWarming] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [runningPromptId, setRunningPromptId] = useState<string | null>(null);
  const [outputState, setOutputState] = useState<{
    prompt: PromptItem;
    isRunning: boolean;
    outputText: string;
    inferenceSource: string | undefined;
    notice: string | null;
    needsLocalSetup: boolean;
    elapsedMs: number | null;
    error: string | null;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
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

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage((prev) => (prev === message ? null : prev));
    }, 2600);
  }, []);

  const refreshDiagnostics = useCallback(async (): Promise<LocalAiDiagnostics> => {
    const next = await diagnoseLocalAi();
    setDiagnostics(next);
    setDiagnosticsLoaded(true);
    if (next.status === 'ready') {
      setSetupError(null);
      if (!isWarmSessionCached()) {
        setIsPrewarming(true);
        void prewarmLocalSession()
          .catch((err) => {
            console.warn('[Espresso Local AI] Background prewarm skipped:', err);
          })
          .finally(() => {
            setIsPrewarming(false);
          });
      }
    }
    return next;
  }, []);

  const handleManualCheckStatus = async () => {
    const next = await refreshDiagnostics();
    if (next.status === 'ready') {
      showToast('Gemini Nano 4 is ready');
    } else if (next.status === 'downloadable') {
      showToast('Chrome flags active — click Download & Enable Nano 4');
    } else if (next.status === 'downloading') {
      showToast('Gemini Nano 4 is downloading in Chrome');
    } else {
      showToast('Still not detected — enable both flags and relaunch Chrome');
    }
  };

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

  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const handleOpenChromeUrl = (url: string) => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url });
    }
  };

  const handleOpenExtensionSettings = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      handleOpenChromeUrl(`chrome://extensions/?id=${chrome.runtime.id}`);
    }
  };

  const handlePdfFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setRefreshingContext(true);
    setContextError(null);
    setContextErrorCode(null);
    try {
      const pdfContext = await extractPdfContextFromFile(file);
      setContext(pdfContext);
      showToast(`Loaded ${file.name}`);
    } catch (err) {
      setContext(null);
      setContextError(err instanceof Error ? err.message : 'Unable to extract text from PDF.');
      setContextErrorCode(err instanceof ContextExtractionError ? err.code : 'PDF_ISOLATED');
    } finally {
      setRefreshingContext(false);
    }
  };

  useEffect(() => {
    void loadLocalPrompts().then(setPrompts);
    void loadPinnedPromptIds().then(setPinnedPromptIds);
    void loadLocalOnlyMode().then(setLocalOnlyMode);
    void refreshContext();
    void refreshDiagnostics();
  }, [refreshContext, refreshDiagnostics]);

  // Auto-poll Chrome download availability while model weights are downloading.
  useEffect(() => {
    if (diagnostics.status !== 'downloading') return;
    const timer = setInterval(() => {
      void refreshDiagnostics().then((next) => {
        if (next.status === 'ready') {
          showToast('Gemini Nano 4 is ready');
        }
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [diagnostics.status, refreshDiagnostics, showToast]);

  const performCloudSync = useCallback(async (uid: string, localList: PromptItem[]) => {
    setIsSyncing(true);
    try {
      const merged = await syncPromptsOnSignIn(uid, localList);
      setPrompts(merged);
      await saveLocalPrompts(merged);

      try {
        const localPinned = await loadPinnedPromptIds();
        const mergedPinned = await syncPinnedPromptIdsOnSignIn(uid, localPinned);
        setPinnedPromptIds(mergedPinned);
        await savePinnedPromptIds(mergedPinned);
      } catch (pinErr) {
        console.warn('Pinned prompt sync failed:', pinErr);
      }
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
    setIsWarming(true);
    setDownloadProgress(0);
    setSetupError(null);
    try {
      const ready = await warmUpLocalModel((progress) => setDownloadProgress(progress));
      const nextDiag = await refreshDiagnostics();
      if (ready || nextDiag.status === 'ready') {
        showToast('Gemini Nano 4 ready');
      }
    } catch (err) {
      console.warn('[Espresso Local AI]', err);
      setSetupError(
        err instanceof Error
          ? err.message
          : 'Could not activate Gemini Nano 4. Check Chrome flags and try again.',
      );
      await refreshDiagnostics();
    } finally {
      setIsWarming(false);
      setDownloadProgress(null);
    }
  };

  const handleStopPrompt = () => {
    abortControllerRef.current?.abort();
  };

  const handleRunPrompt = async (prompt: PromptItem) => {
    if (runningPromptId !== null) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const startTime = performance.now();
    runStartRef.current = startTime;
    setLiveElapsedMs(0);
    setRunningPromptId(prompt.id);
    setDownloadProgress(null);
    setActiveView('results');
    targetTextRef.current = '';
    displayedLenRef.current = 0;
    setDisplayedText('');
    const prefersLocal =
      localOnlyMode ||
      (diagnostics.status === 'ready' &&
        (context?.tokens ?? 0) <= SAFE_ON_DEVICE_TOKEN_LIMIT);

    setOutputState({
      prompt,
      isRunning: true,
      outputText: '',
      inferenceSource: prefersLocal ? LOCAL_INFERENCE_SOURCE : CLOUD_INFERENCE_SOURCE,
      notice: null,
      needsLocalSetup: false,
      elapsedMs: null,
      error: null,
    });

    try {
      const freshContext =
        context?.source === 'pdf-file' ? context : await refreshContext();
      if (!freshContext) {
        throw new Error('Could not extract readable text from the active tab.');
      }

      const result = await runHybridPrompt(prompt.instruction, freshContext.text, {
        localOnly: localOnlyMode,
        signal: controller.signal,
        onProgress: (progress) => setDownloadProgress(progress),
        onSourceChange: (source) => {
          setOutputState((prev) => (prev ? { ...prev, inferenceSource: source } : prev));
        },
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
      targetTextRef.current = result.text;
      setOutputState({
        prompt,
        isRunning: false,
        outputText: result.text,
        inferenceSource: result.inferenceSource,
        notice: result.notice ?? null,
        needsLocalSetup: false,
        elapsedMs: finalElapsedMs,
        error: null,
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        const finalElapsedMs = performance.now() - startTime;
        setOutputState((prev) =>
          prev
            ? {
                ...prev,
                isRunning: false,
                elapsedMs: prev.outputText ? finalElapsedMs : null,
                error: null,
              }
            : null,
        );
        if (!targetTextRef.current) {
          setActiveView('prompts');
        }
        showToast('Stopped');
        return;
      }

      const needsSetup = err instanceof LocalAiSetupRequiredError;
      if (needsSetup) {
        void refreshDiagnostics();
      }
      setOutputState({
        prompt,
        isRunning: false,
        outputText: '',
        inferenceSource: undefined,
        notice: null,
        needsLocalSetup: needsSetup,
        elapsedMs: null,
        error: err instanceof Error ? err.message : 'Local inference failed. Please try again.',
      });
    } finally {
      abortControllerRef.current = null;
      setRunningPromptId(null);
      setDownloadProgress(null);
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
      const nextPinned = [
        updatedItem.id,
        ...pinnedPromptIds.filter((id) => id !== updatedItem.id),
      ];
      setPinnedPromptIds(nextPinned);
      void savePinnedPromptIds(nextPinned);
      if (user) {
        void saveCloudPinnedPromptIds(user.uid, nextPinned);
      }
      setLibraryTab('custom');
      setActiveView('prompts');
    }
    showToast(isEditing ? 'Prompt updated' : 'Prompt saved & pinned');
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
    if (pinnedPromptIds.includes(promptId)) {
      const nextPinned = pinnedPromptIds.filter((id) => id !== promptId);
      setPinnedPromptIds(nextPinned);
      await savePinnedPromptIds(nextPinned);
      if (user) {
        void saveCloudPinnedPromptIds(user.uid, nextPinned);
      }
    }
    showToast('Prompt deleted');
    await saveLocalPrompts(nextList);
    if (user) {
      void deleteCloudPrompt(user.uid, promptId);
    }
  };

  const handleTogglePin = async (promptId: string) => {
    const isPinned = pinnedPromptIds.includes(promptId);
    const nextPinned = isPinned
      ? pinnedPromptIds.filter((id) => id !== promptId)
      : [promptId, ...pinnedPromptIds];
    setPinnedPromptIds(nextPinned);
    await savePinnedPromptIds(nextPinned);
    showToast(isPinned ? 'Unpinned prompt' : 'Pinned for quick access');
    if (user) {
      void saveCloudPinnedPromptIds(user.uid, nextPinned);
    }
  };

  const handleToggleLocalOnly = async () => {
    const next = !localOnlyMode;
    setLocalOnlyMode(next);
    await saveLocalOnlyMode(next);
    showToast(
      next
        ? 'Local Only mode enabled (100% on-device Nano 4)'
        : 'Hybrid mode enabled (Nano 4 first, Cloud fallback)',
    );
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
  const pinnedPrompts = useMemo(() => {
    const byId = new Map<string, PromptItem>();
    for (const item of STARTER_PROMPTS) byId.set(item.id, item);
    for (const item of customPrompts) byId.set(item.id, item);
    return pinnedPromptIds
      .map((id) => byId.get(id))
      .filter((item): item is PromptItem => Boolean(item));
  }, [pinnedPromptIds, customPrompts]);

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

  const contextChars = context?.text.trim().length ?? 0;
  const contextTokens = context?.tokens ?? estimateTokens(context?.text ?? '');
  const exceedsLocalWindow = contextTokens > SAFE_ON_DEVICE_TOKEN_LIMIT;
  const budgetPercent = Math.min(
    100,
    Math.round((contextTokens / SAFE_ON_DEVICE_TOKEN_LIMIT) * 100),
  );
  const nanoPrimaryActive = diagnostics.status === 'ready' && !exceedsLocalWindow;
  const showOnboarding = showSetupView;

  const renderPromptCard = (
    prompt: PromptItem,
    options: {
      keyPrefix: string;
      showManageActions: boolean;
      index?: number;
      total?: number;
      showCustomBadge?: boolean;
    },
  ) => {
    const isPinned = pinnedPromptIds.includes(prompt.id);
    const index = options.index ?? 0;
    const total = options.total ?? 0;

    return (
      <article
        key={`${options.keyPrefix}-${prompt.id}`}
        className="group rounded-2xl border border-black/8 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-black/14"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-[13px] font-semibold text-[#1D1D1F]">{prompt.title}</h3>
              {prompt.category && (
                <span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                  {prompt.category}
                </span>
              )}
              {options.showCustomBadge && !isBuiltInPrompt(prompt) && (
                <span className="rounded-full bg-[#0071E3]/10 px-2 py-0.5 text-[10px] font-medium text-[#0071E3]">
                  Custom
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-neutral-500">
              {prompt.instruction}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void handleTogglePin(prompt.id)}
              aria-label={isPinned ? `Unpin ${prompt.title}` : `Pin ${prompt.title}`}
              aria-pressed={isPinned}
              title={isPinned ? 'Unpin' : 'Pin for quick access'}
              className={`rounded-full p-1.5 transition ${
                isPinned
                  ? 'bg-[#0071E3]/10 text-[#0071E3] hover:bg-[#0071E3]/18'
                  : 'text-neutral-400 hover:bg-[#F5F5F7] hover:text-neutral-700'
              }`}
            >
              <Pin className={`h-3.5 w-3.5 ${isPinned ? 'fill-current' : ''}`} />
            </button>
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
        </div>

        {options.showManageActions && (
          <div className="mt-2 flex items-center justify-end gap-1 border-t border-black/5 pt-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
              disabled={index === total - 1}
              onClick={() => void handleReorder(prompt.id, 'down')}
              aria-label={`Move ${prompt.title} down`}
              className="rounded-md p-1 text-neutral-400 transition hover:bg-[#F5F5F7] hover:text-neutral-700 disabled:opacity-30"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
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
    );
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col gap-3 px-3.5 py-3.5">
      {/* Header */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <img
            src="/icons/icon-48.png"
            alt="Espresso logo"
            className="h-7 w-7 shrink-0 rounded-xl bg-white object-contain p-0.5 shadow-xs ring-1 ring-black/6"
          />
          <div className="min-w-0">
            <h1 className="truncate text-[14.5px] font-semibold leading-tight tracking-tight text-[#1D1D1F]">
              Espresso
            </h1>
            <p className="truncate text-[10.5px] text-neutral-500">Hybrid &bull; Nano 4 First</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={isWarming}
            onClick={() => {
              setShowSetupView((prev) => {
                const next = !prev;
                if (next) {
                  void refreshDiagnostics();
                }
                return next;
              });
            }}
            title={
              diagnostics.status === 'ready'
                ? 'Gemini Nano 4 Status & Setup Guide'
                : 'Open Gemini Nano 4 Chrome setup guide'
            }
            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-medium transition ${
              showSetupView
                ? 'bg-[#0071E3] text-white ring-1 ring-[#0071E3]'
                : diagnostics.status === 'ready'
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100/70'
                  : diagnostics.status === 'downloadable' || diagnostics.status === 'downloading'
                    ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100/70'
                    : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100/80'
            }`}
          >
            <Cpu className="h-3.5 w-3.5 shrink-0" />
            <span>
              {isWarming
                ? downloadProgress !== null
                  ? `Preparing ${Math.round(downloadProgress * 100)}%`
                  : 'Preparing...'
                : isPrewarming
                  ? 'Warming...'
                  : diagnostics.status === 'ready'
                    ? 'Nano 4 Ready'
                    : diagnostics.status === 'downloading'
                      ? 'Downloading...'
                      : diagnostics.status === 'downloadable'
                        ? 'Download Nano 4'
                        : 'Setup Nano 4'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            aria-label={user ? `Account & Prompt Sync: ${user.email}` : 'Sign in for Prompt Sync'}
            title={user ? `Synced: ${user.email}` : 'Account & Prompt Sync'}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full text-[11px] font-medium ring-1 transition ${
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

      {toastMessage && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>{toastMessage}</span>
        </div>
      )}

      {showOnboarding ? (
        <NanoSetupGuide
          diagnostics={diagnostics}
          isWarming={isWarming}
          isPrewarming={isPrewarming}
          isWarmCached={isWarmSessionCached()}
          downloadProgress={downloadProgress}
          setupError={setupError}
          onCheckStatus={() => void handleManualCheckStatus()}
          onDownloadModel={() => void handleWarmUpLocalAi()}
          onOpenChromeUrl={handleOpenChromeUrl}
          onSkip={() => setShowSetupView(false)}
        />
      ) : (
        <>
          {/* Primary View Switcher: Prompts | Results */}
          <nav aria-label="Main view" className="grid grid-cols-2 rounded-xl bg-black/5 p-1">
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

          {/* Compact Inference Mode Switcher: Hybrid (Nano 4 First) | Local Only */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-black/6 bg-white/80 px-2.5 py-1.5">
            <span className="truncate text-[11px] font-medium text-neutral-600">
              {localOnlyMode
                ? 'Locked 100% on-device'
                : 'Smart hybrid mode'}
            </span>
            <div
              role="group"
              aria-label="Inference mode"
              className="inline-flex shrink-0 rounded-lg bg-black/5 p-0.5"
            >
              <button
                type="button"
                aria-pressed={!localOnlyMode}
                onClick={() => localOnlyMode && void handleToggleLocalOnly()}
                className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[10.5px] font-medium transition ${
                  !localOnlyMode
                    ? 'bg-white text-[#1D1D1F] shadow-xs'
                    : 'text-neutral-500 hover:text-[#1D1D1F]'
                }`}
              >
                Hybrid
              </button>
              <button
                type="button"
                aria-pressed={localOnlyMode}
                onClick={() => !localOnlyMode && void handleToggleLocalOnly()}
                className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[10.5px] font-medium transition ${
                  localOnlyMode
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-neutral-500 hover:text-[#1D1D1F]'
                }`}
              >
                Local Only
              </button>
            </div>
          </div>

          {diagnosticsLoaded && diagnostics.status !== 'ready' && (
            <div className="flex items-start justify-between gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-[11.5px] text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div>
                  <p className="font-semibold leading-tight">
                    {localOnlyMode
                      ? 'Gemini Nano 4 not installed yet'
                      : 'Running on Gemini Cloud fallback'}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-amber-800">
                    {localOnlyMode
                      ? 'Local Only mode requires Chrome Gemini Nano 4 to be enabled.'
                      : diagnostics.status === 'downloadable'
                        ? 'Download Nano 4 (~1.5–2 GB) for faster, private offline AI.'
                        : 'Enable Gemini Nano 4 in Chrome for primary on-device AI.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowSetupView(true);
                  void refreshDiagnostics();
                }}
                className="shrink-0 whitespace-nowrap rounded-full bg-[#1D1D1F] px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-black"
              >
                {diagnostics.status === 'downloadable' ? 'Download' : 'Setup Nano 4'}
              </button>
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
                needsLocalSetup={outputState.needsLocalSetup}
                elapsedMs={outputState.elapsedMs ?? liveElapsedMs}
                error={outputState.error}
                onOpenSetup={() => {
                  setShowSetupView(true);
                  setActiveView('prompts');
                  void refreshDiagnostics();
                }}
                onStop={handleStopPrompt}
                onRegenerate={() => void handleRunPrompt(outputState.prompt)}
                onBack={() => setActiveView('prompts')}
              />
            ) : (
              <section className="rounded-2xl border border-dashed border-black/12 bg-white/80 p-6 text-center">
                <Sparkles className="mx-auto h-5 w-5 text-neutral-400" />
                <p className="mt-2 text-[13px] font-medium text-[#1D1D1F]">No results yet</p>
                <p className="mt-1 text-[11.5px] text-neutral-500">
                  Run any prompt on the active page or an offline PDF to view results here.
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
              {/* Webpage / Offline PDF Context Card */}
              <section className="rounded-2xl border border-black/8 bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => void handlePdfFileChange(e)}
                  className="hidden"
                />
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      context?.source === 'selection'
                        ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                        : context?.source === 'pdf-file'
                          ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                          : 'bg-[#F5F5F7] text-neutral-700 ring-1 ring-black/6'
                    }`}
                  >
                    <FileText className="h-3 w-3" />
                    <span>
                      {context?.source === 'selection'
                        ? 'Selected text'
                        : context?.source === 'pdf-file'
                          ? 'Local PDF loaded'
                          : 'Active page'}
                    </span>
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => pdfInputRef.current?.click()}
                      disabled={refreshingContext}
                      title="Open a local PDF file directly (works 100% offline)"
                      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50"
                    >
                      <FileUp className="h-3 w-3" />
                      <span>Open PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void refreshContext()}
                      disabled={refreshingContext}
                      title={
                        context?.source === 'pdf-file'
                          ? 'Switch back to active tab'
                          : 'Refresh active tab'
                      }
                      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-[#0071E3] transition hover:bg-[#0071E3]/8 disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${refreshingContext ? 'animate-spin' : ''}`}
                      />
                      <span>{context?.source === 'pdf-file' ? 'Use Tab' : 'Refresh'}</span>
                    </button>
                  </div>
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
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={handleOpenExtensionSettings}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#1D1D1F] px-3 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-black"
                      >
                        <span>Open Extension Settings</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => pdfInputRef.current?.click()}
                        className="inline-flex items-center justify-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#1D1D1F] ring-1 ring-black/12 transition hover:bg-neutral-50"
                      >
                        <FileUp className="h-3 w-3" />
                        <span>Open PDF</span>
                      </button>
                    </div>
                  </div>
                ) : contextErrorCode === 'PDF_ISOLATED' && contextError ? (
                  <div className="mt-2 space-y-2 rounded-xl border border-sky-200/80 bg-sky-50/70 px-2.5 py-2 text-[11px] leading-snug text-sky-900">
                    <p>{contextError}</p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => pdfInputRef.current?.click()}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-medium text-sky-900 ring-1 ring-sky-200 hover:bg-sky-50"
                      >
                        <FileUp className="h-3 w-3" />
                        <span>Open PDF File</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void refreshContext()}
                        className="font-semibold text-sky-800 underline"
                      >
                        Refresh
                      </button>
                    </div>
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
                          localOnlyMode || nanoPrimaryActive
                            ? 'font-medium text-emerald-700'
                            : 'font-medium text-sky-700'
                        }
                      >
                        {localOnlyMode
                          ? exceedsLocalWindow
                            ? 'Local Only — primary ~4,800 chars (Nano 4)'
                            : 'Local Only (Gemini Nano 4)'
                          : nanoPrimaryActive
                            ? 'Routes to Gemini Nano 4 (On-Device)'
                            : exceedsLocalWindow
                              ? 'Routes to Gemini Cloud (long document)'
                              : 'Routes to Gemini Cloud (Nano 4 not enabled)'}
                      </span>
                      <span
                        title={`Estimated ${contextTokens.toLocaleString()} tokens (${contextChars.toLocaleString()} chars)`}
                        className="tabular-nums text-neutral-400"
                      >
                        ~{contextTokens.toLocaleString()} tokens
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F5F5F7]">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          localOnlyMode || nanoPrimaryActive ? 'bg-emerald-500' : 'bg-sky-500'
                        }`}
                        style={{ width: `${budgetPercent}%` }}
                      />
                    </div>
                  </div>
                )}
              </section>

              {/* Minimalist Prompt Library */}
              <section className="flex flex-col gap-2 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div
                    role="tablist"
                    aria-label="Prompt library tabs"
                    className="inline-flex rounded-xl bg-black/5 p-0.5"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={libraryTab === 'core'}
                      onClick={() => setLibraryTab('core')}
                      className={`rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition ${
                        libraryTab === 'core'
                          ? 'bg-white text-[#1D1D1F] shadow-xs'
                          : 'text-neutral-600 hover:text-[#1D1D1F]'
                      }`}
                    >
                      Core (4)
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={libraryTab === 'custom'}
                      onClick={() => setLibraryTab('custom')}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition ${
                        libraryTab === 'custom'
                          ? 'bg-white text-[#1D1D1F] shadow-xs'
                          : 'text-neutral-600 hover:text-[#1D1D1F]'
                      }`}
                    >
                      <span>Custom</span>
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

                {libraryTab === 'core' ? (
                  <div className="flex flex-col gap-2">
                    {pinnedPrompts.length > 0 && (
                      <div className="mb-1 flex flex-col gap-2">
                        <div className="flex items-center justify-between px-0.5">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[#1D1D1F]">
                            <Pin className="h-3 w-3 fill-[#0071E3] text-[#0071E3]" />
                            <span>Pinned</span>
                          </span>
                          <span className="text-[10.5px] text-neutral-400">
                            Quick access ({pinnedPrompts.length})
                          </span>
                        </div>
                        {pinnedPrompts.map((prompt) =>
                          renderPromptCard(prompt, {
                            keyPrefix: 'pinned',
                            showManageActions: false,
                            showCustomBadge: true,
                          }),
                        )}
                        <div className="pt-1 text-[11px] font-semibold tracking-tight text-neutral-500">
                          Core Prompts
                        </div>
                      </div>
                    )}

                    {STARTER_PROMPTS.map((prompt, index) =>
                      renderPromptCard(prompt, {
                        keyPrefix: 'core',
                        showManageActions: false,
                        index,
                        total: STARTER_PROMPTS.length,
                      }),
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {!user && isFirebaseConfigured && (
                      <button
                        type="button"
                        onClick={() => setShowAuthModal(true)}
                        className="flex w-full items-center justify-between rounded-xl border border-black/6 bg-white/80 px-3 py-2 text-left text-[11px] text-neutral-600 transition hover:border-[#0071E3]/30 hover:text-[#0071E3]"
                      >
                        <span>Sign in to sync custom prompts across devices</span>
                        <UserIcon className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    )}

                    {customPrompts.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-black/12 bg-white/80 p-5 text-center">
                        <p className="text-[13px] font-medium text-[#1D1D1F]">No custom prompts yet</p>
                        <p className="mt-1 text-[11.5px] text-neutral-500">
                          Save your favorite local instructions and pin them for 1-click access.
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowCreateModal(true)}
                          className="mt-3 inline-flex items-center gap-1 rounded-full bg-[#0071E3] px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#0077ED]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Create Prompt</span>
                        </button>
                      </div>
                    ) : (
                      customPrompts.map((prompt, index) =>
                        renderPromptCard(prompt, {
                          keyPrefix: 'custom',
                          showManageActions: true,
                          index,
                          total: customPrompts.length,
                        }),
                      )
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </>
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
