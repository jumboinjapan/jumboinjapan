interface TestimonialCardProps {
  name: string;
  city: string;
}

export function TestimonialCard({ name, city }: TestimonialCardProps) {
  return (
    <article className="rounded-sm border border-border bg-[var(--surface)] p-5">
      <p className="mb-4 leading-relaxed text-[var(--text-muted)]">
        [Текст раздела будет добавлен]
      </p>
      <p className="font-medium text-[var(--text)]">{name}</p>
      <p className="text-sm text-[var(--text-muted)]">{city}</p>
    </article>
  );
}
