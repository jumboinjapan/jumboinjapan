import { takaoHeroImage } from '@/data/route-hero-images'
import { buildTourCollectionMetadata } from '@/lib/tour-collection-metadata'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { TourAlbum, TourAlbumCover, TourAlbumTransport, TourAlbumContact } from '@/components/sections/TourAlbum'
import styles from '@/components/sections/TourAlbum.module.css'
import { typoDeep } from '@/lib/typography'
import { listDayTourCatalog } from '@/lib/multi-day-builder-storage'
import { mergeRouteCatalog } from '@/lib/route-catalog'

export const metadata = buildTourCollectionMetadata(
  '/intercity',
  'Загородные туры из Токио с гидом на русском',
  'Индивидуальные выезды из Токио: Хаконе, Фудзи, Никко, Камакура. Экскурсии по Киото и другим городам Японии с русскоязычным гидом.',
  '/hero-intercity.jpg',
  'Япония за пределами Токио',
)


const programGroupSeeds = typoDeep([
  {
    id: "near-tokyo",
    title: "Регион Канто",
    note: "Направления для выезда из столицы на один день.",
    items: [
      {
        title: "Хаконе",
        description: "Горный курорт, горячие источники и идеальная остановка на пути в Киото.",
        duration: "День и более",
        slug: "intercity/hakone",
        image: "/tours/hakone/hakone-1.jpg",
        imagePosition: "center bottom",
      },
      {
        title: "Гора Фудзи",
        description: "Четыре ракурса великой горы — от кратера до деревни у подножия.",
        duration: "Полный день",
        slug: "intercity/fuji",
        image: "/tours/fuji/fuji-kawaguchiko.jpg",
      },
      {
        title: "Никко",
        description: "Мавзолей Тосёгу, горные водопады и осенние клёны. Духовный центр Японии в 2 часах от Токио.",
        duration: "Полный день",
        slug: "intercity/nikko",
        image: "/tours/nikko/kanmangafuchi-jizo.jpg",
      },
      {
        title: "Камакура",
        description: "Великий Будда, самурайские святилища и Тихий океан.",
        duration: "Полный день",
        slug: "intercity/kamakura",
        image: "/tours/kamakura/kamakura-2.jpg",
      },
      {
        title: "Эносима",
        description: "Остров с драконьими пещерами, морской гастрономией и видом на Фудзи.",
        duration: "Полный день",
        slug: "intercity/enoshima",
        image: "/tours/enoshima/enoshima-fuji-sea.jpg",
        imagePosition: "right center",
      },
      {
        title: "Гора Такао",
        description: "Лесные тропы, храм Якуо-ин и подъём на вершину.",
        duration: "6–8 часов",
        slug: "city-tour/takao",
        image: takaoHeroImage,
      },
      {
        title: "Гора Митаке",
        description: "Горное святилище, Рок-гарден и прогулка по ущелью до Саваи.",
        duration: "8–10 часов",
        slug: "city-tour/mitake",
        image: "",
      },
      // Пакет из админки (Airtable Routes): название, описание и фото приходят
      // оттуда через mergeRouteCatalog, здесь — только место в блоке Канто.
      {
        title: "Гора Нокогири",
        description: "Канатная дорога, Каннон, «Взгляд в ад», раканские статуи и Большой Будда Нихондзи.",
        duration: "Полный день",
        slug: "intercity/nokogiriyama",
        image: "",
      },
    ],
  },
  {
    id: "kansai",
    title: "Киото и Кансай",
    note: "Прогулки по Киото и соседним городам во время поездки по региону Кансай.",
    items: [
      {
        title: "Киото. Первое знакомство",
        description: "Золотой павильон, сад камней Рёандзи, рынок Нисики и квартал гейш Гион.",
        duration: "День и более",
        slug: "intercity/kyoto-1",
        image: "/tours/kyoto-1/kinkakuji.jpg",
      },
      {
        title: "Киото. Продолжение",
        description: "Серебряный павильон, Философская тропа, Арасияма и бамбуковый лес.",
        duration: "День и более",
        slug: "intercity/kyoto-2",
        image: "/tours/kyoto-2/kyoto-1.jpg",
      },
      {
        title: "Нара",
        description: "Великий Будда в Тодай-дзи, святилище тысячи фонарей и свободные олени в парке.",
        duration: "Полный день",
        slug: "intercity/nara",
        image: "/tours/nara/nara-deer-autumn.jpg",
      },
      {
        title: "Удзи",
        description: "Чайная столица Японии. Павильон Феникса и улочки с маття-мороженым.",
        duration: "Полный день",
        slug: "intercity/uji",
        image: "/tours/uji/byodoin-phoenix-hall.jpg",
      },
      {
        title: "Осака",
        description: "Торговая столица Японии, квартал Дотонбори, такояки и Осакский замок.",
        duration: "Полный день",
        slug: "intercity/osaka",
        image: "/tours/osaka/shinsekai-tsutenkaku.jpg",
      },
      {
        title: "Химэдзи",
        description: "Замок Белой Цапли — лучший феодальный замок Японии и сад Кокоэн у его стен.",
        duration: "Полный день",
        slug: "intercity/himeji",
        image: "/tours/himeji/himeji-castle-sakura.jpg",
      },
    ],
  },
  {
    id: "overnight",
    title: "С остановкой на ночь",
    note: "Для поездки с ночёвкой или продолжения путешествия по стране.",
    items: [
      {
        title: "Канадзава",
        description: "Сад Кэнрокуэн, квартал гейш, рыбный рынок и музей современного искусства.",
        duration: "День и более",
        slug: "intercity/kanazawa",
        image: "/tours/kanazawa/kenrokuen-winter.jpg",
        imagePosition: "right center",
      },
    ],
  },
]);

const transportOptions = typoDeep([
  {
    title: "Общественный транспорт",
    description:
      "Поезда и автобусы с пересадками по пути. Маршрут зависит от расписания и подходит тем, кому комфортно много ходить.",
    href: "/intercity/public",
    image: "/city-tour-transport-public-v2.jpg",
    imageDisplay: "hero" as const,
  },
  {
    title: "Частный транспорт",
    description:
      "Выезд от отеля и остановки по пути. Транспорт по договорённости позволяет менять программу по погоде и настроению.",
    href: "/intercity/private",
    image: "/city-tour-transport-private-v4.jpg",
    imageDisplay: "hero" as const,
  },
  {
    title: "Заказной транспорт",
    description:
      "Лимузин-сервис с просторным минивэном на весь день для семьи или группы, которая путешествует вместе.",
    href: "/city-tour/charter",
    image: "/city-tour-transport-limousine-v2.jpg",
    imageDisplay: "hero" as const,
  },
]);

export default async function IntercityPage() {
  const records = await listDayTourCatalog()
  const allSeeds = programGroupSeeds.flatMap(group => group.items)
  const cards = mergeRouteCatalog(allSeeds, records, 'intercity')
  const bySlug = new Map(cards.map(card => [card.slug, card]))
  const programGroups = programGroupSeeds.map(group => ({ ...group,
    items: group.items.flatMap(seed => bySlug.has(seed.slug) ? [bySlug.get(seed.slug)!] : []),
  }))
  const known = new Set(allSeeds.map(seed => seed.slug))
  const added = cards.filter(card => !known.has(card.slug))
  if (added.length) programGroups.push({ id: 'more-routes', title: 'Другие направления', note: '', items: added })

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "name": "Загородные туры из Токио с гидом на русском",
          "description": "Однодневные и многодневные туры из Токио: Хаконе, Никко, Камакура, Киото, Осака, Нара, Канадзава.",
          "url": "https://jumboinjapan.com/intercity",
          "inLanguage": "ru",
          "hasPart": [
            { "@type": "TouristTrip", "name": "Тур в Хаконе из Токио", "url": "https://jumboinjapan.com/intercity/hakone" },
            { "@type": "TouristTrip", "name": "Тур в Никко из Токио", "url": "https://jumboinjapan.com/intercity/nikko" },
            { "@type": "TouristTrip", "name": "Тур в Камакуру из Токио", "url": "https://jumboinjapan.com/intercity/kamakura" },
            { "@type": "TouristTrip", "name": "Тур в Киото из Токио (день 1)", "url": "https://jumboinjapan.com/intercity/kyoto-1" },
            { "@type": "TouristTrip", "name": "Тур в Киото из Токио (день 2)", "url": "https://jumboinjapan.com/intercity/kyoto-2" },
            { "@type": "TouristTrip", "name": "Тур в Осаку из Токио", "url": "https://jumboinjapan.com/intercity/osaka" },
            { "@type": "TouristTrip", "name": "Тур в Нару из Токио", "url": "https://jumboinjapan.com/intercity/nara" },
            { "@type": "TouristTrip", "name": "Тур на гору Фудзи из Токио", "url": "https://jumboinjapan.com/intercity/fuji" },
            { "@type": "TouristTrip", "name": "Тур на Эносиму из Токио", "url": "https://jumboinjapan.com/intercity/enoshima" },
            { "@type": "TouristTrip", "name": "Тур в Канадзаву из Токио", "url": "https://jumboinjapan.com/intercity/kanazawa" },
            { "@type": "TouristTrip", "name": "Тур в Химэдзи из Токио", "url": "https://jumboinjapan.com/intercity/himeji" },
            { "@type": "TouristTrip", "name": "Тур в Удзи из Токио", "url": "https://jumboinjapan.com/intercity/uji" }
          ]
        }) }}
      />
      <TourAlbum>
        <TourAlbumCover collectionSections={programGroups.map(group => ({ title: group.title, href: `#${group.id}` }))} collection section="intercity"
          title="Япония за пределами Токио"
          subtitle="Хаконе, Никко, Камакура и дальше по стране."
          intro="Из Токио удобно начать с ближайших направлений. Киото и соседние города лучше включить в продолжение путешествия по стране."
          image="/hero-intercity.jpg" alt="Пейзаж Японии за пределами Токио" />
        <section id="routes" className={styles.program} aria-labelledby="routes-title">
          <div className={styles.sectionHead}><h2 id="routes-title">Куда отправимся</h2></div>
          {programGroups.map((group) => (
            <section key={group.id} id={group.id} className={styles.destinationGroup} aria-labelledby={`${group.id}-title`}>
              <div className={styles.destinationHeading}>
                <h3 id={`${group.id}-title`}>{group.title}</h3><p>{group.note}</p>
              </div>
              <div className={styles.destinationGrid}>
                {group.items.map((program) => <Link key={program.slug} href={`/${program.slug}`} className={styles.destinationCard}>
                  <div className={styles.collectionPhoto}>{program.image && <Image src={program.image} alt={program.title} fill
                    sizes="(max-width: 767px) 100vw, 50vw" style={{ objectPosition: program.imagePosition || 'center' }} />}</div>
                  <p className={styles.cardMeta}>{program.duration}</p>
                  <h4>{program.title}</h4><p>{program.description}</p>
                  <span className={styles.routeLink}>Смотреть маршрут <ArrowRight size={16} aria-hidden="true" /></span>
                </Link>)}
              </div>
            </section>
          ))}
        </section>
        <TourAlbumTransport options={transportOptions.map(({ description: text, ...option }) => ({ ...option, text }))} />
        <TourAlbumContact />
      </TourAlbum>
    </>
  );
}
