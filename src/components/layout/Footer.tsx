import Link from "next/link";

import { ObfuscatedEmail } from "@/components/ObfuscatedEmail";
import { PreferredSourceButton } from "@/components/PreferredSourceButton";

/**
 * Ссылки подвала. min-h-11 обязателен: это семь ссылок на каждой из 16
 * страниц, и при высоте 18px с шагом 24px они были самой массовой мелкой
 * тач-целью сайта — 112 случаев из ~130 (аудит 2026-07-27). Промах на
 * шесть пикселей уводил на соседний раздел.
 */
const FOOTER_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-xs transition-colors hover:text-[var(--bg)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--text)]";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--text)] text-[var(--bg)]">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:px-6 lg:grid-cols-4">
        <div className="space-y-2">
          <h2 className="font-sans text-label font-medium tracking-[0.2em] uppercase text-[var(--bg)]/60">Контакты</h2>
          <p className="text-sm text-[var(--bg)]/80"><ObfuscatedEmail className={FOOTER_LINK_CLASS} /></p>
          <p className="text-sm text-[var(--bg)]/80">Tokyo, Japan</p>
        </div>

        <div className="space-y-2">
          <h2 className="font-sans text-label font-medium tracking-[0.2em] uppercase text-[var(--bg)]/60">Навигация</h2>
          <ul className="text-sm text-[var(--bg)]/80">
            <li>
              <Link href="/city-tour" className={FOOTER_LINK_CLASS}>
                По Токио
              </Link>
            </li>
            <li>
              <Link href="/intercity" className={FOOTER_LINK_CLASS}>
                Маршруты из Токио
              </Link>
            </li>
            <li>
              <Link href="/multi-day" className={FOOTER_LINK_CLASS}>
                Многодневные туры
              </Link>
            </li>
            <li>
              <Link href="/journal" className={FOOTER_LINK_CLASS}>
                Журнал
              </Link>
            </li>
            <li>
              <Link href="/faq" className={FOOTER_LINK_CLASS}>
                Вопросы о поездке
              </Link>
            </li>
            <li>
              <Link href="/contact" className={FOOTER_LINK_CLASS}>
                Контакты
              </Link>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h2 className="font-sans text-label font-medium tracking-[0.2em] uppercase text-[var(--bg)]/60">Соцсети</h2>
          <ul className="text-sm text-[var(--bg)]/80">
            <li>
              <a
                href="https://www.instagram.com/revidovich.art/"
                target="_blank"
                rel="noreferrer"
                className={FOOTER_LINK_CLASS}
              >
                Instagram
              </a>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h2 className="font-sans text-label font-medium tracking-[0.2em] uppercase text-[var(--bg)]/60">О сайте</h2>
          {/* Было: «Личный проект о Японии и про организацию небанальных
              путешествий». «Личный проект» читалось как хобби — последней
              строкой на каждой странице, у человека, который выбирает,
              кому доверить поездку; «небанальных» — пустой эпитет из
              списка запрещённых в CLAUDE.md. */}
          <p className="text-sm text-[var(--bg)]/80">
            Частный гид в Японии. Маршруты по Токио, выезды из города и многодневные путешествия по стране.
          </p>
          <p className="pt-2 text-xs text-[var(--bg)]/70">© {new Date().getFullYear()} JumboInJapan</p>
        </div>

        {/* Preferred Sources — отдельной строкой во всю ширину, а не внутри
            колонки. Причина замерена: русская подпись на бейдже Google
            («Добавить в список предпочтительных источников») при ширине
            колонки 246 px встаёт в три строки и обрезается рамкой iframe;
            при 280 px помещается в две, при 400 px — в одну. */}
        <div className="border-t border-[var(--bg)]/15 pt-8 md:col-span-2 lg:col-span-4">
          <p className="max-w-md text-meta text-[var(--bg)]/70">
            Google сможет чаще показывать вам материалы этого сайта — в том числе в ответах ИИ.
          </p>
          <PreferredSourceButton theme="dark" className="mt-3" />
        </div>
      </div>
    </footer>
  );
}
