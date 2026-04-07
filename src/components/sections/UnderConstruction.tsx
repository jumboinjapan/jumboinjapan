import Link from "next/link";

interface UnderConstructionProps {
  title: string;
  message?: string;
}

export function UnderConstruction({
  title,
  message = "Этот раздел сейчас в разработке. Скоро здесь появится полезная информация.",
}: UnderConstructionProps) {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="max-w-2xl space-y-4">
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">
            {title}
          </h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            {message}
          </p>
        </div>
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
