import Link from "next/link";

const posts = [
  { slug: "pervye-dni-v-tokio", title: "Первые дни в Токио" },
  { slug: "ryokan-i-onsen", title: "Рёкан и онсэн: как выбрать" },
  { slug: "kuda-idti-vecherom", title: "Куда идти вечером в Сибуе" },
];

export function JournalPreview() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-10 max-w-2xl space-y-4">
          <h2 className="font-serif text-3xl font-semibold md:text-5xl">Журнал</h2>
          <p className="font-sans text-base leading-[1.85] text-[var(--text-muted)] md:text-lg">
            [Текст раздела будет добавлен]
          </p>
        </div>

        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <article key={post.slug} className="overflow-hidden">
              <div className="aspect-[3/2] w-full bg-stone-200" />
              <h3 className="mt-5 font-serif text-2xl md:text-3xl">{post.title}</h3>
              <p className="mt-3 font-sans text-base leading-[1.85] text-[var(--text-muted)] md:text-lg">
                [Текст раздела будет добавлен]
              </p>
              <Link
                href={`/journal/${post.slug}`}
                className="mt-4 inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
              >
                Читать →
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
