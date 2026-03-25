import { ResourcesSectionShell } from "@/components/resources/ResourcesSectionShell";
import { ServicesFilter } from "@/components/sections/ServicesFilter";
import { experienceServices, practicalServices } from "@/data/services";

export default function RecommendationsServicesPage() {
  return (
    <ResourcesSectionShell
      title="Услуги"
      description="Практичные сервисы и мастер-классы для маршрута по Японии."
    >
      <ServicesFilter experienceServices={experienceServices} practicalServices={practicalServices} />
    </ResourcesSectionShell>
  );
}
