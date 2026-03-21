import Link from "next/link";
import { journalPosts } from "@/data/journal";

export function JournalPreview() {
  const preview = journalPosts.slice(0, 3);

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-10 max-w-2xl space-y-4">
          <p className="text-[10px] font-medium tracking-[0.22em] uppercase text-[var(--gold)] mb-3">Журнал</p>
          <h2 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Журнал</h2>
          <p className="font-sans text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">
            [Текст раздела будет добавлен]
          </p>
        </div>

        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {preview.map((post) => (
            <article key={post.slug} className="overflow-hidden">
              <div className="relative aspect-[3/2] w-full bg-stone-200">
                {post.source === "instagram" && (
                  <span className="absolute top-3 right-3 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
                    Instagram
                  </span>
                )}
              </div>
              <h3 className="mt-5 font-sans font-medium text-[18px] tracking-[-0.01em] leading-[1.3]">{post.title}</h3>
              <p className="mt-3 font-sans text-[14px] font-light leading-[1.82] text-[var(--text-muted)]">
                {post.excerpt}
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
