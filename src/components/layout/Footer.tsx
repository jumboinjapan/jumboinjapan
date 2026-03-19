import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border bg-[var(--surface)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-[var(--text-muted)] md:flex-row md:items-center md:justify-between md:px-6">
        <p>© {new Date().getFullYear()} JumboInJapan</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/faq" className="hover:text-[var(--text)]">
            FAQ
          </Link>
          <Link href="/contact" className="hover:text-[var(--text)]">
            Контакты
          </Link>
          <Link href="/journal" className="hover:text-[var(--text)]">
            Журнал
          </Link>
        </div>
      </div>
    </footer>
  );
}
