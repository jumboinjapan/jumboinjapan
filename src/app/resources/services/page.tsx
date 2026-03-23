import { ResourcesSectionShell } from "@/components/resources/ResourcesSectionShell";
import { RecommendationCard } from "@/components/sections/RecommendationCard";

const services = [
  {
    name: "World Nomads",
    city: "Онлайн",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
  },
  {
    name: "IIJmio",
    city: "Япония",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
  },
  {
    name: "Toyota Rent-a-Car",
    city: "Япония",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
  },
  {
    name: "IC Card (Suica)",
    city: "Токио",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
  },
];

export default function RecommendationsServicesPage() {
  return (
    <ResourcesSectionShell
      title="Услуги"
      description="Практичные сервисы: страховка, связь и транспорт по Японии."
    >
      <div className="grid gap-8 md:grid-cols-2">
        {services.map((service) => (
          <RecommendationCard key={service.name} {...service} />
        ))}
      </div>
    </ResourcesSectionShell>
  );
}
