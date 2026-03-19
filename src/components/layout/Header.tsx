"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all ${
          isScrolled ? "bg-[var(--bg)]/95 shadow-sm backdrop-blur-sm" : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <Link href="/" className="font-serif text-lg tracking-wide">
            JumboInJapan
          </Link>

          <nav className="hidden items-center gap-7 lg:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium tracking-widest text-[var(--text)] uppercase transition-colors hover:text-[var(--accent)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden lg:block">
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-widest text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
            >
              Обсудить маршрут
            </Link>
          </div>

          <button
            type="button"
            aria-label="Открыть меню"
            className="inline-flex min-h-11 min-w-11 items-center justify-center border border-[var(--text)] text-[var(--text)] lg:hidden"
            onClick={() => setIsOpen((prev) => !prev)}
          >
            <span className="text-lg">☰</span>
          </button>
        </div>
      </header>

      {isOpen ? (
        <div className="fixed inset-0 z-40 bg-[var(--text)]/95 px-6 pt-28 pb-10 lg:hidden">
          <nav>
            <ul className="flex flex-col gap-4">
              {navItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block min-h-11 py-2 text-sm font-medium tracking-widest text-[var(--bg)] uppercase"
                    onClick={() => setIsOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="pt-4">
                <Link
                  href="/contact"
                  className="inline-flex min-h-11 w-full items-center justify-center border border-[var(--bg)] px-8 py-4 text-sm font-medium tracking-widest text-[var(--bg)] uppercase transition-colors hover:bg-[var(--bg)] hover:text-[var(--text)]"
                  onClick={() => setIsOpen(false)}
                >
                  Обсудить маршрут
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      ) : null}
    </>
  );
}
