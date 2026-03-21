import { about } from "@/data/about";

export default function AboutPage() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="font-sans font-bold text-5xl tracking-tight leading-[1.05] md:text-7xl">{about.name}</h1>
          <p className="leading-relaxed text-[var(--text-muted)]">{about.bio}</p>
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
