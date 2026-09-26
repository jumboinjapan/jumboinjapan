import { getRouteContent } from '@/lib/route-content'
import { buildCityTourLiveStops } from '@/lib/city-tour-live-stops'
import { getMultiDayRouteSeoFieldsCached } from '@/lib/multi-day-builder-storage'
import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import type { Metadata } from "next";
import { CityTourDayPage } from "@/components/sections/CityTourDayPage";
import { guideRef } from "@/lib/schema";
import { RouteFaq } from '@/components/sections/RouteFaq'
import { JournalMentions } from '@/components/sections/JournalMentions'
import { typoDeep } from '@/lib/typography'

export const revalidate = 3600 // ISR: Airtable-backed (tag 'airtable:routes', invalidated via /api/revalidate on admin write)

const canonicalUrl = "https://jumboinjapan.com/city-tour/day-one";

const fallbackMetadata: Metadata = {
  title: "Токио за один день: маршрут с гидом — Гинза, Цукидзи, Мэйдзи, Сибуя",
  description:
    "Маршрут по Токио на один день: Гинза, сад Хамарикю, рынок Цукидзи, святилище Мэйдзи, Харадзюку и Сибуя. Тур с русскоязычным гидом 6–8 часов.",
  alternates: {
    canonical: canonicalUrl,
  },
  openGraph: {
    title: "Токио за один день: маршрут с гидом | JumboInJapan",
    description:
      "Маршрут по Токио на один день: Гинза, сад Хамарикю, рынок Цукидзи, святилище Мэйдзи, Харадзюку и Сибуя. Тур с русскоязычным гидом 6–8 часов.",
    url: canonicalUrl,
    images: [{ url: "/hero-city-tour-day-one-tokyo-tower.jpg" }],
  },
};

export async function generateMetadata() {
  const seo = await getMultiDayRouteSeoFieldsCached('city-tour/day-one')
  return {
    ...fallbackMetadata,
    title: seo?.seoTitle || fallbackMetadata.title,
    description: seo?.seoDescription || fallbackMetadata.description,
    openGraph: {
      ...fallbackMetadata.openGraph,
      title: seo?.seoTitle ? `${seo.seoTitle} | JumboInJapan` : fallbackMetadata.openGraph?.title,
      description: seo?.seoDescription || fallbackMetadata.openGraph?.description,
      images: seo?.heroImagePath ? [{ url: seo.heroImagePath }] : fallbackMetadata.openGraph?.images,
    },
  }
}

const hero = typoDeep({
  image: "/hero-city-tour-day-one-tokyo-tower.jpg",
  eyebrow: "6–8 часов",
  displayTitle: "Токио. Первый день",
  displaySubtitle: "Гинза, Хамарикю, Цукидзи, Мэйдзи, Харадзюку и Сибуя.",
  alt: "Токийская башня и панорама города на закате",
  objectPosition: "center 20%",
  title: "Токио за один день: маршрут с гидом",
  subtitle:
    "Гинза, Хамарикю, Цукидзи, Мэйдзи, Харадзюку и Сибуя — 6–8 часов с русскоязычным гидом.",
});

const program = typoDeep({
  title: "Токио за один день: самый популярный маршрут",
  description:
    "Эта обзорная программа по Токио составлена мной специально для глубокого знакомства с городом. Маршрут проходит через районы Гинза, сад Хамарикю, рынок Цукидзи, святилище Мэйдзи, а также молодёжные кварталы Харадзюку и перекрёсток Сибуя. Наша задача — увидеть разные грани Токио через призму истории, традиций, старой и новой архитектуры и лучше понять, как и чем живёт город. Такой маршрут особенно подходит тем, кто хочет увидеть самое интересное за один день.",
  duration: "6–8 часов",
});


const logistics = typoDeep({
  intro:
    "Для этого тура по Токио доступны общественный, частный и заказной транспорт. Ниже — короткая ориентация по уровню комфорта; логистику собираем под ваш темп, состав группы и район проживания.",
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
  '@id': canonicalUrl + '#trip',
  name: hero.title,
  description: hero.subtitle,
  disambiguatingDescription: describeTourDuration(program.duration),
  url: canonicalUrl,
  touristType: "Russian-speaking travelers",
  provider: guideRef,
  offers: buildTourOffer(canonicalUrl),
};

export default async function CityTourDayOnePage() {
  const { routeStopRecords: airtableStops, pois } = await getRouteContent('city-tour/day-one')
  const sortedStops = buildCityTourLiveStops(airtableStops, pois)
  const seo = await getMultiDayRouteSeoFieldsCached('city-tour/day-one')
  const liveHero = { ...hero, title: seo?.routeTitle || hero.title, displayTitle: seo?.routeTitle || hero.title, image: seo?.heroImagePath || hero.image, subtitle: seo?.previewSubtitle || hero.subtitle }
  const liveProgram = { ...program, description: seo?.routeIntro || program.description }

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
        dangerouslySetInnerHTML={{ __html: serializeTourSchema(tourSchema) }}
      />
      <CityTourDayPage hero={liveHero} program={liveProgram} stops={sortedStops} logistics={logistics}>
    <RouteFaq slug="city-tour/day-one" />
    <JournalMentions
      routeSlug="city-tour/day-one"
      poiIds={airtableStops.map((s) => s.poiId).filter(Boolean)}
      locationNames={[...sortedStops.map((s) => s.title), 'Токио']}
    />
      </CityTourDayPage>
      </>
  );
}
