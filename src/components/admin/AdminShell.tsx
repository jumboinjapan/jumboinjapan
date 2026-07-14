'use client'

import { useEffect, useState } from 'react'
import { LogOut, Moon, Sun } from 'lucide-react'

import { AdminWorkspaceNav, type AdminWorkspacePath } from './AdminWorkspaceNav'
import { cn } from '@/lib/utils'

interface AdminShellProps {
  currentPath: AdminWorkspacePath
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
  maxWidth?: string
}

type AdminTheme = 'night' | 'day'

const THEME_STORAGE_KEY = 'jij-admin-theme'

export function AdminShell({
  currentPath,
  title,
  subtitle,
  actions,
  children,
  maxWidth = 'max-w-7xl',
}: AdminShellProps) {
  // Night is the default (matches the :root fallback in globals.css, so the
  // first paint before hydration is already correct for night users).
  const [theme, setTheme] = useState<AdminTheme>('night')

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'day' || stored === 'night') setTheme(stored)
  }, [])

  function toggleTheme() {
    const next: AdminTheme = theme === 'night' ? 'day' : 'night'
    setTheme(next)
    window.localStorage.setItem(THEME_STORAGE_KEY, next)
  }

  return (
    <div data-admin-theme={theme} className="min-h-screen bg-[var(--adm-bg)] flex flex-col text-[var(--adm-text)]">
      {/* Top fixed header bar — flush to viewport edge */}
      <header className="h-14 bg-[var(--adm-bg)] border-b border-[var(--adm-border)] px-6 flex items-center flex-shrink-0 z-50">
        {/* Left: wordmark */}
        <div className="flex items-center gap-4 pr-8">
          <div className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--adm-accent-text)]">JUMBO IN JAPAN</div>
          <div className="h-4 w-px bg-[var(--adm-active)]" />
          <div className="text-xs font-medium tracking-[0.08em] text-[var(--adm-text-3)]">Админ-панель</div>
        </div>

        {/* Center nav pills */}
        <div className="flex-1 flex justify-center">
          <AdminWorkspaceNav currentPath={currentPath} />
        </div>

        {/* Far right: theme toggle + logout */}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex size-9 items-center justify-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] hover:bg-[var(--adm-active)] hover:border-[var(--adm-border-strong)] transition-all active:scale-95"
            aria-label={theme === 'night' ? 'Дневная тема' : 'Ночная тема'}
            title={theme === 'night' ? 'Дневная тема' : 'Ночная тема'}
          >
            {theme === 'night' ? (
              <Sun className="size-4 text-[var(--adm-text-2)]" />
            ) : (
              <Moon className="size-4 text-[var(--adm-text-2)]" />
            )}
          </button>
          {/* ВАЖНО: обычный <a>, НЕ next/link. Link префетчится, префетч
              logout-роута убивал сессию через секунды после каждого рендера
              админки (инцидент «умирающие сессии» 2026-07-14). */}
          <a
            href="/api/admin/auth/logout"
            className="flex size-9 items-center justify-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] hover:bg-[var(--adm-active)] hover:border-[var(--adm-border-strong)] transition-all active:scale-95"
            aria-label="Выйти"
          >
            <LogOut className="size-4 text-[var(--adm-text-2)]" />
          </a>
        </div>
      </header>

      {/* Main content area with page header strip */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Page header strip */}
        <div className="px-6 py-5 border-b border-[var(--adm-border)] bg-[var(--adm-bg)] flex-shrink-0">
          <div className={cn('mx-auto flex items-center justify-between gap-8', maxWidth)}>
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--adm-text)]">{title}</h1>
              {subtitle && (
                <p className="mt-1.5 text-sm text-[var(--adm-text-3)] max-w-md">{subtitle}</p>
              )}
            </div>

            {actions && (
              <div className="flex items-center gap-3 flex-shrink-0">
                {actions}
              </div>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-auto bg-[var(--adm-bg)]">
          <div className={cn('mx-auto px-6 pb-12 pt-2', maxWidth)}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
