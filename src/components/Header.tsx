import React, { useEffect, useState } from 'react';
import { Moon, Sun, Sparkles } from 'lucide-react';

interface HeaderProps {
  page: 'chat' | 'insights';
  onNavigate: (page: 'chat' | 'insights') => void;
  apiBase?: string;
}

type Theme = 'light' | 'dark';
type Backend = 'checking' | 'online' | 'offline';

/** Three converging paths with distinct vibrant hues */
export const LogoMark: React.FC<{ size?: number }> = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
    <rect width="32" height="32" rx="9" fill="url(#logo-grad)" />
    <defs>
      <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="50%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <path d="M7 9 C14 9 14 16 22 16" stroke="#22d3ee" strokeWidth="2.8" strokeLinecap="round" fill="none" />
    <path d="M7 16 H22" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" fill="none" />
    <path d="M7 23 C14 23 14 16 22 16" stroke="#fbbf24" strokeWidth="2.8" strokeLinecap="round" fill="none" />
    <circle cx="23.5" cy="16" r="2.8" fill="#ffffff" />
  </svg>
);

function readTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export const Header: React.FC<HeaderProps> = ({ page, onNavigate, apiBase = '' }) => {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [backend, setBackend] = useState<Backend>('checking');

  // Real backend status from GET /health, refreshed every 20 seconds
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`${apiBase}/health`);
        if (alive) setBackend(res.ok ? 'online' : 'offline');
      } catch {
        if (alive) setBackend('offline');
      }
    };
    check();
    const timer = window.setInterval(check, 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [apiBase]);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('adaptirag-theme', next);
    } catch {
      /* storage can be blocked; the theme still changes for this visit */
    }
    setTheme(next);
  };

  const tabs: { id: string; key: 'chat' | 'insights'; label: string; short?: string; icon?: React.ReactNode }[] = [
    { id: 'nav-chat-btn', key: 'chat', label: 'Ask Documents', short: 'Ask' },
    { id: 'nav-insights-btn', key: 'insights', label: 'Efficiency & Chunks', short: 'Analytics' }
  ];

  const statusText =
    backend === 'online' ? 'Backend Live' : backend === 'offline' ? 'Offline' : 'Checking';

  return (
    <header className="sticky top-0 z-40 h-16 shrink-0 border-b border-[var(--border-glass)] bg-surface/85 backdrop-blur-md shadow-sm transition-colors">
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-8">
        
        {/* Brand identity */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-solid/80 p-1.5 shadow-sm border border-line-strong transition-transform hover:scale-105">
            <LogoMark />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[19px] font-extrabold tracking-tight brand-gradient-text">
                AdaptiRAG
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent border border-accent/20">
                <Sparkles className="h-2.5 w-2.5" />
                Hybrid AI
              </span>
            </div>
          </div>
        </div>

        {/* Center pill navigation */}
        <nav className="flex items-center gap-1 rounded-full border border-line-strong bg-surface-2/80 p-1 shadow-inner backdrop-blur-sm" aria-label="Main">
          {tabs.map(t => {
            const active = page === t.key;
            return (
              <button
                key={t.key}
                id={t.id}
                onClick={() => onNavigate(t.key)}
                aria-current={active ? 'page' : undefined}
                className={`relative rounded-full px-4 py-1.5 text-xs sm:text-sm font-semibold tracking-wide transition-all duration-200 whitespace-nowrap ${
                  active
                    ? 'brand-btn text-white shadow-md'
                    : 'text-muted hover:text-ink hover:bg-surface-3/50'
                }`}
              >
                <span className="sm:hidden">{t.short || t.label}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right actions: Status pill + Glass Theme Switcher */}
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center gap-2 rounded-full border border-line bg-surface-2/70 px-3 py-1.5 text-xs font-medium text-muted backdrop-blur-sm"
            role="status"
            aria-live="polite"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                backend === 'online'
                  ? 'bg-ok status-live'
                  : backend === 'offline'
                    ? 'bg-bad'
                    : 'bg-faint'
              }`}
            />
            <span className="hidden sm:inline text-ink-2 font-medium">{statusText}</span>
          </div>

          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong bg-surface-2/80 text-muted transition-all hover:bg-surface-3 hover:text-ink hover:scale-105 shadow-sm"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-700" />}
          </button>
        </div>

      </div>
    </header>
  );
};
