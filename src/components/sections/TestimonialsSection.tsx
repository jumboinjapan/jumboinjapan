import { TestimonialCard } from "./TestimonialCard";

const testimonials = [
  { name: "Алина и Максим", city: "Москва" },
  { name: "Давид", city: "Тель-Авив" },
  { name: "Ирина", city: "Санкт-Петербург" },
];

export function TestimonialsSection() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-10 max-w-2xl space-y-4">
          <h2 className="font-sans font-semibold text-3xl tracking-tight md:text-5xl">Отзывы</h2>
          <p className="font-sans text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">
            [Текст раздела будет добавлен]
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((item) => (
            <TestimonialCard key={item.name} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
