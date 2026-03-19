export default function IsraelPage() {
  return (
    <section className="bg-[var(--bg)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-12">
        <div className="max-w-3xl space-y-6">
          <div className="flex items-center gap-4 text-[var(--gold)]">
            <span className="h-px flex-1 bg-[var(--border)]" />
            <span className="font-sans text-2xl">⛩</span>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <h1 className="font-sans font-bold text-5xl tracking-tight leading-[1.05] md:text-7xl">
            Для гостей из Израиля
          </h1>
          <p className="font-sans text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">
            [Текст раздела будет добавлен]
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="aspect-[3/2] w-full bg-stone-200" />
          <div className="aspect-[3/2] w-full bg-stone-200" />
        </div>
      </div>
    </section>
  );
}
