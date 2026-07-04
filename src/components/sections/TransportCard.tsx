import Image from "next/image";
import Link from "next/link";

export interface TransportCardProps {
  title: string;
  description: string;
  href: string;
  image?: string;
  imageDisplay?: "square" | "hero";
}

export function TransportCard({ title, description, href, image, imageDisplay = "square" }: TransportCardProps) {
  const imageFrameClass =
    imageDisplay === "hero"
      ? "relative aspect-[16/10] w-full shrink-0 overflow-hidden"
      : "card-image w-full shrink-0 overflow-hidden";

  return (
    <article className="h-full">
      <Link
        href={href}
        className="group flex h-full flex-col overflow-hidden rounded-lg bg-[var(--surface)] shadow-[var(--shadow-1)] transition-all duration-[var(--duration-base)] ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--bg-warm)]"
        aria-label={`${title} — подробнее`}
      >
        <div className={imageFrameClass}>
          {image ? (
            <Image
              src={image}
              alt={title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, 33vw"
              unoptimized={imageDisplay === "hero"}
            />
          ) : (
            <div className="h-full w-full bg-stone-200 transition-transform duration-500 group-hover:scale-105" />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3 px-5 pb-6 pt-5">
          <h3 className="font-sans text-[19px] font-medium leading-[1.25] tracking-[-0.01em]">{title}</h3>
          <p className="font-sans text-[14px] font-light leading-[1.82] text-[var(--text-muted)]">{description}</p>
          <span className="mt-auto inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors group-hover:text-[var(--accent)] group-hover:underline">
            Подробнее →
          </span>
        </div>
      </Link>
    </article>
  );
}
