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
    <article className="flex h-full flex-col rounded-sm border border-border bg-[var(--surface)] p-5">
      <div className="w-full aspect-[4/3] rounded-sm bg-stone-200" />
      <div className="mt-4 flex h-full flex-col gap-3">
        <h3 className="font-serif text-2xl">{title}</h3>
        <p className="text-sm text-[var(--text-muted)]">{duration}</p>
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>
        <Link
          href={`/experiences/${slug}`}
          className="mt-auto inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent)] hover:text-[var(--accent-light)]"
        >
          Подробнее
        </Link>
      </div>
    </article>
  );
}
