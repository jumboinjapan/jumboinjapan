import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--text)] text-[var(--bg)]">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 md:grid-cols-3 md:px-6">
        <div className="space-y-2">
          <h3 className="font-sans text-[10px] font-medium tracking-[0.2em] uppercase text-[var(--bg)]/40">Контакты</h3>
          <p className="text-sm text-[var(--bg)]/80">hello@jumboinjapan.com</p>
          <p className="text-sm text-[var(--bg)]/80">Tokyo, Japan</p>
        </div>

        <div className="space-y-2">
          <h3 className="font-sans text-[10px] font-medium tracking-[0.2em] uppercase text-[var(--bg)]/40">Навигация</h3>
          <ul className="space-y-1 text-sm">
            <li>
              <Link href="/from-tokyo" className="hover:underline">
                Из Токио
              </Link>
            </li>
            <li>
              <Link href="/journal" className="hover:underline">
                Журнал
              </Link>
            </li>
            <li>
              <Link href="/contact" className="hover:underline">
                Контакты
              </Link>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="font-sans text-[10px] font-medium tracking-[0.2em] uppercase text-[var(--bg)]/40">О сайте</h3>
          <p className="text-sm text-[var(--bg)]/80">
            Личный проект о внимательных путешествиях по Японии с локальным контекстом.
          </p>
          <p className="pt-2 text-xs text-[var(--bg)]/70">© {new Date().getFullYear()} JumboInJapan</p>
        </div>
      </div>
    </footer>
  );
}
