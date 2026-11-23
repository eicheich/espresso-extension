import { useState, type FormEvent } from 'react';
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
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !instruction.trim()) {
      setError('Both Title and Prompt Instruction are required.');
      return;
    }
    onSave({
      title: title.trim(),
      category: category.trim(),
      instruction: instruction.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-black/8 bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[#1D1D1F]">
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

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="prompt-title" className="mb-1 block text-[12px] font-medium text-neutral-600">
              Title
            </label>
            <input
              id="prompt-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Actionable Bug Report"
              className="w-full rounded-xl border border-black/12 bg-[#F5F5F7]/60 px-3 py-2 text-[13px] text-[#1D1D1F] outline-none transition focus:border-[#0071E3] focus:bg-white"
            />
          </div>

          <div>
            <label htmlFor="prompt-category" className="mb-1 block text-[12px] font-medium text-neutral-600">
              Category (optional)
            </label>
            <input
              id="prompt-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., Writing, Research, Engineering"
              className="w-full rounded-xl border border-black/12 bg-[#F5F5F7]/60 px-3 py-2 text-[13px] text-[#1D1D1F] outline-none transition focus:border-[#0071E3] focus:bg-white"
            />
          </div>

          <div>
            <label htmlFor="prompt-instruction" className="mb-1 block text-[12px] font-medium text-neutral-600">
              Prompt Instruction
            </label>
            <textarea
              id="prompt-instruction"
              rows={4}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Describe what you want Gemini to do with the selected text or webpage..."
              className="w-full resize-none rounded-xl border border-black/12 bg-[#F5F5F7]/60 px-3 py-2 text-[13px] text-[#1D1D1F] outline-none transition focus:border-[#0071E3] focus:bg-white"
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
              className="rounded-full bg-[#0071E3] px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#0077ED]"
            >
              {initial ? 'Save Changes' : 'Create Prompt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
