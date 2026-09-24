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
import { getIntercityRouteStopsCached } from '@/lib/airtable'
import { applyCityTourStopOverrides } from '@/lib/city-tour-overrides'

const canonicalUrl = "https://jumboinjapan.com/city-tour/mitake";

export const metadata: Metadata = {
  title: "Пеший тур на гору Митаке: маршрут с гидом из Токио",
  description:
    "Однодневный тур на гору Митаке из Токио: канатная дорога, святилище Мусаси-Митаке, Рок-гарден, ущелье и Саванои-эн. Индивидуальная экскурсия с русскоязычным гидом.",
  alternates: {
    canonical: canonicalUrl,
  },
  openGraph: {
    title: "Пеший тур на гору Митаке | JumboInJapan",
    description:
      "Гора Митаке: святилище, Рок-гарден, водопад Аяхиро и прогулка по ущелью до Саваи. Тур с русскоязычным гидом из Токио.",
    url: canonicalUrl,
    images: [{ url: "/hero-city-tour-day-one-tokyo-tower.jpg" }],
  },
};

const hero = typoDeep({
  image: "",
  eyebrow: "8–10 часов",
  displayTitle: "Гора Митаке",
  title: "Пеший тур на гору Митаке",
  subtitle:
    "Канатная дорога, горное святилище, Рок-гарден и прогулка вдоль реки до Саваи.",
  objectPosition: "center",
});

const program = typoDeep({
  title: "Пеший тур на гору Митаке",
  description:
    "Из Токио едем до станции Митаке, автобусом — к нижней станции канатной дороги. Наверху проходим горную деревню, святилище Мусаси-Митаке и круг по Рок-гардену. После спуска продолжаем вдоль реки до Саваи; этот заключительный участок зависит от погоды, состояния троп и светового дня.",
  duration: "8–10 часов",
});


const logistics = typoDeep({
  intro:
    "Маршрут рассчитан на поезд, автобус, канатную дорогу и продолжительную прогулку. Горный круг и участок вдоль ущелья корректируются по погоде, состоянию троп и световому дню.",
  options: [
    {
      title: "Общественный транспорт",
      text: "Маршрут выстраивается вокруг расписаний поездов и автобусов, с пересадками внутри дня. Формат подходит высокомобильным путешественникам с приоритетом на бюджет.",
      href: "/intercity/public",
      image: "/city-tour-transport-public-v2.jpg",
    },
    {
      title: "Частный транспорт",
      text: "Транспорт по договорённости позволяет выстроить выездной день целиком: выезд от отеля, остановки по ходу маршрута, перестройка программы по погоде и настроению. Дорога становится частью тура, а не расписанием пересадок.",
      href: "/intercity/private",
      image: "/city-tour-transport-private-v4.jpg",
    },
    {
      title: "Заказной транспорт",
      text: "Лимузин-сервис — просторный минивэн на весь день. Разумный выбор для большой семьи или группы, когда важно ехать вместе и с комфортом.",
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

export default async function MitakePage() {
  const { routeStopRecords: airtableStops, pois } = await getRouteContent('city-tour/mitake')
  const sortedStops = buildCityTourLiveStops(airtableStops, pois)
  const seo = await getMultiDayRouteSeoFieldsCached('city-tour/mitake')
  const liveHero = { ...hero, title: seo?.routeTitle || hero.title, displayTitle: seo?.routeTitle || hero.title, image: seo?.heroImagePath || hero.image, subtitle: seo?.previewSubtitle || hero.subtitle }
  const liveProgram = { ...program, description: seo?.routeIntro || program.description }
  const tourSchema = { ...tourSchemaBase, itinerary: sortedStops.map(stop => ({
    "@type": "TouristAttraction", name: stop.title, description: stop.text.split("\n\n")[0],
  })) }
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeTourSchema(tourSchema) }}
      />
      <CityTourDayPage hero={liveHero} program={liveProgram} stops={sortedStops} logistics={logistics}>
    <RouteFaq slug="city-tour/mitake" />
    <JournalMentions routeSlug="city-tour/mitake" locationNames={['Митакэ']} />
      </CityTourDayPage>
      </>
  );
}
