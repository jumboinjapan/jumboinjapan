import Link from 'next/link'

import { cn } from '@/lib/utils'

const adminNavItems = [
  { href: '/admin', label: 'Workspace' },
  { href: '/admin/resources', label: 'Resources Library' },
  { href: '/admin/route-stops', label: 'Route Stops' },
  { href: '/admin/multi-day', label: 'Multi-Day Builder' },
  { href: '/admin/seo-llm', label: 'Editorial' },
] as const

export type AdminWorkspacePath = (typeof adminNavItems)[number]['href']

export function AdminWorkspaceNav({ currentPath }: { currentPath: AdminWorkspacePath }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {adminNavItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'inline-flex min-h-10 items-center justify-center rounded-full border px-3.5 text-sm transition',
            item.href === currentPath
              ? 'border-white/14 bg-white/[0.08] text-white'
              : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/16 hover:bg-white/[0.06] hover:text-white',
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}
