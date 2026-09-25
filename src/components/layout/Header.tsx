"use client";

import Link from "next/link";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./Header.module.css";

const wordmarkFont = Archivo({ subsets: ["latin"], axes: ["wdth"], display: "swap", variable: "--font-wordmark" });
const colophonFont = IBM_Plex_Mono({ subsets: ["latin", "cyrillic"], weight: "400", display: "swap", variable: "--font-colophon" });

const navItems = [
  { href: "/city-tour", label: "По Токио", ariaLabel: "Туры и экскурсии по Токио" },
  { href: "/intercity", label: "Из Токио", ariaLabel: "Маршруты из Токио" },
  { href: "/multi-day", label: "Многодневные туры", ariaLabel: "Многодневные туры по Японии" },
  { href: "/resources/events", label: "События", ariaLabel: "События в Японии" },
  { href: "/resources", label: "Ресурсы", ariaLabel: "Полезные ресурсы для поездки" },
];

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // The most specific match keeps Events and Resources from both being active.
  const currentSection = navItems.findIndex(item => pathname === item.href || pathname.startsWith(item.href + "/"));
  const currentHref = navItems[currentSection]?.href;
  const sectionLabel = currentSection >= 0
    ? `Раздел ${String(currentSection + 1).padStart(2, "0")} — ${navItems[currentSection].label}`
    : pathname === "/" || pathname.startsWith("/design/home-")
      ? "Главная"
      : pathname.startsWith("/profile") ? "Ваша поездка"
      : pathname === "/contact" ? "Контакты"
      : pathname === "/faq" ? "Вопросы и ответы"
      : "Jumbo in Japan";

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
      if (event.key === "Tab") {
        const links = menu.current?.querySelectorAll<HTMLAnchorElement>("a[href]");
        const last = links?.[links.length - 1];
        if (event.shiftKey && document.activeElement === menuButton.current) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); menuButton.current?.focus();
        }
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (desktop.matches) setIsOpen(false); };
    desktop.addEventListener("change", onResize);
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuButton.current?.focus();
    return () => {
      desktop.removeEventListener("change", onResize);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButton.current?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <header className={`${styles.header} ${wordmarkFont.variable} ${colophonFont.variable}`}>
        <div className={styles.inner}>
          <Link href="/" className={styles.brand} tabIndex={isOpen ? -1 : undefined}>
            <svg viewBox="11 5 64 80" className={styles.mark} aria-hidden="true">
              <mask id="jj-mark">
                <rect x="0" y="0" width="96" height="96" fill="white" />
                <circle cx="64" cy="16" r="3" fill="black" />
                <circle cx="22" cy="56" r="3" fill="black" />
              </mask>
              <g mask="url(#jj-mark)">
                <path d="M 64 16 V 56 A 21 21 0 0 1 22 56" stroke="currentColor" strokeWidth="10" fill="none" strokeLinecap="round" />
                <circle cx="64" cy="16" r="8.5" fill="var(--accent)" />
                <circle cx="22" cy="56" r="8.5" fill="var(--accent)" />
              </g>
            </svg>
            <span>Jumbo In Japan</span>
          </Link>
          <nav className={styles.desktopNav} aria-label="Основная навигация">
            {navItems.map(item => (
              <Link key={item.href} href={item.href} aria-current={currentHref === item.href ? "page" : undefined} aria-label={item.ariaLabel} className={styles.navLink}>
                {item.label}
              </Link>
            ))}
          </nav>
          <Link href="/profile" aria-label="Обсудить маршрут" tabIndex={isOpen ? -1 : undefined} className={`${styles.action} ${styles.headerAction}`}><span>Обсудить маршрут</span><ArrowRight size={14} aria-hidden="true" /></Link>
          <button ref={menuButton} type="button" aria-label={isOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={isOpen} aria-controls="mobile-menu" className={styles.menuButton} onClick={() => setIsOpen(prev => !prev)}>
            {isOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
        <div className={styles.colophon}>
          <div className={styles.colophonInner}>
            <span>Частный гид по Японии</span>
            <span className={styles.sectionLabel}>{sectionLabel}</span>
          </div>
        </div>
      </header>
      {isOpen ? (
        <div ref={menu} id="mobile-menu" role="dialog" aria-modal="true" aria-label="Меню" className={styles.mobileMenu}>
          <nav aria-label="Основная навигация">
            <ul>
              {navItems.map(item => (
                <li key={item.href}>
                  <Link href={item.href} aria-current={currentHref === item.href ? "page" : undefined} aria-label={item.ariaLabel} className={styles.navLink} onClick={() => setIsOpen(false)}>{item.label}</Link>
                </li>
              ))}
              <li><Link href="/profile" className={styles.action} onClick={() => setIsOpen(false)}>Обсудить маршрут<ArrowRight size={20} aria-hidden="true" /></Link></li>
            </ul>
          </nav>
        </div>
      ) : null}
    </>
  );
}
