interface JournalPostPageProps {
  params: Promise<{ slug: string }>;
}

export default async function JournalPostPage({ params }: JournalPostPageProps) {
  const { slug } = await params;

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <article className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-3">
          <p className="text-sm text-[var(--text-muted)]">Статья: {slug}</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">[Заголовок статьи будет добавлен]</h1>
          <p className="text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
        </header>
        <div className="w-full aspect-[16/9] rounded-sm bg-stone-300" />
        <div className="space-y-4 text-[var(--text-muted)]">
          <p>[Текст раздела будет добавлен]</p>
          <p>[Текст раздела будет добавлен]</p>
          <p>[Текст раздела будет добавлен]</p>
        </div>
      </article>
    </section>
  );
}
