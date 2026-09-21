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

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TourAlbum, TourAlbumCover, TourAlbumTransport, TourAlbumContact } from "@/components/sections/TourAlbum";
import styles from "@/components/sections/TourAlbum.module.css";
import { type TransportCardProps } from "@/components/sections/TransportCard";
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
      "Императорский сад, Асакуса и Одайба — другой Токио от старых кварталов к заливу.",
    duration: "6–8 часов",
    slug: "city-tour/day-two",
    image: "/hero-city-tour-day-two.jpg",
  },
  {
    title: "Скрытые уголки Токио",
    description:
      "Сибамата, Янака Гинза, Акихабара и вечерние переулки Синдзюку. Маршрут с акцентом на повседневную жизнь города.",
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
      <TourAlbum>
        <TourAlbumCover directions={programs.map(program => ({ title: program.title, href: `/${program.slug}` }))} collection
          image="/hero-city-tour-rainbow-bridge-tokyo-tower.jpg"
          alt="Радужный мост и Токийская башня на вечернем горизонте Токио"
          title="Токио — не за один день"
          subtitle="Главные места, жилые кварталы и скрытые уголки города."
          intro="Первый день знакомит с главными местами, второй дополняет картину города. Скрытые уголки — для тех, кто уже бывал в Токио или ищет менее известные маршруты. Каждую поездку подбираем под ваши интересы и темп."
        />
        <section id="routes" className={styles.program} aria-labelledby="routes-title">
          <div className={styles.sectionHead}><h2 id="routes-title">С какого Токио начнём</h2></div>
          <div className={styles.collectionList}>
            {programs.map((program, index) => <Link key={program.slug} href={`/${program.slug}`} className={styles.collectionCard}>
              <div>
                <p className={styles.cardMeta}>{String(index + 1).padStart(2, '0')} · {program.duration}</p>
                <h3>{program.title}</h3><p>{program.description}</p>
                <span className={styles.routeLink}>Посмотреть маршрут <ArrowRight size={16} aria-hidden="true" /></span>
              </div>
              <div className={styles.collectionPhoto}><Image src={program.image} alt={program.title} fill quality={90} sizes="(max-width: 767px) 100vw, 40vw" /></div>
            </Link>)}
          </div>
        </section>
        <TourAlbumTransport options={transportOptions.map(option => ({ title: option.title, text: option.description, href: option.href, image: option.image! }))} />
        <TourAlbumContact />
      </TourAlbum>
    </>
  );
}
