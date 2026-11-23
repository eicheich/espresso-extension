import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowDown,
  ArrowUp,
  Cloud,
  Cpu,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { isFirebaseConfigured } from './lib/firebase';
import { buildHybridPrompt, runHybridPrompt, warmUpLocalModel } from './lib/ai';
import {
  estimateTokens,
  extractActiveTabContext,
  getTokenStatus,
  NANO_TOKEN_LIMIT,
  type PageContext,
} from './lib/context';
import {
  loadLocalPrompts,
  reorderPrompts,
  saveLocalPrompts,
  sortPrompts,
  type PromptItem,
} from './lib/prompts';
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

export default function App() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [context, setContext] = useState<PageContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [refreshingContext, setRefreshingContext] = useState(false);

  const [activePromptTokens, setActivePromptTokens] = useState<number | null>(null);
  const [localAiStatus, setLocalAiStatus] = useState<LocalAiStatus>('idle');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  const [runningPromptId, setRunningPromptId] = useState<string | null>(null);
  const [outputState, setOutputState] = useState<{
    promptTitle: string;
    isRunning: boolean;
    outputText: string;
    inferenceSource: string | undefined;
    error: string | null;
  } | null>(null);

  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshContext = useCallback(async (): Promise<PageContext | null> => {
    setRefreshingContext(true);
    setContextError(null);
    try {
      const next = await extractActiveTabContext();
      setContext(next);
      return next;
    } catch (err) {
      setContext(null);
      setContextError(err instanceof Error ? err.message : 'Unable to read active webpage.');
      return null;
    } finally {
      setRefreshingContext(false);
    }
  }, []);

  useEffect(() => {
    void loadLocalPrompts().then(setPrompts);
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

  const handleRunPrompt = async (prompt: PromptItem) => {
    setRunningPromptId(prompt.id);
    setDownloadProgress(null);
    setOutputState({
      promptTitle: prompt.title,
      isRunning: true,
      outputText: '',
      inferenceSource: undefined,
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

      const result = await runHybridPrompt(
        prompt.instruction,
        freshContext.text,
        (progress) => setDownloadProgress(progress),
      );

      setOutputState({
        promptTitle: prompt.title,
        isRunning: false,
        outputText: result.text,
        inferenceSource: result.inferenceSource,
        error: null,
      });
    } catch (err) {
      setOutputState({
        promptTitle: prompt.title,
        isRunning: false,
        outputText: '',
        inferenceSource: undefined,
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

    setPrompts(nextList);
    setShowCreateModal(false);
    setEditingPrompt(null);
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
    await saveLocalPrompts(nextList);
    if (user) {
      void deleteCloudPrompt(user.uid, promptId);
    }
  };

  const handleReorder = async (promptId: string, direction: 'up' | 'down') => {
    const nextList = reorderPrompts(prompts, promptId, direction);
    setPrompts(nextList);
    await saveLocalPrompts(nextList);
    if (user) {
      void saveAllCloudPrompts(user.uid, nextList);
    }
  };

  const displayedTokens = activePromptTokens ?? context?.tokens ?? 0;
  const tokenStatus = getTokenStatus(displayedTokens);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col gap-3 px-3.5 py-3.5">
      {/* Header */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#1D1D1F] to-[#0071E3] text-white shadow-xs">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold leading-tight tracking-tight text-[#1D1D1F]">
              Lazy Prompt
            </h1>
            <p className="text-[11px] text-neutral-500">Hybrid On-Device &amp; Cloud AI</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleWarmUpLocalAi()}
            disabled={localAiStatus === 'warming'}
            title="Warm up on-device Gemini Nano model"
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition ${
              localAiStatus === 'ready'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : localAiStatus === 'fallback'
                  ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                  : 'bg-white text-[#1D1D1F] ring-1 ring-black/8 hover:bg-neutral-50'
            }`}
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>
              {localAiStatus === 'warming'
                ? downloadProgress !== null
                  ? `${Math.round(downloadProgress * 100)}%`
                  : 'Warming...'
                : localAiStatus === 'ready'
                  ? 'Nano Ready'
                  : localAiStatus === 'fallback'
                    ? 'Cloud Mode'
                    : 'Warm Up Local AI'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            title={user ? `Synced: ${user.email}` : 'Sign in for Cloud Sync'}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 transition ${
              user
                ? 'bg-[#0071E3]/10 text-[#0071E3] ring-[#0071E3]/30'
                : 'bg-white text-neutral-600 ring-black/8 hover:bg-neutral-50'
            }`}
          >
            <Cloud className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {!isFirebaseConfigured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          Firebase is not configured yet. Add your <code className="font-mono">.env</code> keys and rebuild to enable Hybrid AI and Cloud Sync.
        </div>
      )}

      {/* Smart Context Extraction & Live Token Meter */}
      <section className="rounded-2xl border border-black/8 bg-white p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              context?.source === 'selection'
                ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                : 'bg-[#F5F5F7] text-neutral-700 ring-1 ring-black/6'
            }`}
          >
            {context?.source === 'selection' ? 'Context: Selected Text' : 'Context: Full Page'}
          </span>

          <button
            type="button"
            onClick={() => void refreshContext()}
            disabled={refreshingContext}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-[#0071E3] transition hover:bg-[#0071E3]/8 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshingContext ? 'animate-spin' : ''}`} />
            <span>Refresh Context</span>
          </button>
        </div>

        <p className="mt-1.5 truncate text-[12px] font-medium text-[#1D1D1F]">
          {context?.pageTitle ?? 'No active page text loaded'}
        </p>

        {contextError && (
          <p className="mt-1.5 text-[11px] text-red-600">{contextError}</p>
        )}

        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="font-medium text-neutral-600">
              ~{tokenStatus.tokens.toLocaleString()} / {NANO_TOKEN_LIMIT.toLocaleString()} tokens
            </span>
            <span
              className={
                tokenStatus.exceedsNano ? 'font-medium text-sky-700' : 'text-emerald-700'
              }
            >
              {tokenStatus.exceedsNano ? 'Cloud Fallback (> 9,216)' : 'Fits Gemini Nano'}
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
      </section>

      {/* Output Card */}
      {outputState && (
        <OutputCard
          promptTitle={outputState.promptTitle}
          isRunning={outputState.isRunning}
          downloadProgress={downloadProgress}
          outputText={outputState.outputText}
          inferenceSource={outputState.inferenceSource}
          error={outputState.error}
          onClose={() => setOutputState(null)}
        />
      )}

      {/* Prompt Library */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">
            Prompt Library
          </h2>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1 rounded-full bg-[#1D1D1F] px-3 py-1 text-[11px] font-medium text-white transition hover:bg-black"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Prompt</span>
          </button>
        </div>

        {prompts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/12 bg-white/70 p-6 text-center text-[12px] text-neutral-500">
            No saved prompts yet. Click <strong>New Prompt</strong> to create your first one.
          </div>
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {prompts.map((prompt, index) => (
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

                <div className="mt-2 flex items-center justify-end gap-1 border-t border-black/5 pt-1.5">
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
                    disabled={index === prompts.length - 1}
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
              </article>
            ))}
          </div>
        )}
      </section>

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
