import Link from "next/link";
import { typoDeep } from '@/lib/typography'

interface UnderConstructionProps {
  title: string;
  message?: string;
}

export function UnderConstruction(props: UnderConstructionProps) {
  const {
    title,
    message = "Этот раздел сейчас в разработке. Скоро здесь появится полезная информация.",
    } = typoDeep(props)

    return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="max-w-2xl space-y-4">
          <h1 className="text-3xl md:text-4xl">
            {title}
          </h1>
          <p className="font-sans text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">
            {message}
          </p>
        </div>
        {/* Человек пришёл за информацией и не нашёл её. Отправлять его
            отсюда в анкету на одиннадцать экранов — плохая сделка;
            короткая форма уместнее. */}
        <Link
          href="/contact"
          className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-wide text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
        >
          Обсудить маршрут
        </Link>
      </div>
    </section>
    );
}
