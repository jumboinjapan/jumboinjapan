import Link from 'next/link'

import { cn } from '@/lib/utils'

const adminNavItems = [
  { href: '/admin', label: 'Workspace' },
  { href: '/admin/resources', label: 'Resources Library' },
  { href: '/admin/route-stops', label: 'Route Stops' },
  { href: '/admin/multi-day', label: 'Multi-Day Builder' },
  { href: '/admin/mission-control', label: 'Mission Control' },
  { href: '/admin/seo-llm', label: 'Editorial' },
] as const

export type AdminWorkspacePath = (typeof adminNavItems)[number]['href']

export function AdminWorkspaceNav({ currentPath }: { currentPath: AdminWorkspacePath }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {adminNavItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'inline-flex h-9 items-center justify-center rounded-full border px-3.5 text-sm transition',
            item.href === currentPath
              ? 'border-white/16 bg-white/[0.10] text-white'
              : 'border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/14 hover:bg-white/[0.07] hover:text-white',
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}
