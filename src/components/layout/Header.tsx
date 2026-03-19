"use client";

import Link from "next/link";
import { useState } from "react";

const navItems = [
  { href: "/experiences/tokyo-walks", label: "Токио" },
  { href: "/experiences", label: "Маршруты" },
  { href: "/about", label: "Об Эдуарде" },
  { href: "/journal", label: "Журнал" },
  { href: "/recommendations", label: "Рекомендации" },
  { href: "/israel", label: "Израиль" },
];

export function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="border-b border-border bg-[var(--bg)]/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-6">
        <Link href="/" className="font-serif text-xl font-semibold tracking-wide">
          JumboInJapan
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden lg:block">
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center justify-center rounded-sm bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-light)]"
          >
            Обсудить маршрут
          </Link>
        </div>

        <button
          type="button"
          aria-label="Открыть меню"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-border text-[var(--text)] lg:hidden"
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span className="text-lg">☰</span>
        </button>
      </div>

      {isOpen ? (
        <nav className="border-t border-border px-4 py-3 lg:hidden">
          <ul className="flex flex-col gap-2">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block min-h-11 rounded-sm px-2 py-2 text-[var(--text)]"
                  onClick={() => setIsOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/contact"
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-sm bg-[var(--accent)] px-4 py-2 font-medium text-white"
                onClick={() => setIsOpen(false)}
              >
                Обсудить маршрут
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
