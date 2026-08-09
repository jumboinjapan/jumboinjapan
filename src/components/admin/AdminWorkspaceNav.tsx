import Link from 'next/link'

import { cn } from '@/lib/utils'

/* Подпись в меню совпадает с заголовком экрана, на который она ведёт.
   Раньше половина меню была по-английски и почти ни одна пилюля не повторяла
   заголовок: «Workspace» вёл на «Обзор», «Route Texts» — на «Тексты маршрутов».
   Искать глазами приходилось дважды.

   POI, FAQ и API оставлены как есть — это рабочие слова владельца, а не
   недопереведённый интерфейс. */
const adminNavItems = [
  { href: '/admin', label: 'Обзор' },
  { href: '/admin/clients', label: 'Клиенты' },
  { href: '/admin/resources', label: 'Ресурсы' },
  { href: '/admin/route-stops', label: 'Остановки' },
  { href: '/admin/multi-day', label: 'Конструктор' },
  { href: '/admin/seo-llm', label: 'POI' },
  { href: '/admin/route-text', label: 'Описание маршрутов' },
  { href: '/admin/faq', label: 'FAQ' },
  { href: '/admin/journal', label: 'Журнал' },
  { href: '/admin/invoices', label: 'Инвойсы' },
  { href: '/admin/document-settings', label: 'Оговорки' },
  { href: '/admin/integrations', label: 'API' },
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
