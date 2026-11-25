import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { LocalAiDiagnostics } from '../lib/ai';

interface NanoSetupGuideProps {
  diagnostics: LocalAiDiagnostics;
  isWarming: boolean;
  isPrewarming?: boolean;
  isWarmCached?: boolean;
  downloadProgress: number | null;
  setupError?: string | null;
  onCheckStatus: () => void;
  onDownloadModel: () => void;
  onOpenChromeUrl: (url: string) => void;
  onSkip: () => void;
}

const FLAG_ITEMS = [
  {
    id: 'prompt-api',
    label: 'Prompt API for Gemini Nano',
    setting: 'Enabled',
    highlight: false,
    note: 'If not highlighted, search prompt-api-for-gemini-nano',
    url: 'chrome://flags/#prompt-api-for-gemini-nano-multimodal-input',
  },
  {
    id: 'optimization-guide',
    label: 'On-Device Model Performance',
    setting: 'Enabled BypassPerfRequirement',
    highlight: true,
    note: 'Choose BypassPerfRequirement (not plain Enabled)',
    url: 'chrome://flags/#optimization-guide-on-device-model',
  },
] as const;

const COMPONENTS_URL = 'chrome://components';

export function NanoSetupGuide({
  diagnostics,
  isWarming,
  isPrewarming = false,
  isWarmCached = false,
  downloadProgress,
  setupError,
  onCheckStatus,
  onDownloadModel,
  onOpenChromeUrl,
  onSkip,
}: NanoSetupGuideProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(false);

  const handleCopy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 1600);
    } catch {
      // Ignore clipboard failures in restricted contexts.
    }
  };

  const downloadPercent =
    downloadProgress !== null ? Math.min(100, Math.max(0, Math.round(downloadProgress * 100))) : null;

  const steps = [
    {
      num: 1,
      label: 'Chrome Flags',
      state: diagnostics.status === 'flags-required' ? 'active' : 'done',
    },
    {
      num: 2,
      label: 'Download Model',
      state:
        diagnostics.status === 'ready'
          ? 'done'
          : diagnostics.status === 'downloadable' || diagnostics.status === 'downloading'
            ? 'active'
            : 'pending',
    },
    {
      num: 3,
      label: 'Ready',
      state: diagnostics.status === 'ready' ? 'done' : 'pending',
    },
  ] as const;

  const renderFlagList = () => (
    <div className="space-y-2">
      {FLAG_ITEMS.map((flag) => (
        <div key={flag.id} className="rounded-lg border border-black/8 bg-white p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-[11.5px] font-semibold text-[#1D1D1F]">{flag.label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                flag.highlight
                  ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                  : 'bg-[#0071E3]/10 text-[#0071E3]'
              }`}
            >
              {flag.setting}
            </span>
          </div>
          <p className="mt-1 text-[10.5px] text-neutral-500">{flag.note}</p>
          <div className="mt-1.5 flex items-center justify-between gap-1.5">
            <code className="truncate font-mono text-[10px] text-neutral-500">{flag.url}</code>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void handleCopy(flag.id, flag.url)}
                aria-label={`Copy ${flag.label} URL`}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-medium text-neutral-600 transition hover:bg-neutral-100"
              >
                {copiedId === flag.id ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" />
                    <span className="text-emerald-700">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => onOpenChromeUrl(flag.url)}
                className="inline-flex items-center gap-1 rounded-md bg-[#1D1D1F] px-2 py-1 text-[10.5px] font-medium text-white transition hover:bg-black"
              >
                <span>Open</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <section className="rounded-2xl border border-black/8 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#0071E3]/10 text-[#0071E3]">
            <Cpu className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold leading-tight text-[#1D1D1F]">
              {diagnostics.status === 'ready'
                ? 'Gemini Nano 4 Status & Setup'
                : 'Install Gemini Nano 4 in Chrome'}
            </h2>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              Primary on-device AI — private &amp; offline (Gemini Cloud handles fallback)
            </p>
          </div>
        </div>

        {diagnostics.chromeVersion !== null && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              diagnostics.supportsChromeVersion
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
            }`}
          >
            Chrome {diagnostics.chromeVersion}
          </span>
        )}
      </div>

      {/* 3-Step Visual Progress Tracker */}
      <ol
        aria-label="Nano 4 installation progress"
        className="mt-3 grid grid-cols-3 gap-1.5 rounded-xl bg-[#F5F5F7] p-1.5"
      >
        {steps.map((step) => (
          <li
            key={step.num}
            className={`flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 text-[10.5px] font-medium ${
              step.state === 'done'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80'
                : step.state === 'active'
                  ? 'bg-white text-[#1D1D1F] shadow-xs ring-1 ring-black/6'
                  : 'text-neutral-400'
            }`}
          >
            {step.state === 'done' ? (
              <Check className="h-3 w-3 shrink-0 text-emerald-600" />
            ) : (
              <span className="tabular-nums">{step.num}.</span>
            )}
            <span className="truncate">{step.label}</span>
          </li>
        ))}
      </ol>

      {diagnostics.status !== 'ready' && (
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-neutral-600">
          Espresso runs Gemini Nano 4 locally first and uses Gemini Cloud only as fallback. Complete these Chrome steps once for private offline AI.
        </p>
      )}

      {!diagnostics.supportsChromeVersion && (
        <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <span>Chrome Desktop v138 or newer is required for Gemini Nano 4.</span>
        </div>
      )}

      {diagnostics.status === 'ready' && (
        <div className="mt-3 space-y-3">
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-[12px] text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <p className="font-medium">Gemini Nano 4 is Installed &amp; Active</p>
              <p className="mt-0.5 text-[11px] text-emerald-800">
                {isPrewarming || isWarming
                  ? 'Warming up GPU session for instant prompts...'
                  : isWarmCached
                    ? 'Warm session cached in memory — ready for fast responses.'
                    : 'Model is available on-device and ready to warm up.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isWarming || isPrewarming}
            onClick={onDownloadModel}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#F5F5F7] px-4 py-2 text-[12px] font-medium text-[#1D1D1F] transition hover:bg-neutral-200/80 disabled:opacity-60"
          >
            {isWarming || isPrewarming ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0071E3]" />
                <span>Warming Session...</span>
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Re-warm Session</span>
              </>
            )}
          </button>

          <div>
            <button
              type="button"
              onClick={() => setShowReference((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-[#1D1D1F]"
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showReference ? 'rotate-180' : ''}`}
              />
              <span>Chrome Installation Reference (Flags &amp; Components)</span>
            </button>

            {showReference && (
              <div className="mt-2 space-y-2 rounded-xl border border-black/6 bg-[#F5F5F7]/70 p-2.5">
                {renderFlagList()}
                <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-neutral-600">
                  <span className="truncate font-mono text-[10.5px]">{COMPONENTS_URL}</span>
                  <button
                    type="button"
                    onClick={() => onOpenChromeUrl(COMPONENTS_URL)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10.5px] font-medium text-[#1D1D1F] ring-1 ring-black/10 hover:bg-neutral-50"
                  >
                    <span>Open</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {diagnostics.status === 'downloadable' && (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl bg-[#F5F5F7] px-3 py-2.5 text-[12px] leading-relaxed text-neutral-700">
            Chrome flags are active. Click below to download Gemini Nano 4 once (~1.5–2 GB, stored locally on your device).
          </div>

          {isWarming && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-neutral-600">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin text-[#0071E3]" />
                  <span>Downloading Gemini Nano 4...</span>
                </span>
                {downloadPercent !== null && <span className="tabular-nums">{downloadPercent}%</span>}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F5F5F7]">
                <div
                  className="h-full rounded-full bg-[#0071E3] transition-all duration-300"
                  style={{ width: `${downloadPercent ?? 12}%` }}
                />
              </div>
            </div>
          )}

          {setupError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-[11.5px] text-red-700">{setupError}</p>
          )}

          <button
            type="button"
            disabled={isWarming}
            onClick={onDownloadModel}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-[12.5px] font-medium text-white transition hover:bg-[#0077ED] disabled:opacity-60"
          >
            {isWarming ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Preparing Gemini Nano 4...</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                <span>Download &amp; Enable Nano 4</span>
              </>
            )}
          </button>
        </div>
      )}

      {diagnostics.status === 'downloading' && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-sky-50 px-3 py-3 text-[12px] text-sky-900 ring-1 ring-sky-200/80">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0071E3]" />
            <div>
              <p className="font-medium">Gemini Nano 4 is downloading in Chrome</p>
              <p className="mt-0.5 text-[11px] text-sky-800">
                Keep Chrome open. Espresso will switch to Ready automatically once finished.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCheckStatus}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#F5F5F7] px-4 py-2 text-[12px] font-medium text-[#1D1D1F] transition hover:bg-neutral-200/80"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Check Progress</span>
          </button>
        </div>
      )}

      {diagnostics.status === 'flags-required' && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-neutral-500">
            <span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 font-medium text-neutral-700">
              Requires Chrome Desktop v138+
            </span>
            <span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 font-medium text-neutral-700">
              ~22 GB free disk space
            </span>
          </div>

          <ol className="space-y-2 text-[12px] text-neutral-700">
            <li className="rounded-xl bg-[#F5F5F7] p-2.5">
              <p className="mb-2 font-semibold text-[#1D1D1F]">1. Enable both Chrome flags</p>
              {renderFlagList()}
            </li>

            <li className="rounded-xl bg-[#F5F5F7] px-3 py-2">
              <span className="font-semibold text-[#1D1D1F]">2. Relaunch Chrome</span> using the blue button at the bottom-right of Chrome.
            </li>

            <li className="rounded-xl bg-[#F5F5F7] px-3 py-2">
              <span className="font-semibold text-[#1D1D1F]">3. Verify below</span> — Espresso will detect the flags and start the one-time Nano 4 download.
            </li>
          </ol>

          <button
            type="button"
            onClick={onCheckStatus}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-[12.5px] font-medium text-white transition hover:bg-[#0077ED]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Check Status</span>
          </button>

          <div className="space-y-1.5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-2.5 text-[11px] leading-snug text-amber-900">
            <p className="font-semibold">Still not detected after relaunch?</p>
            <p>
              Open <code className="font-mono text-[10.5px]">{COMPONENTS_URL}</code>, find{' '}
              <strong>Optimization Guide On Device Model</strong>, and click{' '}
              <strong>Check for update</strong>.
            </p>
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => onOpenChromeUrl(COMPONENTS_URL)}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10.5px] font-medium text-[#1D1D1F] ring-1 ring-amber-300/80 hover:bg-amber-50"
              >
                <span>Open chrome://components</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleCopy('components', COMPONENTS_URL)}
                className="text-[10.5px] font-medium text-amber-900 underline"
              >
                {copiedId === 'components' ? 'Copied' : 'Copy URL'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-black/5 pt-2.5 text-center">
        <button
          type="button"
          onClick={onSkip}
          className="text-[11px] font-medium text-neutral-500 transition hover:text-[#1D1D1F]"
        >
          {diagnostics.status === 'ready'
            ? 'Back to Prompts'
            : 'Continue with Gemini Cloud for now'}
        </button>
      </div>
    </section>
  );
}
