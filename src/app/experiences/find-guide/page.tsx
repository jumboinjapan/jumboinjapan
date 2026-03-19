import Link from "next/link";

export default function FindGuidePage() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="font-serif text-4xl">Подбор гида</h1>
          <p className="text-sm text-[var(--text-muted)]">Длительность: 1 консультация</p>
          <p className="text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
        </div>
        <div className="w-full aspect-[4/3] rounded-sm bg-stone-200" />
        <Link href="/contact" className="inline-flex min-h-11 items-center rounded-sm bg-[var(--accent)] px-6 text-white">
          Обсудить маршрут
        </Link>
      </div>
    </section>
  );
}
