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
        <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25]">{title}</h3>
        <p className="font-sans text-[14px] font-light leading-[1.82] text-[var(--text-muted)]">{description}</p>
        <Link
          href={`/from-tokyo/${slug}`}
          className="mt-4 inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
        >
          Подробнее →
        </Link>
      </div>
    </article>
  );
}
