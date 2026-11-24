import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface PrivacyTermsModalProps {
  open: boolean;
  onClose: () => void;
}

export const PrivacyTermsModal: React.FC<PrivacyTermsModalProps> = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="legal-modal-title" className="text-xl font-bold text-[#0F172A] dark:text-white">
            Privacy &amp; Terms
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Privacy and Terms"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-base text-slate-700 dark:text-slate-300">
          <div>
            <h3 className="font-semibold text-[#0F172A] dark:text-white">1. Zero Data Collection</h3>
            <p className="mt-1 text-sm leading-relaxed">
              Spark Image runs 100% locally in your browser using HTML5 Canvas. Your images never leave your device,
              are never uploaded to any server, and zero analytics, cookies, or tracking scripts are used.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[#0F172A] dark:text-white">2. &ldquo;AS-IS&rdquo; Disclaimer</h3>
            <p className="mt-1 text-sm leading-relaxed">
              This software is provided &ldquo;AS-IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; without warranties of any kind,
              express or implied, including fitness for a particular purpose or non-infringement. Always keep backups
              of your original files.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[#0F172A] dark:text-white">3. $0 Liability Cap</h3>
            <p className="mt-1 text-sm leading-relaxed">
              To the maximum extent permitted by applicable law, Spark Lab and its contributors shall have zero
              liability (capped at $0.00 USD) for any direct, indirect, incidental, or consequential damages arising
              from the use or inability to use this tool.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[#6366F1] px-4 py-2.5 text-base font-semibold text-white hover:bg-indigo-600"
        >
          Close
        </button>
      </div>
    </div>
  );
};
