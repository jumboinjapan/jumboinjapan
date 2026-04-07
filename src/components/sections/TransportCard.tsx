import Image from "next/image";
import Link from "next/link";

export interface TransportCardProps {
  title: string;
  description: string;
  href: string;
  image?: string;
}

export function TransportCard({ title, description, href, image }: TransportCardProps) {
  return (
    <Link
      href={href}
      className="group block h-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--bg-warm)]"
      aria-label={`${title} — подробнее`}
    >
      <article className="flex h-full flex-col overflow-hidden">
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
          <h3 className="font-sans text-[19px] font-medium leading-[1.25] tracking-[-0.01em]">{title}</h3>
          <p className="font-sans text-[14px] font-light leading-[1.82] text-[var(--text-muted)]">{description}</p>
          <span className="mt-auto inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors group-hover:text-[var(--accent)] group-hover:underline">
            Подробнее →
          </span>
        </div>
      </article>
    </Link>
  );
}
