import Link from "next/link";

const posts = [
  { slug: "pervye-dni-v-tokio", title: "Первые дни в Токио" },
  { slug: "ryokan-i-onsen", title: "Рёкан и онсэн: как выбрать" },
  { slug: "kuda-idti-vecherom", title: "Куда идти вечером в Сибуе" },
];

export default function JournalPage() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="font-serif text-4xl">Журнал</h1>
          <p className="text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <article key={post.slug} className="rounded-sm border border-border bg-[var(--surface)] p-4">
              <div className="w-full aspect-[4/3] rounded-sm bg-stone-200" />
              <h2 className="mt-4 font-serif text-2xl">{post.title}</h2>
              <p className="mt-2 text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
              <Link href={`/journal/${post.slug}`} className="mt-3 inline-flex min-h-11 items-center text-[var(--accent)]">
                Читать
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
