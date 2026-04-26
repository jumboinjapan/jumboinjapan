'use client'

import Link from 'next/link'
import { LogOut } from 'lucide-react'

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

export function AdminShell({
  currentPath,
  title,
  subtitle,
  actions,
  children,
  maxWidth = 'max-w-7xl',
}: AdminShellProps) {
  return (
    <div className="min-h-screen bg-[#07101c] flex flex-col text-white">
      {/* Top fixed header bar — flush to viewport edge */}
      <header className="h-14 bg-[#07101c] border-b border-white/8 px-6 flex items-center flex-shrink-0 z-50">
        {/* Left: wordmark */}
        <div className="flex items-center gap-2.5 pr-8">
          <div className="text-[10px] font-medium uppercase tracking-[0.5px] text-slate-400">JUMBO IN JAPAN</div>
          <div className="text-sm font-medium text-white">Админ-панель</div>
        </div>

        {/* Center nav pills */}
        <div className="flex-1 flex justify-center">
          <AdminWorkspaceNav currentPath={currentPath} />
        </div>

        {/* Far right: logout */}
        <Link
          href="/api/admin/auth/logout"
          className="ml-auto flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-all active:scale-95"
          aria-label="Sign out"
        >
          <LogOut className="size-4 text-slate-300" />
        </Link>
      </header>

      {/* Main content area with page header strip */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Page header strip */}
        <div className="px-6 py-5 border-b border-white/8 bg-[#07101c] flex-shrink-0">
          <div className={cn('mx-auto flex items-center justify-between gap-8', maxWidth)}>
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-white">{title}</h1>
              {subtitle && (
                <p className="mt-1.5 text-sm text-slate-400 max-w-md">{subtitle}</p>
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
        <div className="flex-1 overflow-auto bg-[#07101c]">
          <div className={cn('mx-auto px-6 pb-12 pt-2', maxWidth)}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
