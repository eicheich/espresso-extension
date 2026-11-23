import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { PromptItem } from '../lib/prompts';

interface PromptFormModalProps {
  initial?: PromptItem | null;
  onSave: (values: { title: string; category: string; instruction: string }) => void;
  onClose: () => void;
}

export function PromptFormModal({ initial, onSave, onClose }: PromptFormModalProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [instruction, setInstruction] = useState(initial?.instruction ?? '');
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; instruction?: string }>({});

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: { title?: string; instruction?: string } = {};
    if (!title.trim()) {
      nextErrors.title = 'Enter a short name for this prompt.';
    }
    if (!instruction.trim()) {
      nextErrors.instruction = 'Enter the instruction Espresso should run on the page.';
    }
    if (nextErrors.title || nextErrors.instruction) {
      setFieldErrors(nextErrors);
      return;
    }
    onSave({
      title: title.trim(),
      category: category.trim(),
      instruction: instruction.trim(),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-2.5 backdrop-blur-[2px] sm:items-center"
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-black/8 bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="prompt-modal-title" className="text-[15px] font-semibold text-[#1D1D1F]">
            {initial ? 'Edit Prompt' : 'New Prompt'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          <div>
            <label htmlFor="prompt-title" className="mb-1 block text-[12px] font-medium text-neutral-700">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="prompt-title"
              type="text"
              autoFocus
              value={title}
              aria-invalid={Boolean(fieldErrors.title)}
              aria-describedby={fieldErrors.title ? 'prompt-title-error' : undefined}
              onChange={(e) => {
                setTitle(e.target.value);
                if (fieldErrors.title) setFieldErrors((prev) => ({ ...prev, title: undefined }));
              }}
              placeholder="e.g., Summarize for a busy teammate"
              className={`w-full rounded-xl border bg-[#F5F5F7]/60 px-3 py-2 text-[13px] text-[#1D1D1F] outline-none transition focus:bg-white ${
                fieldErrors.title
                  ? 'border-red-400 focus:border-red-500'
                  : 'border-black/12 focus:border-[#0071E3]'
              }`}
            />
            {fieldErrors.title && (
              <p id="prompt-title-error" className="mt-1 text-[11px] text-red-600">
                {fieldErrors.title}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="prompt-category" className="mb-1 block text-[12px] font-medium text-neutral-700">
              Category <span className="font-normal text-neutral-400">(optional)</span>
            </label>
            <input
              id="prompt-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., Study, Work, Writing, Engineering"
              className="w-full rounded-xl border border-black/12 bg-[#F5F5F7]/60 px-3 py-2 text-[13px] text-[#1D1D1F] outline-none transition focus:border-[#0071E3] focus:bg-white"
            />
          </div>

          <div>
            <label htmlFor="prompt-instruction" className="mb-1 block text-[12px] font-medium text-neutral-700">
              Prompt Instruction <span className="text-red-500">*</span>
            </label>
            <textarea
              id="prompt-instruction"
              rows={4}
              value={instruction}
              aria-invalid={Boolean(fieldErrors.instruction)}
              aria-describedby={fieldErrors.instruction ? 'prompt-instruction-error' : undefined}
              onChange={(e) => {
                setInstruction(e.target.value);
                if (fieldErrors.instruction) {
                  setFieldErrors((prev) => ({ ...prev, instruction: undefined }));
                }
              }}
              placeholder="Tell Espresso what to do with the webpage or highlighted text..."
              className={`w-full resize-none rounded-xl border bg-[#F5F5F7]/60 px-3 py-2 text-[13px] text-[#1D1D1F] outline-none transition focus:bg-white ${
                fieldErrors.instruction
                  ? 'border-red-400 focus:border-red-500'
                  : 'border-black/12 focus:border-[#0071E3]'
              }`}
            />
            {fieldErrors.instruction && (
              <p id="prompt-instruction-error" className="mt-1 text-[11px] text-red-600">
                {fieldErrors.instruction}
              </p>
            )}
          </div>

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
              className="rounded-full bg-[#0071E3] px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#0077ED]"
            >
              {initial ? 'Save Changes' : 'Save Prompt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
