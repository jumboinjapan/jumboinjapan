import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import type { Metadata } from "next";
import { CityTourDayPage } from "@/components/sections/CityTourDayPage";
import { getCityTourDayOneStops } from "@/lib/city-tour-day-one";
import { hero, program, logistics } from "@/data/city-tour-day-one";
import { guideRef } from "@/lib/schema";
import { RouteFaq } from '@/components/sections/RouteFaq'
import { JournalMentions } from '@/components/sections/JournalMentions'

export const revalidate = 3600 // ISR: Airtable-backed (tag 'airtable:routes', invalidated via /api/revalidate on admin write)

const canonicalUrl = "https://jumboinjapan.com/city-tour/day-one";

export const metadata: Metadata = {
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
  const { airtableStops, stops: sortedStops } = await getCityTourDayOneStops()

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
      <CityTourDayPage hero={hero} program={program} stops={sortedStops} logistics={logistics} />
    <RouteFaq slug="city-tour/day-one" />
    <JournalMentions
      routeSlug="city-tour/day-one"
      poiIds={airtableStops.map((s) => s.poiId).filter(Boolean)}
      locationNames={[...sortedStops.map((s) => s.title), 'Токио']}
    />
      </>
  );
}
