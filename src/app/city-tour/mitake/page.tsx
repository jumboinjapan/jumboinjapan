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

const canonicalUrl = "https://jumboinjapan.com/city-tour/mitake";

export const metadata: Metadata = {
  title: "Пеший тур на гору Митаке: маршрут с гидом из Токио",
  description:
    "Пеший тур на гору Митаке: станция Митаке, канатная дорога Такимото, святилище Мусаси-Митаке, деревня и вершина. Индивидуальная экскурсия с русскоязычным гидом.",
  alternates: {
    canonical: canonicalUrl,
  },
  openGraph: {
    title: "Пеший тур на гору Митаке | JumboInJapan",
    description:
      "Гора Митаке: святилище Мусаси-Митаке, канатная дорога, деревня и лесные тропы. Тур с русскоязычным гидом из Токио.",
    url: canonicalUrl,
    images: [{ url: "/hero-city-tour-day-one-tokyo-tower.jpg" }],
  },
};

const hero = typoDeep({
  image: "",
  eyebrow: "5–7 часов",
  displayTitle: "Гора Митаке",
  title: "Пеший тур на гору Митаке",
  subtitle:
    "Митаке, святилище Мусаси-Митаке, канатная дорога и горная деревня — классический горный маршрут в часе от Токио.",
  objectPosition: "center",
});

const program = typoDeep({
  title: "Пеший тур на гору Митаке",
  description:
    "Гора Митаке — это более дикий и атмосферный вариант горной прогулки по сравнению с Такао. Маршрут начинается у станции Митаке, поднимается по канатной дороге или тропе к святилищу Мусаси-Митаке, проходит через старую горную деревню и ведёт к вершине. Здесь меньше толпы, больше леса и настоящего горного колорита. Идеально для тех, кто уже был на Такао или хочет более спокойный и глубокий горный день.",
  duration: "5–7 часов",
});


const logistics = typoDeep({
  intro:
    "Для тура на Митаке удобнее всего электричка + канатная дорога или пеший подъём. Маршрут длиннее Такао и требует чуть больше времени.",
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
