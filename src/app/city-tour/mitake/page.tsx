import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import type { Metadata } from "next";
import { CityTourDayPage, type CityTourStop } from "@/components/sections/CityTourDayPage";
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
  image: "/hero-city-tour-day-one-tokyo-tower.jpg",
  eyebrow: "8–10 часов",
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

const stops: CityTourStop[] = typoDeep([
  {
    id: "mitake-station",
    number: "01 · Начало",
    title: "Станция Митаке и автобус к канатной дороге",
    text: "Из центра Токио едем по линии Тюо до Оме, затем пересаживаемся на линию Оме до станции Митаке. От остановки перед станцией автобус довозит до нижней станции канатной дороги; расписания поездов и автобуса сверяем перед выездом, потому что интервалы за городом заметно длиннее.",
    duration: "~1,5 часа из Токио",
  },
  {
    id: "takimoto",
    number: "02 · Подъём",
    title: "Канатная дорога Такимото",
    text: "От станции Такимото до станции Митакэсан вагон поднимается примерно за шесть минут. Проезд можно оплатить транспортной картой; кресельный подъёмник наверху оставляем как необязательное дополнение, поскольку он работает не всегда.",
    duration: "~15 минут",
  },
  {
    id: "village-visitor-center",
    number: "03 · Подготовка",
    title: "Горная деревня и визит-центр",
    text: "От верхней станции идём через горную деревню к визит-центру. Здесь удобно проверить погоду и состояние троп: центр публикует оперативные предупреждения и помогает решить, оставлять ли в программе полный круг по Рок-гардену.",
    duration: "~30 минут",
  },
  {
    id: "musashi-mitake",
    number: "04 · Святилище",
    title: "Святилище Мусаси-Митаке",
    text: "Поднимаемся к святилищу на вершине горы. Волчьи образы здесь связаны с почитанием оину-сама — горного защитника; древность святилища описываем как храмовую традицию, а не как точно датированную историю.",
    duration: "~45 минут",
  },
  {
    id: "rock-garden",
    number: "05 · Горный круг",
    title: "Рок-гарден, скала Тэнгу и водопад Аяхиро",
    text: "Круговая тропа ведёт через скалу Тэнгу к ручью Рок-гардена и десятиметровому водопаду Аяхиро. На основной круг закладываем около 2,5 часа. Ответвление к водопаду Нанаё добавляем только при подходящей погоде и физической форме: там крутой спуск и железные лестницы.",
    duration: "~2,5 часа",
  },
  {
    id: "nagaodaira",
    number: "06 · Вид",
    title: "Смотровая Нагаодайра",
    text: "После горного круга выходим к Нагаодайра — спокойной открытой площадке с беседкой и столами. Это удобное место для короткой паузы и вида на соседние хребты перед возвращением в деревню.",
    duration: "~20 минут",
  },
  {
    id: "mountain-lunch",
    number: "07 · Пауза",
    title: "Обед в горной деревне",
    text: "Обед планируем в одном из небольших заведений деревни и не привязываем маршрут к одному ресторану: часы работы меняются по сезону и дням недели. Конкретное место гид выбирает по загрузке и темпу группы.",
    duration: "~45 минут",
  },
  {
    id: "cable-descent",
    number: "08 · Спуск",
    title: "Спуск на канатной дороге",
    text: "Возвращаемся к станции Митакэсан и спускаемся к Такимото. Автобус ведёт обратно к станции Митаке; при усталости здесь можно завершить программу и сразу уехать в Токио.",
    duration: "~30 минут",
  },
  {
    id: "mitake-gorge",
    number: "09 · Ущелье",
    title: "Ущелье Митаке",
    text: "Если силы и световой день позволяют, от станции Митаке продолжаем пешком вдоль реки Тама в сторону Саваи. Променад проходит мимо мостов и храма Кандзандзи; актуальное состояние набережной проверяем перед поездкой.",
    duration: "~60 минут",
  },
  {
    id: "sawanoi",
    number: "10 · Завершение",
    title: "Саванои-эн и станция Саваи",
    text: "Завершаем прогулку в саду Саванои-эн при сакэварне Одзава. Здесь можно сделать паузу у реки, после чего за несколько минут дойти до станции Саваи и вернуться в Токио по линии Оме.",
    duration: "~30 минут",
  },
]);

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

const tourSchema = {
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
  itinerary: stops.map((stop) => ({
    "@type": "TouristAttraction",
    name: stop.title,
    description: stop.text.split("\n\n")[0],
  })),
};

export default async function MitakePage() {
  const airtableStops = await getIntercityRouteStopsCached('city-tour/mitake').catch(() => [])
  const sortedStops = applyCityTourStopOverrides(stops, airtableStops, 'city-tour/mitake')

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeTourSchema(tourSchema) }}
      />
      <CityTourDayPage hero={hero} program={program} stops={sortedStops} logistics={logistics} />
    <RouteFaq slug="city-tour/mitake" />
    <JournalMentions routeSlug="city-tour/mitake" locationNames={['Митакэ']} />
      </>
  );
}
