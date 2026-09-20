import { buildTourCollectionMetadata } from '@/lib/tour-collection-metadata'
import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import { tours } from '@/data/tours'

const tour = tours.find(t => t.slug === 'city-tour')!

export const metadata = buildTourCollectionMetadata(
  '/city-tour',
  'Экскурсии по Токио с гидом на русском',
  'Индивидуальные экскурсии по Токио: главные места, жилые кварталы и скрытые уголки. Русскоязычный гид, маршрут и транспорт под вашу поездку.',
  '/hero-city-tour-rainbow-bridge-tokyo-tower.jpg',
  'Радужный мост и Токийская башня',
)

const tourSchema = {
  "@context": "https://schema.org",
  "@type": "TouristTrip",
  '@id': `https://jumboinjapan.com/${tour.slug}` + '#trip',
  url: `https://jumboinjapan.com/${tour.slug}`,
  "name": tour.titleEn,
  "description": tour.description,
  disambiguatingDescription: describeTourDuration(tour.duration),
  "touristType": "Russian-speaking tourists",
  "provider": guideRef,
  offers: buildTourOffer(`https://jumboinjapan.com/${tour.slug}`)
}

import { ExperienceCard } from "@/components/sections/ExperienceCard";
import { type TransportCardProps } from "@/components/sections/TransportCard";
import { TourCollection, TourCollectionSection, TourCollectionGrid, TourCollectionTransport, TourCollectionContact } from '@/components/sections/TourCollection'
import { guideRef } from '@/lib/schema'
import { typoDeep } from '@/lib/typography'


const programs = typoDeep([
  {
    title: "Токио. Первый день",
    description:
      "Классический маршрут по главным точкам города — от Гинзы до Сибуи. То, что стоит увидеть в Токио первым делом, но без туристического конвейера.",
    duration: "6–8 часов",
    slug: "city-tour/day-one",
    image: "/hero-city-tour-day-one-tokyo-tower.jpg",
  },
  {
    title: "Токио. Второй день",
    description:
      "Другой Токио — районы, которые не попадают в стандартные маршруты. Янака, Симокитадзава, Коэнзи: город, в котором живут сами токийцы.",
    duration: "6–8 часов",
    slug: "city-tour/day-two",
    image: "/hero-city-tour-day-two.jpg",
  },
  {
    title: "Скрытые уголки Токио",
    description:
      "Маршрут легко выстроить под ваши интересы, темп и настроение. Блошиные рынки, мастерские, храмы без туристов. Токио, который не найти на карте.",
    duration: "Гибкий формат",
    slug: "city-tour/hidden-spots",
    image: "/hero-city-tour-hidden-spots.jpg",
  },
]);

const transportOptions: readonly TransportCardProps[] = typoDeep([
  {
    title: "Общественный транспорт",
    description:
      "Пешеходный ритм с переездами на метро или такси: быстро, экономно и ближе всего к повседневному Токио.",
    href: "/city-tour/public",
    image: "/city-tour-transport-public-v2.jpg",
    imageDisplay: "hero",
  },
  {
    title: "Частный транспорт",
    description:
      "Для удалённых районов и сложных переездов. Прогулки остаются частью дня; программу подбираем с учётом возвращения к машине.",
    href: "/city-tour/private",
    image: "/city-tour-transport-private-v4.jpg",
    imageDisplay: "hero",
  },
  {
    title: "Заказной транспорт",
    description:
      "Лимузин-сервис с просторным минивэном для семьи или группы, когда важно ехать вместе и беречь силы.",
    href: "/city-tour/charter",
    image: "/city-tour-transport-limousine-v2.jpg",
    imageDisplay: "hero",
  },
]);

export default function CityTourPage() {

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeTourSchema(tourSchema) }}
      />
      <TourCollection
        image="/hero-city-tour-rainbow-bridge-tokyo-tower.jpg"
        alt="Радужный мост и Токийская башня на вечернем горизонте Токио"
        eyebrow="Индивидуальные экскурсии по Токио"
        title="Токио — не за один день"
        subtitle="Главные места, жилые кварталы и скрытые уголки города. Три маршрута с русскоязычным гидом, каждый в вашем темпе."
      >
        <TourCollectionSection id="routes" title="С какого Токио начнём"
          description="Первый день знакомит с главными местами, второй дополняет картину города. Скрытые уголки — для тех, кто уже бывал в Токио или ищет менее известные маршруты.">
          <TourCollectionGrid>
            {programs.map((program) => <ExperienceCard key={program.slug} {...program} />)}
          </TourCollectionGrid>
        </TourCollectionSection>
        <TourCollectionTransport options={transportOptions} />
        <TourCollectionContact />
      </TourCollection>
    </>
  );
}
