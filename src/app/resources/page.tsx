import { ResourcesSectionShell } from "@/components/resources/ResourcesSectionShell";
import { RecommendationCard } from "@/components/sections/RecommendationCard";

const featured = [
  {
    name: "Aman Tokyo",
    city: "Токио",
    category: "luxury" as const,
    quote: "Спокойный ритм в центре города и предсказуемо высокий сервис.",
  },
  {
    name: "Jiro (Sukiyabashi)",
    city: "Токио",
    category: "restaurant" as const,
    quote: "Точечный выбор ресторанов для особого ужина без случайных мест.",
  },
  {
    name: "World Nomads",
    city: "Онлайн",
    category: "service" as const,
    quote: "Практичные сервисы, которые снимают стресс перед поездкой.",
  },
];

export default function RecommendationsPage() {
  return (
    <ResourcesSectionShell
      title="Обзор ресурсов"
      description="Выберите раздел в переключателе выше: Отели, Рестораны или Услуги. Подборки ниже показывают стиль рекомендаций без дублирующих входных ссылок."
    >
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {featured.map((item) => (
          <RecommendationCard key={item.name} {...item} />
        ))}
      </div>
    </ResourcesSectionShell>
  );
}
