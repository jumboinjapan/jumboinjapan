import { getRouteContent } from '@/lib/route-content'
import { buildCityTourLiveStops } from '@/lib/city-tour-live-stops'
import { getMultiDayRouteSeoFieldsCached } from '@/lib/multi-day-builder-storage'
import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import { CityTourDayPage } from "@/components/sections/CityTourDayPage";
import { buildPageMetadata } from "@/lib/page-metadata";
import { guideRef } from "@/lib/schema";
import { RouteFaq } from '@/components/sections/RouteFaq'
import { JournalMentions } from '@/components/sections/JournalMentions'
import { typoDeep } from '@/lib/typography'

export const revalidate = 3600 // ISR: Airtable-backed (tag 'airtable:routes', invalidated via /api/revalidate on admin write)

const canonicalPath = "/city-tour/day-two";

// title/description reuse hero.title/hero.subtitle verbatim (no new copy) --
// same source fields day-one/hidden-spots draw their metadata from.
export const metadata = buildPageMetadata(canonicalPath, {
  title: "Токио. Второй день: Императорский сад, Асакуса и Одайба",
  description: "Императорский сад, Асакуса и Одайба — другой Токио от старых кварталов к заливу.",
  openGraph: {
    title: "Токио. Второй день | JumboInJapan",
    description: "Императорский сад, Асакуса и Одайба — другой Токио от старых кварталов к заливу.",
    images: [{ url: "/hero-city-tour-day-two.jpg" }],
  },
})

const hero = typoDeep({
  image: "/hero-city-tour-day-two.jpg",
  alt: "Панорама Токио на закате с горой Фудзи на горизонте",
  eyebrow: "6–8 часов",
  title: "Токио. Второй день",
  subtitle: "Императорский сад, Асакуса и Одайба — другой Токио от старых кварталов к заливу.",
  objectPosition: "center",
});

const program = typoDeep({
  title: "Токио. Второй день",
  description:
    "У меня есть личный рецепт идеального знакомства с Токио. Столица Японии очень многослойна: в ней легко увидеть и будущее, и прошлое…",
  duration: "6–8 часов",
});


const logistics = typoDeep({
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

export default async function CityTourDayTwoPage() {
  const { routeStopRecords: airtableStops, pois } = await getRouteContent('city-tour/day-two')
  const sortedStops = buildCityTourLiveStops(airtableStops, pois)
  const seo = await getMultiDayRouteSeoFieldsCached('city-tour/day-two')
  const liveHero = { ...hero, title: seo?.routeTitle || hero.title, displayTitle: seo?.routeTitle || hero.title, image: seo?.heroImagePath || hero.image, subtitle: seo?.previewSubtitle || hero.subtitle }
  const liveProgram = { ...program, description: seo?.routeIntro || program.description }

  // Schema mirrors day-one/hidden-spots: TouristTrip with guideRef provider
  // (was the only city-tour page without it — audit backlog item).
  const tourSchema = {
    "@context": "https://schema.org",
    "@type": "TouristTrip",
    '@id': `https://jumboinjapan.com${canonicalPath}` + '#trip',
    name: hero.title,
    description: hero.subtitle,
    disambiguatingDescription: describeTourDuration(program.duration),
    url: `https://jumboinjapan.com${canonicalPath}`,
    touristType: "Russian-speaking travelers",
    provider: guideRef,
    offers: buildTourOffer(`https://jumboinjapan.com${canonicalPath}`),
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
    <RouteFaq slug="city-tour/day-two" />
    <JournalMentions routeSlug="city-tour/day-two" locationNames={['Токио']} />
      </CityTourDayPage>
      </>
  );
}
