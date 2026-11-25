import { useState, type FormEvent } from 'react';
import { Cloud, Loader2, LogOut, RefreshCw, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import { isFirebaseConfigured } from '../lib/firebase';
import { formatAuthError, signInWithEmail, signOutUser, signUpWithEmail } from '../lib/sync';

interface AuthModalProps {
  user: User | null;
  isSyncing: boolean;
  onSyncNow: () => Promise<void>;
  onClose: () => void;
}

export function AuthModal({ user, isSyncing, onSyncNow, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
      }
      onClose();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setSubmitting(true);
    try {
      await signOutUser();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-black/8 bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-[#0071E3]" />
            <h2 className="text-[15px] font-semibold text-[#1D1D1F]">Account &amp; Prompt Sync</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account and prompt sync modal"
            className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!isFirebaseConfigured ? (
          <p className="rounded-xl bg-amber-50 p-3 text-[12px] text-amber-800">
            Firebase credentials are not configured in <code className="font-mono">.env</code>. Local Gemini Nano 4 works offline—add <code className="font-mono">.env</code> keys to enable Gemini Cloud fallback and Prompt Sync.
          </p>
        ) : user ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-[#F5F5F7] p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Signed in as
              </p>
              <p className="mt-0.5 truncate text-[13px] font-medium text-[#1D1D1F]">
                {user.email}
              </p>
              <p className="mt-1 text-[11px] text-neutral-500">
                Your favorite prompts automatically sync to Cloud Firestore.
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => void onSyncNow()}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-3.5 py-1.5 text-[12px] font-medium text-[#1D1D1F] transition hover:bg-neutral-200 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSignOut()}
                className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3.5 py-1.5 text-[12px] font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-60"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-neutral-500">
              Sign in optionally to back up and sync your favorite prompts across devices.
            </p>

            <div className="grid grid-cols-2 rounded-xl bg-[#F5F5F7] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                }}
                className={`rounded-lg py-1.5 text-[12px] font-medium transition ${
                  mode === 'signin'
                    ? 'bg-white text-[#1D1D1F] shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setError(null);
                }}
                className={`rounded-lg py-1.5 text-[12px] font-medium transition ${
                  mode === 'signup'
                    ? 'bg-white text-[#1D1D1F] shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                Sign Up
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-2.5">
              <div>
                <label htmlFor="auth-email" className="mb-1 block text-[12px] font-medium text-neutral-600">
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-black/12 bg-[#F5F5F7]/60 px-3 py-2 text-[13px] outline-none transition focus:border-[#0071E3] focus:bg-white"
                />
              </div>

              <div>
                <label htmlFor="auth-password" className="mb-1 block text-[12px] font-medium text-neutral-600">
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full rounded-xl border border-black/12 bg-[#F5F5F7]/60 px-3 py-2 text-[13px] outline-none transition focus:border-[#0071E3] focus:bg-white"
                />
              </div>

              {error && <p className="text-[12px] text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-3.5 py-1.5 text-[12px] font-medium text-neutral-600 transition hover:bg-neutral-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#0077ED] disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
