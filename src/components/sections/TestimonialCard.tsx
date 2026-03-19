interface TestimonialCardProps {
  name: string;
  city: string;
}

export function TestimonialCard({ name, city }: TestimonialCardProps) {
  return (
    <article className="bg-[var(--surface)] p-6">
      <p className="mb-5 font-sans text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">
        [Текст раздела будет добавлен]
      </p>
      <p className="font-medium text-[var(--text)]">{name}</p>
      <p className="text-sm text-[var(--text-muted)]">{city}</p>
    </article>
  );
}
