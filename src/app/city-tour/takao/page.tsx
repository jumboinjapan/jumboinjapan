import previewPhotos from '@/data/takao-photos.preview.json'
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

const canonicalUrl = "https://jumboinjapan.com/city-tour/takao";

export const metadata: Metadata = {
  title: "Пеший тур на гору Такао: маршрут с гидом из Токио",
  description:
    "Пеший и горный тур на гору Такао из Токио: Такаосангути, храм Якуо-ин, канатная дорога, вершина и лесные тропы. Индивидуальная экскурсия с русскоязычным гидом.",
  alternates: {
    canonical: canonicalUrl,
  },
  openGraph: {
    title: "Пеший тур на гору Такао | JumboInJapan",
    description:
      "Гора Такао: пеший маршрут через храм Якуо-ин, канатную дорогу и вершину с видом на Токио. Тур с русскоязычным гидом из центра города.",
    url: canonicalUrl,
    images: [{ url: "/hero-city-tour-day-one-tokyo-tower.jpg" }],
  },
};

const hero = typoDeep({
  image: "",
  eyebrow: "4–6 часов",
  displayTitle: "Гора Такао",
  title: "Пеший тур на гору Такао",
  subtitle:
    "Такаосангути, Якуо-ин, канатная дорога и вершина горы — спокойный горный день в часе от Токио.",
  objectPosition: "center",
});

const program = typoDeep({
  title: "Пеший тур на гору Такао",
  description:
    "Гора Такао — одна из самых доступных горных прогулок рядом с Токио. Маршрут начинается у станции Такаосангути, проходит через храм Якуо-ин, поднимается по тропам или канатной дороге к вершине и возвращается через лесные маршруты. Это не туристический подъёмник, а настоящая прогулка по японской природе с элементами синто и буддизма. Удобно для тех, кто хочет вырваться из города без долгой дороги.",
  duration: "4–6 часов",
});


const logistics = typoDeep({
  intro:
    "Для тура на Такао удобнее всего электричка + пешком или канатная дорога. Маршрут хорошо подходит для полудня или дня с возвращением к вечеру.",
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

export default async function TakaoPage() {
  const { routeStopRecords: airtableStops, pois } = await getRouteContent('city-tour/takao')
  // Preview-only photo selection; publish files before migrating these assignments to Airtable.
  const photoPreview = process.env.VERCEL_ENV === 'preview'
  const sortedStops = buildCityTourLiveStops(airtableStops, pois).map(stop => {
    const selected = photoPreview ? previewPhotos.stops[stop.id as keyof typeof previewPhotos.stops] : undefined
    return selected ? { ...stop, ...selected } : stop
  })
  const seo = await getMultiDayRouteSeoFieldsCached('city-tour/takao')
  const liveHero = { ...hero, title: seo?.routeTitle || hero.title, displayTitle: seo?.routeTitle || hero.title, image: photoPreview ? previewPhotos.hero : seo?.heroImagePath || hero.image, subtitle: seo?.previewSubtitle || hero.subtitle }
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
    <RouteFaq slug="city-tour/takao" />
    <JournalMentions routeSlug="city-tour/takao" locationNames={['Такао']} />
      </CityTourDayPage>
      </>
  );
}
