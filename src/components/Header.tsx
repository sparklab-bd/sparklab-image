import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

const SPARK_APPS = [
  { name: 'Spark Office', href: '#' },
  { name: 'Spark PDF', href: '#' },
  { name: 'Spark Image', href: '#', current: true },
  { name: 'Spark Studio', href: '#' },
];

export const Header: React.FC = () => {
  const { isInstalled, isIOS, install } = usePWAInstall();
  const [appsOpen, setAppsOpen] = useState(false);
  const [guideMode, setGuideMode] = useState<'none' | 'ios' | 'desktop'>('none');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAppsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAppsOpen(false);
        setGuideMode('none');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleInstallClick = async () => {
    const result = await install();
    if (result === 'ios-guide') {
      setGuideMode('ios');
    } else if (result === 'manual-guide') {
      setGuideMode(isIOS ? 'ios' : 'desktop');
    }
  };

  return (
    <>
      <header className="w-full border-b border-[#E2E8F0] bg-white/95 backdrop-blur-sm dark:border-slate-800 dark:bg-[#0B1120]/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          {/* Header Left: Clean rounded-square Indigo icon with SI + white sparkle dot + bold wordmark */}
          <a
            href="/"
            className="flex items-center gap-3 whitespace-nowrap shrink-0 text-[#0F172A] dark:text-white"
            aria-label="Spark Image Home"
          >
            <svg
              width="38"
              height="38"
              viewBox="0 0 64 64"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              className="shrink-0"
            >
              <rect x="2" y="2" width="60" height="60" rx="14" fill="#6366F1" />
              <text
                x="30"
                y="42"
                textAnchor="middle"
                fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
                fontSize="27"
                fontWeight="800"
                letterSpacing="-1"
                fill="#FFFFFF"
              >
                SI
              </text>
              <circle cx="49" cy="15" r="3.5" fill="#FFFFFF" />
            </svg>
            <span className="text-xl font-bold tracking-tight">Spark Image</span>
          </a>

          {/* Header Right: Apps ▾ pill dropdown + Install App button */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setAppsOpen((prev) => !prev)}
                aria-expanded={appsOpen}
                aria-haspopup="menu"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2 text-sm font-semibold text-[#0F172A] transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <span>Apps</span>
                <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              </button>

              {appsOpen && (
                <div
                  role="menu"
                  aria-label="Spark Apps"
                  className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-[#E2E8F0] bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                >
                  {SPARK_APPS.map((app) => (
                    <a
                      key={app.name}
                      role="menuitem"
                      href={app.href}
                      onClick={() => setAppsOpen(false)}
                      className={`flex min-h-[44px] items-center justify-between rounded-lg px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                        app.current
                          ? 'bg-[#6366F1]/10 text-[#6366F1] dark:bg-[#6366F1]/20 dark:text-indigo-300'
                          : 'text-[#0F172A] hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{app.name}</span>
                      {app.current && <span className="text-xs font-semibold">Current</span>}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {!isInstalled && (
              <button
                type="button"
                onClick={handleInstallClick}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#6366F1] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-600 active:scale-[0.98] whitespace-nowrap shrink-0"
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Install App</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Install App Guide Modal (iOS Safari 2-line guide or Browser Menu fallback) */}
      {guideMode !== 'none' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-guide-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          onClick={() => setGuideMode('none')}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="install-guide-title" className="text-lg font-bold text-[#0F172A] dark:text-white">
                {guideMode === 'ios' ? 'Install on iPhone / iPad Safari' : 'Install Spark Image'}
              </h2>
              <button
                type="button"
                onClick={() => setGuideMode('none')}
                aria-label="Close install guide"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {guideMode === 'ios' ? (
              <div className="mt-3 space-y-2 text-base text-slate-700 dark:text-slate-300">
                <p>1. Tap the Share button in Safari&apos;s toolbar.</p>
                <p>2. Scroll down and tap &ldquo;Add to Home Screen&rdquo;.</p>
              </div>
            ) : (
              <div className="mt-3 space-y-2 text-base text-slate-700 dark:text-slate-300">
                <p>1. Open your browser&apos;s address bar or menu icon.</p>
                <p>2. Click &ldquo;Install Spark Image&rdquo; or &ldquo;Add to Home Screen&rdquo; (on iOS Safari: Share → Add to Home Screen).</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setGuideMode('none')}
              className="mt-6 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[#6366F1] px-4 py-2.5 text-base font-semibold text-white hover:bg-indigo-600"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
