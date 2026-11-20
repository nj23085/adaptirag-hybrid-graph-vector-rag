import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

interface HeaderProps {
  page: 'chat' | 'insights';
  onNavigate: (page: 'chat' | 'insights') => void;
  apiBase?: string;
}

type Theme = 'light' | 'dark';
type Backend = 'checking' | 'online' | 'offline';

/** Three coloured paths (local, global, hybrid) converging into one answer. */
export const LogoMark: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="var(--ink)" />
    <path d="M6 8 C14 8 14 16 22 16" stroke="#14b8a6" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    <path d="M6 16 H22" stroke="#818cf8" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    <path d="M6 24 C14 24 14 16 22 16" stroke="#fbbf24" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    <circle cx="24" cy="16" r="3" fill="var(--bg)" />
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

  const tabs: { id: string; key: 'chat' | 'insights'; label: string; short?: string }[] = [
    { id: 'nav-chat-btn', key: 'chat', label: 'Ask' },
    { id: 'nav-insights-btn', key: 'insights', label: 'Efficiency & chunks', short: 'Efficiency' }
  ];

  const statusText =
    backend === 'online' ? 'Backend online' : backend === 'offline' ? 'Backend offline' : 'Checking backend';

  return (
    <header className="sticky top-0 z-30 h-14 shrink-0 border-b border-line bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[17px] font-semibold tracking-tight text-ink">AdaptiRAG</span>
        </div>

        <nav className="ml-2 flex h-full items-stretch gap-1 sm:ml-6" aria-label="Main">
          {tabs.map(t => (
            <button
              key={t.key}
              id={t.id}
              onClick={() => onNavigate(t.key)}
              aria-current={page === t.key ? 'page' : undefined}
              className={`relative flex items-center whitespace-nowrap px-2.5 text-sm font-medium transition-colors sm:px-3.5 ${page === t.key ? 'text-ink' : 'text-muted hover:text-ink'
                }`}
            >
              {t.short ? (
                <>
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </>
              ) : (
                t.label
              )}
              {page === t.key && (
                <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-ink sm:inset-x-3.5" />
              )}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <div
            className="flex items-center gap-2 rounded-full px-2.5 py-1 text-xs text-muted"
            role="status"
            aria-live="polite"
          >
            <span
              className={`h-2 w-2 rounded-full ${backend === 'online'
                  ? 'bg-ok status-live'
                  : backend === 'offline'
                    ? 'bg-bad'
                    : 'bg-faint'
                }`}
            />
            <span className="hidden sm:inline">{statusText}</span>
          </div>
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>
    </header>
  );
};