import Link from "next/link";

import { ObfuscatedEmail } from "@/components/ObfuscatedEmail";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--text)] text-[var(--bg)]">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:px-6 lg:grid-cols-4">
        <div className="space-y-2">
          <h3 className="font-sans text-[10px] font-medium tracking-[0.2em] uppercase text-[var(--bg)]/40">Контакты</h3>
          <p className="text-sm text-[var(--bg)]/80"><ObfuscatedEmail className="transition-colors hover:text-[var(--bg)]" /></p>
          <p className="text-sm text-[var(--bg)]/80">Tokyo, Japan</p>
        </div>

        <div className="space-y-2">
          <h3 className="font-sans text-[10px] font-medium tracking-[0.2em] uppercase text-[var(--bg)]/40">Навигация</h3>
          <ul className="space-y-1 text-sm text-[var(--bg)]/80">
            <li>
              <Link href="/city-tour" className="rounded-xs transition-colors hover:text-[var(--bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)]">
                По Токио
              </Link>
            </li>
            <li>
              <Link href="/intercity" className="rounded-xs transition-colors hover:text-[var(--bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)]">
                Маршруты из Токио
              </Link>
            </li>
            <li>
              <Link href="/multi-day" className="rounded-xs transition-colors hover:text-[var(--bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)]">
                Многодневные путешествия
              </Link>
            </li>
            <li>
              <Link href="/journal" className="rounded-xs transition-colors hover:text-[var(--bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)]">
                Журнал
              </Link>
            </li>
            <li>
              <Link href="/contact" className="rounded-xs transition-colors hover:text-[var(--bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)]">
                Контакты
              </Link>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="font-sans text-[10px] font-medium tracking-[0.2em] uppercase text-[var(--bg)]/40">Соцсети</h3>
          <ul className="space-y-1 text-sm text-[var(--bg)]/80">
            <li>
              <a
                href="https://www.instagram.com/revidovich.art/"
                target="_blank"
                rel="noreferrer"
                className="rounded-xs transition-colors hover:text-[var(--bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)]"
              >
                Instagram
              </a>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="font-sans text-[10px] font-medium tracking-[0.2em] uppercase text-[var(--bg)]/40">О сайте</h3>
          <p className="text-sm text-[var(--bg)]/80">
            Личный проект о Японии и про организацию небанальных путешествий.
          </p>
          <p className="pt-2 text-xs text-[var(--bg)]/70">© {new Date().getFullYear()} JumboInJapan</p>
        </div>
      </div>
    </footer>
  );
}
