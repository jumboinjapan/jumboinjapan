'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type ResourceNavItem = {
  href: string;
  label: string;
};

const resourceNavItems: ResourceNavItem[] = [
  { href: '/resources/hotels', label: 'Отели' },
  { href: '/resources/restaurants', label: 'Рестораны' },
  { href: '/resources/services', label: 'Услуги' },
];

function getActiveSection(pathname: string): string {
  if (pathname.startsWith('/resources/hotels')) return 'Отели';
  if (pathname.startsWith('/resources/restaurants')) return 'Рестораны';
  if (pathname.startsWith('/resources/services')) return 'Услуги';
  return 'Обзор';
}

export default function ResourcesLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeSection = getActiveSection(pathname);

  return (
    <>
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 pb-8 pt-12 md:px-6 md:pb-10 md:pt-16">
        <div className="mx-auto w-full max-w-6xl space-y-5">
          <h2 className="font-sans text-3xl font-medium tracking-tight md:text-4xl">Ресурсы</h2>

          <div className="overflow-x-auto">
            <div className="flex min-w-max flex-nowrap gap-2 pb-1">
              {resourceNavItems.map((item) => {
                const isActive = pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex min-h-11 shrink-0 items-center justify-center px-5 py-2 text-sm font-medium tracking-wide uppercase transition-colors ${
                      isActive
                        ? 'bg-[var(--text)] text-[var(--bg)]'
                        : 'border border-[var(--text)] text-[var(--text)] hover:bg-[var(--text)] hover:text-[var(--bg)]'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-[var(--text-muted)]">Ресурсы / {activeSection}</p>
        </div>
      </section>

      {children}
    </>
  );
}
