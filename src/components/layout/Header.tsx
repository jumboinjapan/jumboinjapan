"use client";

import Link from "next/link";
import { useState } from "react";

const navItems = [
  { href: "/from-tokyo/city-tour", label: "Токио" },
  { href: "/from-tokyo", label: "Из Токио" },
  { href: "/jumbo", label: "Jumbo" },
  { href: "/journal", label: "Журнал" },
  { href: "/resources", label: "Ресурсы" },
];

function isSakuraSeason(): boolean {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  // Feb 1 – Apr 15
  return (month === 2) || (month === 3) || (month === 4 && day <= 15);
}

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const sakura = isSakuraSeason();

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-50 transition-all"
        style={{
          background: sakura
            ? "rgba(250, 210, 215, 0.75)"
            : "rgba(28, 18, 9, 0.55)",
          backdropFilter: "blur(16px) saturate(160%)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)",
          borderBottom: sakura
            ? "1px solid rgba(180, 100, 120, 0.25)"
            : "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <Link href="/" className={`font-sans text-sm font-medium tracking-widest uppercase ${sakura ? "text-[#6b2737]" : "text-[var(--bg)]"}`}>Jumbo In Japan</Link>

          <nav className="hidden items-center gap-7 lg:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`relative text-sm font-medium tracking-wide uppercase after:absolute after:bottom-0 after:left-0 after:h-px after:w-0 after:bg-[var(--accent)] after:transition-all after:duration-300 hover:after:w-full ${sakura ? "text-[#6b2737]" : "text-[var(--bg)]"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden lg:block">
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-wide text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
            >
              Обсудить маршрут
            </Link>
          </div>

          <button
            type="button"
            aria-label="Открыть меню"
            className={`inline-flex min-h-11 min-w-11 items-center justify-center lg:hidden ${sakura ? "border border-[#6b2737] text-[#6b2737]" : "border border-[var(--bg)] text-[var(--bg)]"}`}
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
                    className="block min-h-11 py-2 text-sm font-medium tracking-wide text-[var(--bg)] uppercase"
                    onClick={() => setIsOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="pt-4">
                <Link
                  href="/contact"
                  className="inline-flex min-h-11 w-full items-center justify-center border border-[var(--bg)] px-8 py-4 text-sm font-medium tracking-wide text-[var(--bg)] uppercase transition-colors hover:bg-[var(--bg)] hover:text-[var(--text)]"
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
