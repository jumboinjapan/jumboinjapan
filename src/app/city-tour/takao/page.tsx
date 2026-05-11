import type { Metadata } from "next";
import { CityTourDayPage, type CityTourStop } from "@/components/sections/CityTourDayPage";

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
    images: [{ url: "/hero-city-tour-takao.jpg" }],
  },
};

const hero = {
  image: "/hero-city-tour-day-one-tokyo-tower.jpg",
  eyebrow: "4–6 часов",
  title: "Пеший тур на гору Такао",
  subtitle:
    "Такаосангути, Якуо-ин, канатная дорога и вершина горы — спокойный горный день в часе от Токио.",
  objectPosition: "center",
};

const program = {
  title: "Пеший тур на гору Такао",
  description:
    "Гора Такао — одна из самых доступных горных прогулок рядом с Токио. Маршрут начинается у станции Такаосангути, проходит через храм Якуо-ин, поднимается по тропам или канатной дороге к вершине и возвращается через лесные маршруты. Это не туристический подъёмник, а настоящая прогулка по японской природе с элементами синто и буддизма. Удобно для тех, кто хочет вырваться из города без долгой дороги.",
  duration: "4–6 часов",
};

const stops: CityTourStop[] = [
  {
    id: "takaosanguchi",
    number: "01 · Начало",
    title: "Станция Такаосангути",
    text: "Такаосангути — это ворота в горный маршрут. Здесь заканчивается городская линия Кэйо и начинается настоящая природа. Район вокруг станции сохранил старый курортный характер: небольшие рестораны с тофу и соба, сувенирные лавки и таблички с указателями на тропы. Именно отсюда начинается подъём на гору Такао, и уже на этом этапе видно, как быстро Токио сменяется лесом.",
    duration: "~20 минут",
    photo: "/tours/city-tour-day-one/ginza-six.jpg",
    alt: "Вход в район горы Такао у станции Такаосангути",
  },
  {
    id: "yakuo-in",
    number: "02 · Утро",
    title: "Храм Якуо-ин",
    text: "Якуо-ин — это синто-буддийский комплекс у подножия горы, известный ритуалами огня и защитой путников. Главный зал и маленькие святилища стоят среди кедров, а на территории часто можно увидеть монахов и посетителей, совершающих ритуалы. Здесь мы говорим о том, как в Японии горы всегда были местом духовной практики, а не только природной красоты. Храм служит естественным переходом от города к лесу.",
    duration: "~40 минут",
    photo: "/tours/city-tour-day-one/meiji-jingu.jpg",
    alt: "Храм Якуо-ин у подножия горы Такао",
  },
  {
    id: "cable-car",
    number: "03 · Подъём",
    title: "Канатная дорога Такао",
    text: "Канатная дорога на Такао — один из самых коротких и живописных подъёмников в окрестностях Токио. Вагончики медленно поднимаются над лесом, открывая вид на долину и город вдалеке. Многие выбирают комбинированный маршрут: часть пути пешком, часть — на канатной дороге. Это позволяет сохранить силы для вершины и при этом не пропустить характерный ландшафт горы.",
    duration: "~15 минут",
    photo: "/tours/city-tour-day-two/harajuku.jpg",
    alt: "Канатная дорога на горе Такао над лесом",
  },
  {
    id: "summit",
    number: "04 · Вершина",
    title: "Вершина горы Такао",
    text: "Вершина Такао (599 м) — это не острый пик, а широкая площадка с обзорной точкой и небольшим храмом. В ясную погоду отсюда видно Токио и, при удаче, Фудзи. Здесь мы делаем паузу: говорим о том, почему Такао стала популярной ещё в эпоху Эдо, как устроены горные маршруты в Японии и почему даже короткий подъём даёт ощущение настоящего горного дня. Лес вокруг вершины особенно густой и тихий.",
    duration: "~45 минут",
    photo: "/tours/city-tour-day-one/shibuya-crossing-night.jpg",
    alt: "Обзорная площадка на вершине горы Такао",
  },
];

const logistics = {
  intro:
    "Для тура на Такао удобнее всего электричка + пешком или канатная дорога. Маршрут хорошо подходит для полудня или дня с возвращением к вечеру.",
  options: [
    {
      title: "Электричка + пешком",
      text: "Прямой поезд до Такаосангути, затем подъём своими силами или с гидом. Самый аутентичный вариант.",
    },
    {
      title: "Канатная дорога",
      text: "Часть маршрута можно пройти на канатной дороге, чтобы сэкономить время и силы для вершины.",
    },
    {
      title: "Такси / трансфер",
      text: "Удобно для групп или тех, кто хочет минимизировать переезды и сразу начать прогулку.",
    },
  ],
};

const tourSchema = {
  "@context": "https://schema.org",
  "@type": "TouristTrip",
  name: "Hiking Tour to Mount Takao",
  description:
    "Guided hiking day trip to Mount Takao from Tokyo: Takaosanguchi, Yakuo-in temple, cable car and summit trail.",
  url: canonicalUrl,
  touristType: "Russian-speaking travelers",
  provider: {
    "@type": "Person",
    name: "Eduard Revidovich",
    url: "https://jumboinjapan.com",
  },
  offers: {
    "@type": "Offer",
    availability: "https://schema.org/InStock",
    url: canonicalUrl,
  },
  itinerary: stops.map((stop) => ({
    "@type": "TouristAttraction",
    name: stop.title,
    description: stop.text.split("\n\n")[0],
  })),
};

export default function TakaoPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <CityTourDayPage hero={hero} program={program} stops={stops} logistics={logistics} />
    </>
  );
}
