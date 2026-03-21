import { RecommendationCard } from "@/components/sections/RecommendationCard";

const services = [
  {
    name: "World Nomads",
    city: "Онлайн",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
  {
    name: "IIJmio",
    city: "Япония",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
  {
    name: "Toyota Rent-a-Car",
    city: "Япония",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
  {
    name: "IC Card (Suica)",
    city: "Токио",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
];

export default function RecommendationsServicesPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">
        <div className="max-w-2xl space-y-4">
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Ресурсы: услуги</h1>
          <p className="text-[var(--text-muted)]">Практичные сервисы: страховка, связь и транспорт по Японии.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {services.map((service) => (
            <RecommendationCard key={service.name} {...service} />
          ))}
        </div>
      </div>
    </section>
  );
}
