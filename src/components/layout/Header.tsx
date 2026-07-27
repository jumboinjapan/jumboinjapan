"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/city-tour", label: "Токио" },
  { href: "/intercity", label: "Маршруты из Токио" },
  { href: "/multi-day", label: "Многодневные туры" },
  { href: "/resources/events", label: "События" },
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
  const pathname = usePathname();

  /** Текущий раздел, а не точное совпадение: /intercity/hakone подсвечивает «Маршруты из Токио». */
  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  // Мобильное меню — накрывающий слой на весь экран. Без Escape из него
  // нельзя было выйти с клавиатуры, и страница под ним оставалась в
  // порядке обхода: Tab уводил в невидимый контент (аудит 2026-07-27).
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-50 transition-all"
        style={{
          // Скрим держит контраст надписей шапки: при 0.55 текст --bg давал
          // 3.98:1 над --bg и 3.70:1 над белым — ниже AA на каждой странице
          // сайта, а на /contact, /faq, /journal и /resources фото-героя нет
          // вовсе, так что это было постоянное состояние, а не край прокрутки.
          // 0.68 → 6.12:1 над --bg и 5.79:1 над белым (аудит 2026-07-27).
          // Сакура: 0.75 проходила с запасом в сотые, 0.82 — уверенно.
          background: sakura
            ? "rgba(250, 210, 215, 0.82)"
            : "rgba(28, 18, 9, 0.68)",
          backdropFilter: "blur(16px) saturate(160%)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)",
          borderBottom: sakura
            ? "1px solid rgba(180, 100, 120, 0.25)"
            : "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <Link
            href="/"
            className={`inline-flex min-h-11 items-center gap-2.5 font-sans text-sm font-medium tracking-widest uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)] ${sakura ? "text-[#6b2737]" : "text-[var(--bg)]"}`}
          >
            {/* Знак бренда: дуга наследует цвет текста (currentColor), точки — терракота;
                на тёмной шапке — осветлённый оттенок из дизайн-комплекта. */}
            <svg viewBox="11 5 64 80" className="h-7 w-auto" aria-hidden="true">
              <mask id="jj-mark">
                <rect x="0" y="0" width="96" height="96" fill="white" />
                <circle cx="64" cy="16" r="3" fill="black" />
                <circle cx="22" cy="56" r="3" fill="black" />
              </mask>
              <g mask="url(#jj-mark)">
                <path d="M 64 16 V 56 A 21 21 0 0 1 22 56" stroke="currentColor" strokeWidth="10" fill="none" strokeLinecap="round" />
                <circle cx="64" cy="16" r="8.5" fill={sakura ? "#b5341a" : "#c8502c"} />
                <circle cx="22" cy="56" r="8.5" fill={sakura ? "#b5341a" : "#c8502c"} />
              </g>
            </svg>
            <span>Jumbo In Japan</span>
          </Link>

          {/* Порог десктопной навигации — xl (1280px), не lg (1024px). На 1024
              это iPad в альбомной ориентации, то есть тач-устройство, и после
              перехода на канон «Маршруты из Токио» два пункта там переносились
              в две строки. До 1280px работает гамбургер.
              py-3 держит ссылки на 44px по высоте (были 20px); подчёркивание
              сдвинуто на bottom-3, чтобы остаться под текстом. */}
          <nav className="hidden items-center gap-7 xl:flex" aria-label="Основная навигация">
            {navItems.map((item) => {
              const current = isCurrent(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`relative inline-flex min-h-11 items-center py-3 text-sm font-medium tracking-wide uppercase after:absolute after:bottom-3 after:left-0 after:h-px after:bg-[var(--accent)] after:transition-all after:duration-300 hover:after:w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)] ${
                    current ? "after:w-full" : "after:w-0"
                  } ${sakura ? "text-[#6b2737]" : "text-[var(--bg)]"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden xl:block">
            {/* Ведёт на /contact, а не на анкету: кнопка обещает разговор,
                и короткая форма из пяти полей — это он и есть. Анкета
                предлагается на экране «спасибо», уже после отправки. */}
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-wide text-white uppercase transition-colors duration-[var(--duration-base)] ease-[var(--ease-out-soft)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)]"
            >
              Обсудить маршрут
            </Link>
          </div>

          {/* Подпись менялась вместе с состоянием, aria-expanded сообщает его
              ассистивным технологиям — раньше кнопка при открытом меню
              продолжала называться «Открыть меню». Глиф ☰ заменён на иконку
              lucide: остальные значки сайта из этого набора, и текстовый
              символ рисовался другой насыщенности и оптического размера. */}
          <button
            type="button"
            aria-label={isOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={isOpen}
            aria-controls="mobile-menu"
            className={`inline-flex min-h-11 min-w-11 items-center justify-center xl:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)] ${sakura ? "border border-[#6b2737] text-[#6b2737]" : "border border-[var(--bg)] text-[var(--bg)]"}`}
            onClick={() => setIsOpen((prev) => !prev)}
          >
            {isOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </header>

      {isOpen ? (
        <div
          id="mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Меню"
          className="fixed inset-0 z-40 bg-[var(--text)]/95 px-6 pt-28 pb-10 xl:hidden"
        >
          <nav aria-label="Основная навигация">
            <ul className="flex flex-col gap-4">
              {navItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isCurrent(item.href) ? "page" : undefined}
                    className={`flex min-h-11 items-center py-2 text-sm font-medium tracking-wide uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)] ${
                      isCurrent(item.href) ? "text-[var(--accent-soft)]" : "text-[var(--bg)]"
                    }`}
                    onClick={() => setIsOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="pt-4">
                <Link
                  href="/contact"
                  className="inline-flex min-h-11 w-full items-center justify-center border border-[var(--bg)] px-8 py-4 text-sm font-medium tracking-wide text-[var(--bg)] uppercase transition-colors duration-[var(--duration-base)] ease-[var(--ease-out-soft)] hover:bg-[var(--bg)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)]"
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
