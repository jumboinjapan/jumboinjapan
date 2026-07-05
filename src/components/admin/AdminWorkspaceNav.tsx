import Link from 'next/link'

import { cn } from '@/lib/utils'

const adminNavItems = [
  { href: '/admin', label: 'Workspace' },
  { href: '/admin/clients', label: 'Clients' },
  { href: '/admin/resources', label: 'Resources Library' },
  { href: '/admin/route-stops', label: 'Route Stops' },
  { href: '/admin/multi-day', label: 'Multi-Day Builder' },
  { href: '/admin/seo-llm', label: 'Editorial' },
  { href: '/admin/route-text', label: 'Route Texts' },
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
              ? 'border-[var(--adm-border-strong)] bg-[var(--adm-active)] text-[var(--adm-text)]'
              : 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-3)] hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)]',
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}
