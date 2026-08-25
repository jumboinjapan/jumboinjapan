import type { Metadata } from "next";
import { CityTourDayPage, type CityTourStop } from "@/components/sections/CityTourDayPage";
import { getIntercityRouteStopsCached } from "@/lib/airtable";
import { applyCityTourStopOverrides } from "@/lib/city-tour-overrides";
import { guideRef } from "@/lib/schema";
import { RouteFaq } from '@/components/sections/RouteFaq'
import { JournalMentions } from '@/components/sections/JournalMentions'
import { typoDeep } from '@/lib/typography'
import { cityTourHiddenSpotsStops } from '@/data/city-tour-hidden-spots'

export const revalidate = 3600 // ISR: Airtable-backed (tag 'airtable:routes', invalidated via /api/revalidate on admin write)

const canonicalUrl = "https://jumboinjapan.com/city-tour/hidden-spots";

export const metadata: Metadata = {
  title: "Скрытые уголки Токио: нетуристический маршрут с гидом",
  description:
    "Скрытые уголки Токио: Сибамата, Янака Гинза, Акихабара и Голден Гай. Индивидуальная экскурсия по нетуристическому Токио с русскоязычным гидом.",
  alternates: {
    canonical: canonicalUrl,
  },
  openGraph: {
    title: "Скрытые уголки Токио | JumboInJapan",
    description:
      "Нетуристический маршрут по Токио: Сибамата, Янака Гинза, Акихабара и вечерние переулки Синдзюку с русскоязычным гидом.",
    url: canonicalUrl,
    images: [{ url: "/hero-city-tour-hidden-spots.jpg" }],
  },
};

const hero = typoDeep({
  image: "/hero-city-tour-hidden-spots.jpg",
  alt: "Ряды белых фигурок манэки-нэко с красными ошейниками в храме Готокудзи в Токио на фоне ярких осенних клёнов",
  eyebrow: "Гибкий формат",
  title: "Скрытые уголки Токио",
  subtitle:
    "Сибамата, Янака Гинза, Акихабара и вечерние переулки Синдзюку — нетуристический Токио вне очевидного маршрута.",
  objectPosition: "center",
});

const program = typoDeep({
  title: "Скрытые уголки Токио",
  description:
    "Этот маршрут по Токио подобран для тех, кому интересен не только широкий обзор того, что город предлагает на своей международной витрине, но и то, что обычно остаётся за пределами стандартной экскурсионной карты. Сибамата, Янака Гинза, Акихабара и старые вечерние переулки Синдзюку показывают другой ритм города: более локальный, менее отшлифованный и потому особенно живой. Такой день удобно собирать под интересы путешественника — с акцентом на ситамати (старые кварталы города), повседневную городскую культуру, ретро-Токио, поп-культуру или камерную вечернюю атмосферу.",
  duration: "Гибкий формат",
});

const stops: CityTourStop[] = typoDeep(cityTourHiddenSpotsStops)

const logistics = typoDeep({
  intro:
    "Формат этого маршрута гибкий: его можно собрать на общественном, частном или заказном транспорте — в зависимости от того, насколько широко хочется охватить Токио за один день.",
  options: [
    {
      title: "Общественный транспорт",
      text: "Пешеходный ритм с переездами на метро или такси: быстро, экономно и ближе всего к повседневному Токио.",
      href: "/city-tour/public",
      image: "/city-tour-transport-public-v2.jpg",
    },
    {
      title: "Частный транспорт",
      text: "Городская программа в основном пешеходная: переходы заметные, и к машине маршрут возвращается. Зато становятся доступными более сложные по логистике маршруты — удалённые районы и точки вне пешей досягаемости, поэтому под частный транспорт существуют отдельные варианты программ.",
      href: "/city-tour/private",
      image: "/city-tour-transport-private-v4.jpg",
    },
    {
      title: "Заказной транспорт",
      text: "Лимузин-сервис с просторным минивэном — вариант для семьи или группы, когда важно ехать всем вместе и беречь силы. Комфорт предсказуем в любую погоду и любой час дня.",
      href: "/city-tour/charter",
      image: "/city-tour-transport-limousine-v2.jpg",
    },
  ],
});

const tourSchemaBase = {
  "@context": "https://schema.org",
  "@type": "TouristTrip",
  name: "Hidden Corners of Tokyo Guided Tour",
  description:
    "Private Tokyo itinerary through lesser-known neighborhoods including Shibamata, Yanaka Ginza, Akihabara, and the evening alleys of Shinjuku.",
  url: canonicalUrl,
  touristType: "Russian-speaking travelers",
  provider: guideRef,
  offers: {
    "@type": "Offer",
    availability: "https://schema.org/InStock",
    url: canonicalUrl,
  },
};

export default async function CityTourHiddenSpotsPage() {
  // Порядок и тексты остановок: override из админки поверх кодовых значений
  const airtableStops = await getIntercityRouteStopsCached('city-tour/hidden-spots').catch(() => [])
  const sortedStops = applyCityTourStopOverrides(stops, airtableStops, 'city-tour/hidden-spots')

  const tourSchema = {
    ...tourSchemaBase,
    itinerary: sortedStops.map((stop) => ({
      "@type": "TouristAttraction",
      name: stop.title,
      description: stop.text.split("\n\n")[0],
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <CityTourDayPage hero={hero} program={program} stops={sortedStops} logistics={logistics} />
    <RouteFaq slug="city-tour/hidden-spots" />
    <JournalMentions routeSlug="city-tour/hidden-spots" locationNames={['Токио']} />
      </>
  );
}
