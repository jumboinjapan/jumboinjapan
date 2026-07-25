import { TravelFormatPage } from "@/components/sections/TravelFormatPage";
import { buildPageMetadata } from "@/lib/page-metadata";

// title reuses the page's own visible `title` prop verbatim; description is
// the intro paragraph (both below, unchanged).
export const metadata = buildPageMetadata("/city-tour/public", {
  title: "Когда для Токио общественный транспорт оказывается лучшим решением",
  description: "Обзорные туры по Токио выстроены так, чтобы места в маршруте шли одно за другим и находились в пешей доступности.",
  openGraph: {
    title: "Когда для Токио общественный транспорт оказывается лучшим решением | JumboInJapan",
    description: "Обзорные туры по Токио выстроены так, чтобы места в маршруте шли одно за другим и находились в пешей доступности.",
    images: [{ url: "/city-tour-transport-public-v2.jpg" }],
  },
})

export default function CityTourPublicPage() {
  return (
    <TravelFormatPage
      eyebrow="Туры по Токио"
      heroTitle="Токио на общественном транспорте"
      heroSubtitle="Метро и пешие переходы — самый естественный способ передвигаться по Токио."
      heroImage="/city-tour-transport-public-v2.jpg"
      heroAlt="Поезд метро в Токио и ритм общественного транспорта"
      heroObjectPosition="center"
      layoutMode="compact"
      title="Когда для Токио общественный транспорт оказывается лучшим решением"
      subtitle="Общественный транспорт"
      intro="Обзорные туры по Токио выстроены так, чтобы места в маршруте шли одно за другим и находились в пешей доступности."
      quickVerdict="Обзорные туры в Токио в основном строятся как пешеходные маршруты, поэтому общественный транспорт или такси обычно удобнее и экономнее, если день составлен грамотно."
      goodFit={[
        "Активным туристам, которые любят ходить пешком",
        "Тем, чей отель удобно расположен в Токио",
        "Тем, кому важно видеть город во всех его проявлениях",
      ]}
      notIdeal={[
        "Если есть физические ограничения",
        "Если с собой багаж, детская коляска или покупки",
        "Если нужна свобода менять маршрут по ходу дня",
      ]}
      practicalNotes={[
        "У вас будет 1 или 2 переезда между районами. Это ещё и хороший повод познакомиться с токийским метро.",
      ]}
      alternativeGuidance={{
        title: "Когда лучше частный транспорт",
        description: "Частный транспорт лучше, если нужен спокойный день без лестниц и пересадок, особенно когда в группе разный темп.",
      }}
      secondaryCta={{ href: "/city-tour/private", label: "Сравнить с частным транспортом" }}
    />
  );
}
