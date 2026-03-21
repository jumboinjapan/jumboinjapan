import Link from "next/link";

export interface ExperienceCardProps {
  title: string;
  description: string;
  duration: string;
  slug: string;
}

export function ExperienceCard({
  title,
  description,
  duration,
  slug,
}: ExperienceCardProps) {
  return (
    <article className="group flex h-full flex-col overflow-hidden">
      <div className="overflow-hidden">
        <div className="aspect-[3/2] w-full bg-stone-200 transition-transform duration-500 group-hover:scale-105" />
      </div>
      <div className="mt-5 flex h-full flex-col gap-3">
        <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">{duration}</p>
        <h3 className="font-sans font-semibold text-xl tracking-tight md:text-2xl">{title}</h3>
        <p className="font-sans text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">{description}</p>
        <Link
          href={`/from-tokyo/${slug}`}
          className="mt-auto inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
        >
          Подробнее →
        </Link>
      </div>
    </article>
  );
}
