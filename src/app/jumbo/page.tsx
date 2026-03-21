import { about } from "@/data/about";

export default function AboutPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">
        <div className="max-w-2xl space-y-4">
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">{about.name}</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{about.bio}</p>
        </div>
        <div className="w-full aspect-[16/9] bg-stone-300 lg:aspect-[21/9]" />
        <div className="max-w-2xl space-y-4 text-[var(--text-muted)]">
          {about.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
