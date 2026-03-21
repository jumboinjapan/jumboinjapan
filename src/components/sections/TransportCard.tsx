import Link from "next/link";

export interface TransportCardProps {
  title: string;
  description: string;
  href: string;
}

export function TransportCard({ title, description, href }: TransportCardProps) {
  return (
    <article className="group flex h-full flex-col overflow-hidden">
      <div className="overflow-hidden">
        <div className="card-image w-full bg-stone-200 transition-transform duration-500 group-hover:scale-105" />
      </div>
      <div className="mt-5 flex flex-1 flex-col gap-3">
        <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25]">{title}</h3>
        <p className="font-sans text-[14px] font-light leading-[1.82] text-[var(--text-muted)]">{description}</p>
        <Link
          href={href}
          className="mt-auto inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
        >
          Подробнее →
        </Link>
      </div>
    </article>
  );
}
