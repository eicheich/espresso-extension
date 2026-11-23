import { useState } from 'react';
import Markdown from 'react-markdown';
import { Check, Copy, Loader2, X, AlertCircle } from 'lucide-react';
import { resolveInferenceBadge } from '../lib/ai';

interface OutputCardProps {
  promptTitle: string;
  isRunning: boolean;
  downloadProgress: number | null;
  outputText: string;
  inferenceSource: string | undefined;
  error: string | null;
  onClose: () => void;
}

export function OutputCard({
  promptTitle,
  isRunning,
  downloadProgress,
  outputText,
  inferenceSource,
  error,
  onClose,
}: OutputCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!outputText) return;
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const badge = inferenceSource ? resolveInferenceBadge(inferenceSource) : null;

  return (
    <section className="rounded-2xl border border-black/8 bg-white p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-[#1D1D1F]">{promptTitle}</p>
          {badge && !isRunning && !error && (
            <span
              className={`mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                badge.kind === 'on-device'
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                  : 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
              }`}
            >
              {badge.label}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close output"
          className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isRunning && (
        <div className="flex items-center gap-2.5 rounded-xl bg-[#F5F5F7] px-3 py-3 text-[12px] text-neutral-600">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0071E3]" />
          <span>
            {downloadProgress !== null && downloadProgress < 1
              ? `Preparing local Gemini Nano model (${Math.round(downloadProgress * 100)}%)...`
              : 'Running hybrid AI inference...'}
          </span>
        </div>
      )}

      {!isRunning && error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[12px] text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!isRunning && !error && outputText && (
        <>
          <div className="markdown-output max-h-[340px] overflow-y-auto pr-1">
            <Markdown>{outputText}</Markdown>
          </div>
          <div className="mt-3 flex justify-end border-t border-black/5 pt-2.5">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-3 py-1.5 text-[12px] font-medium text-[#1D1D1F] transition hover:bg-neutral-200/80"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-neutral-500" />
                  <span>Copy Result</span>
                </>
              )}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
