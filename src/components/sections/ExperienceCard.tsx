import Image from "next/image";
import Link from "next/link";

export interface ExperienceCardProps {
  title: string;
  description: string;
  duration: string;
  slug: string;
  image?: string;
}

export function ExperienceCard({
  title,
  description,
  duration,
  slug,
  image,
}: ExperienceCardProps) {
  return (
    <article className="group flex h-full flex-col overflow-hidden">
      <div className="card-image w-full shrink-0 overflow-hidden">
        {image ? (
          <Image
            src={image}
            alt={title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        ) : (
          <div className="h-full w-full bg-stone-200 transition-transform duration-500 group-hover:scale-105" />
        )}
      </div>
      <div className="mt-5 flex flex-1 flex-col gap-3">
        <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">{duration}</p>
        <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25]">{title}</h3>
        <p className="font-sans text-[14px] font-light leading-[1.82] text-[var(--text-muted)]">{description}</p>
        <Link
          href={`/tours/${slug}`}
          className="mt-4 inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
        >
          Подробнее →
        </Link>
      </div>
    </article>
  );
}
