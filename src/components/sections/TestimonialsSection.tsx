import { TestimonialCard } from "./TestimonialCard";

const testimonials = [
  { name: "Алина и Максим", city: "Москва" },
  { name: "Давид", city: "Тель-Авив" },
  { name: "Ирина", city: "Санкт-Петербург" },
];

export function TestimonialsSection() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-6 max-w-2xl space-y-3">
          <h2 className="font-serif text-3xl">Отзывы</h2>
          <p className="leading-relaxed text-[var(--text-muted)]">
            [Текст раздела будет добавлен]
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((item) => (
            <TestimonialCard key={item.name} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
