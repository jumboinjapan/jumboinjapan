import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import type { Metadata } from "next";
import { CityTourDayPage, type CityTourStop } from "@/components/sections/CityTourDayPage";
import { guideRef } from "@/lib/schema";
import { RouteFaq } from '@/components/sections/RouteFaq'
import { JournalMentions } from '@/components/sections/JournalMentions'
import { typoDeep } from '@/lib/typography'
import { getIntercityRouteStopsCached } from '@/lib/airtable'
import { applyCityTourStopOverrides } from '@/lib/city-tour-overrides'

const canonicalUrl = "https://jumboinjapan.com/city-tour/takao";

export const metadata: Metadata = {
  title: "Пеший тур на гору Такао: маршрут с гидом из Токио",
  description:
    "Однодневный тур на гору Такао из Токио: кресельный подъёмник, мост Мияма, храм Якуо-ин, вершина, фуникулёр и онсэн. Индивидуальная экскурсия с русскоязычным гидом.",
  alternates: {
    canonical: canonicalUrl,
  },
  openGraph: {
    title: "Пеший тур на гору Такао | JumboInJapan",
    description:
      "Гора Такао: маршрут через мост Мияма, ступу Буссяри, храм Якуо-ин и вершину со спуском на фуникулёре. Тур с русскоязычным гидом.",
    url: canonicalUrl,
    images: [{ url: "/hero-city-tour-day-one-tokyo-tower.jpg" }],
  },
};

const hero = typoDeep({
  image: "/hero-city-tour-day-one-tokyo-tower.jpg",
  eyebrow: "6–8 часов",
  title: "Пеший тур на гору Такао",
  subtitle:
    "Кресельный подъёмник, лесная тропа, Якуо-ин, вершина, спуск на фуникулёре и онсэн.",
  objectPosition: "center",
});

const program = typoDeep({
  title: "Пеший тур на гору Такао",
  description:
    "От станции Такаосангути поднимаемся на кресельном подъёмнике и продолжаем пешком: сворачиваем к мосту Мияма, проходим развилку Отоко-дзака и Онна-дзака, ступу Буссяри и храм Якуо-ин. После вершины спускаемся на фуникулёре. Онсэн у станции можно оставить спокойным завершением дня.",
  duration: "6–8 часов",
});

const stops: CityTourStop[] = typoDeep([
  {
    id: "takaosanguchi",
    number: "01 · Начало",
    title: "Станция Такаосангути",
    text: "Такаосангути — это ворота в горный маршрут. Здесь заканчивается городская линия Кэйо и начинается настоящая природа. Район вокруг станции сохранил старый курортный характер: небольшие рестораны с тофу и соба, сувенирные лавки и таблички с указателями на тропы. Именно отсюда начинается подъём на гору Такао, и уже на этом этапе видно, как быстро Токио сменяется лесом.",
    duration: "~20 минут",
  },
  {
    id: "chair-lift",
    number: "02 · Подъём",
    title: "Кресельный подъёмник горы Такао",
    text: "От нижней станции Санроку двухместный кресельный подъёмник идёт над лесным склоном к станции Сандзё. Поездка занимает около 12 минут и выводит на среднюю часть горы, откуда начинается основной пешеходный отрезок маршрута.",
    duration: "~20 минут",
  },
  {
    id: "miyama-bridge",
    number: "03 · Лесная тропа",
    title: "Подвесной мост Мияма",
    text: "С основной дорожки сворачиваем на маршрут № 4 к единственному подвесному мосту на горе. Мост Мияма проходит среди букового леса и добавляет к программе короткий природный отрезок вдали от более оживлённой храмовой дороги.",
    duration: "~35 минут",
  },
  {
    id: "otoko-busshari-onna",
    number: "04 · Горная традиция",
    title: "Отоко-дзака, ступа Буссяри и Онна-дзака",
    text: "На развилке выбираем Отоко-дзака — лестницу из 108 ступеней, число которых связывают со 108 буддийскими омрачениями. Наверху делаем короткий обход к ступе Буссяри с реликвией Будды, переданной из Таиланда, а к основной тропе возвращаемся по более пологой Онна-дзака.",
    duration: "~30 минут",
  },
  {
    id: "yakuo-in",
    number: "05 · Храм",
    title: "Храм Якуо-ин",
    text: "Якуо-ин — главный буддийский храмовый комплекс горы Такао, основанный в 744 году. На его территории видны следы синкретической горной традиции: буддийские залы соседствуют с образами тэнгу, которых здесь почитают как спутников божества Идзуна Дайгонгэн.",
    duration: "~40 минут",
  },
  {
    id: "summit",
    number: "06 · Вершина",
    title: "Вершина горы Такао",
    text: "От Якуо-ин до вершины остаётся около 15 минут подъёма. На высоте 599 метров устроена широкая обзорная площадка: в ясную погоду отсюда видны городские районы Токио и Фудзи. Здесь предусмотрена пауза перед обратной дорогой.",
    duration: "~35 минут",
  },
  {
    id: "cable-car",
    number: "07 · Спуск",
    title: "Фуникулёр горы Такао",
    text: "На обратном пути используем фуникулёр между станциями Такаосан и Киётаки. Его путь длиной около километра проходит по склону с максимальным уклоном более 31 градуса; поездка занимает примерно шесть минут.",
    duration: "~20 минут",
  },
  {
    id: "takaosan-onsen",
    number: "08 · По желанию",
    title: "Онсэн Кэйо Такаосан Гокуракую",
    text: "Термальный комплекс находится рядом со станцией Такаосангути, поэтому его удобно оставить на конец маршрута. Здесь есть природные щелочные купальни под открытым небом, сауна и ресторан. Посещение не подходит гостям с татуировками: правила комплекса запрещают вход даже с закрытыми татуировками.",
    duration: "~60–90 минут",
  },
]);

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

export default async function TakaoPage() {
  const airtableStops = await getIntercityRouteStopsCached('city-tour/takao').catch(() => [])
  const sortedStops = applyCityTourStopOverrides(stops, airtableStops, 'city-tour/takao')

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeTourSchema(tourSchema) }}
      />
      <CityTourDayPage hero={hero} program={program} stops={sortedStops} logistics={logistics} />
    <RouteFaq slug="city-tour/takao" />
    <JournalMentions routeSlug="city-tour/takao" locationNames={['Такао']} />
      </>
  );
}
