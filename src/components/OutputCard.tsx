import { useState } from 'react';
import Markdown from 'react-markdown';
import { ArrowLeft, Check, Copy, Cpu, Info, Loader2, RotateCcw, AlertCircle } from 'lucide-react';
import { resolveInferenceBadge } from '../lib/ai';

interface OutputCardProps {
  promptTitle: string;
  pageTitle?: string;
  isRunning: boolean;
  downloadProgress: number | null;
  outputText: string;
  inferenceSource: string | undefined;
  notice?: string | null;
  needsLocalWarmup?: boolean;
  isWarmingLocalAi?: boolean;
  elapsedMs: number | null;
  error: string | null;
  onWarmUpLocalAi?: () => void;
  onRegenerate: () => void;
  onBack: () => void;
}

export function OutputCard({
  promptTitle,
  pageTitle,
  isRunning,
  downloadProgress,
  outputText,
  inferenceSource,
  notice,
  needsLocalWarmup,
  isWarmingLocalAi,
  elapsedMs,
  error,
  onWarmUpLocalAi,
  onRegenerate,
  onBack,
}: OutputCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!outputText) return;
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const badge = inferenceSource ? resolveInferenceBadge(inferenceSource) : null;
  const formattedTime = elapsedMs !== null ? `${(elapsedMs / 1000).toFixed(1)}s` : null;

  return (
    <section className="rounded-2xl border border-black/8 bg-white p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div className="mb-3 flex items-center justify-between border-b border-black/5 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-medium text-[#0071E3] transition hover:bg-[#0071E3]/8"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Prompts</span>
        </button>

        {isRunning && formattedTime && (
          <span className="inline-flex items-center rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[11px] font-medium tabular-nums text-neutral-600">
            {formattedTime}...
          </span>
        )}
      </div>

      <div className="mb-2.5">
        <p className="truncate text-[14px] font-semibold text-[#1D1D1F]">{promptTitle}</p>
        {pageTitle && (
          <p className="mt-0.5 truncate text-[11px] text-neutral-500">On: {pageTitle}</p>
        )}
        {badge && !error && (
          <span
            className={`mt-1.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              badge.kind === 'on-device'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
            }`}
          >
            {badge.label}
            {!isRunning && formattedTime ? ` • ${formattedTime}` : ''}
          </span>
        )}
      </div>

      {isRunning && !outputText && (
        <div className="flex items-center gap-2.5 rounded-xl bg-[#F5F5F7] px-3 py-3 text-[12px] text-neutral-600">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0071E3]" />
          <span>
            {downloadProgress !== null && downloadProgress < 1
              ? `Preparing local AI model (${Math.round(downloadProgress * 100)}%)...`
              : 'Generating response...'}
          </span>
        </div>
      )}

      {!isRunning && error && (
        <div className="space-y-2.5">
          {needsLocalWarmup ? (
            <div className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
              <div className="flex items-start gap-2">
                <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <span>{error}</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5 pt-0.5">
                {onWarmUpLocalAi && (
                  <button
                    type="button"
                    disabled={isWarmingLocalAi}
                    onClick={onWarmUpLocalAi}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#1D1D1F] px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-black disabled:opacity-60"
                  >
                    <Cpu className="h-3.5 w-3.5" />
                    <span>{isWarmingLocalAi ? 'Warming Up...' : 'Warm Up Local AI'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-[#1D1D1F] ring-1 ring-black/10 transition hover:bg-neutral-50"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-neutral-500" />
                  <span>Try Again</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[12px] text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-3 py-1.5 text-[12px] font-medium text-[#1D1D1F] transition hover:bg-neutral-200/80"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-neutral-500" />
                  <span>Try Again</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!error && outputText && (
        <>
          {notice && (
            <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50/70 px-2.5 py-2 text-[11px] leading-snug text-amber-900">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
              <span>{notice}</span>
            </div>
          )}
          <div className="markdown-output max-h-[60vh] overflow-y-auto pr-1">
            <Markdown>{outputText}</Markdown>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-black/5 pt-2.5">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
                <Loader2 className="h-3 w-3 animate-spin text-[#0071E3]" />
                <span>Streaming...</span>
              </span>
            ) : (
              <span />
            )}
            {!isRunning && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={onRegenerate}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-3 py-1.5 text-[12px] font-medium text-[#1D1D1F] transition hover:bg-neutral-200/80 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-neutral-500" />
                  <span>Regenerate</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#0077ED]"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy Result</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
