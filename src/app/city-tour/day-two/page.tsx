import { CityTourDayPage, type CityTourStop } from "@/components/sections/CityTourDayPage";
import { getIntercityRouteStopsCached } from "@/lib/airtable";
import { buildPageMetadata } from "@/lib/page-metadata";
import { guideRef } from "@/lib/schema";
import { RouteFaq } from '@/components/sections/RouteFaq'

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

const hero = {
  image: "/hero-city-tour-day-two.jpg",
  alt: "Панорама Токио на закате с горой Фудзи на горизонте",
  eyebrow: "6–8 часов",
  title: "Токио. Второй день",
  subtitle: "Императорский сад, Асакуса и Одайба — другой Токио от старых кварталов к заливу.",
  objectPosition: "center",
};

const program = {
  title: "Токио. Второй день",
  description:
    "У меня есть личный рецепт идеального знакомства с Токио. Столица Японии очень многослойна: в ней легко увидеть и будущее, и прошлое...",
  duration: "6–8 часов",
};

const stops: CityTourStop[] = [
  {
    id: "imperial-palace",
    number: "01 · Утро",
    title: "Императорский дворец (Восточный сад)",
    text: "Восточный сад Императорского дворца станет одной из самых спокойных и исторически насыщенных точек маршрута. Мы начинаем у Palace Hotel Tokyo, откуда сразу попадаем в пространство, где особенно ясно чувствуется связь между Эдо и современным Токио. Каменная кладка крепостных стен, старые рвы, сосны и карпы кои в прудах напоминают о времени, когда город был центром военной аристократии, а затем превратился в политическое сердце современной Японии.\n\nВосточный сад Императорского дворца открыт для публики и не требует предварительного бронирования, но именно утром он производит особенно сильное впечатление. В это время здесь тише всего: мягкий свет ложится на старые каменные стены, подчёркивает рельеф бывшего замка Эдо и создаёт редкое в центре города ощущение простора.",
    duration: "~50 минут",
    photo: "/tours/city-tour-day-two/nijubashi.jpg",
    alt: "Нидзюбаси и Восточный сад Императорского дворца в Токио",
  },
  {
    id: "tokyo-station",
    number: "02 · Середина утра",
    title: "Токийский вокзал и Маруноути",
    text: "Здесь можно встретить один из самых наглядных примеров того, как Япония превращала модернизацию в архитектуру. Токийский вокзал стал важным символом новой страны начала XX века, а район Маруноути, где когда-то находились усадьбы самурайской знати, со временем превратился в деловой центр с штаб-квартирами крупнейших японских корпораций. Здесь особенно хорошо видно, как бывшая территория власти и статуса получила новую жизнь в логике современного Токио.\n\nПо пути мы поднимемся на смотровую площадку KITTE, расположенную в здании бывшего центрального почтамта, чтобы увидеть площадь перед вокзалом и его знаменитый фасад с лучшей точки обзора. Рядом особенно выразительно работает и Tokyo International Forum: его стеклянная архитектура добавляет в этот маршрут ещё один важный токийский контраст — между исторической тяжестью, деловой дисциплиной и языком поздней современной инженерии.",
    duration: "~45 минут",
    photo: "/tours/city-tour-day-two/marunouchi-cityscape.jpg",
    alt: "Ночной городской пейзаж Маруноути у Токийского вокзала",
  },
  {
    id: "asakusa",
    number: "03 · Обед",
    title: "Асакуса и Сэнсо-дзи",
    text: "Этот район — важная часть любого маршрута по Токио, если хочется увидеть город не только современным, но и исторически многослойным. Здесь находится Сэнсо-дзи, один из самых известных и почитаемых буддийских храмов Японии, а дорога к нему проходит через торговую улицу Накамисэ, где до сих пор сохраняется атмосфера старого городского паломничества. Это место особенно нравится тем, кто интересуется сувенирами, ремесленными вещами, традиционной утварью и повседневной культурой старого Эдо.\n\nЗдесь же удобно сделать остановку на обед. В районе Асакуса можно выбрать и классическую тэмпуру, и более спокойные сезонные сеты в небольших ресторанах, спрятанных в переулках за храмом. Это хорошее место, чтобы поговорить о буддизме в Японии, городской культуре паломничества и о том, как религиозное пространство в Токио продолжает жить внутри повседневной жизни города.",
    duration: "~70 минут",
    photo: "/tours/city-tour-day-two/sensoji.jpg",
    alt: "Асакуса и храм Сэнсо-дзи",
  },
  {
    id: "odaiba",
    number: "04 · День",
    title: "Одайба",
    text: "Одайба показывает совсем другое лицо Токио — более открытое, футуристичное и связанное с морем. После Асакусы мы отправимся к Токийскому заливу на искусственный остров, который стал символом городской экспансии на насыпные территории. Уже сама поездка на линии Юрикамомэ или на не менее футуристичном речном трамвае через Rainbow Bridge воспринимается как отдельная сцена маршрута: по мере движения постепенно раскрывается панорама воды, небоскрёбов и портового горизонта.\n\nНа месте можно пройтись по набережной, посмотреть на Радужный мост и skyline центра города, заглянуть в современные комплексы вроде DiverCity или Aqua City и обсудить, как Токио осваивал берег залива, превращая его в пространство отдыха, технологий и урбанистики. Одайба хорошо показывает ещё одну важную сторону японской столицы: её способность постоянно конструировать новые городские ландшафты почти с нуля.",
    duration: "~90 минут",
    photo: "/tours/city-tour-day-two/odaiba.jpg",
    alt: "Одайба, Rainbow Bridge и вечерний вид на Токийский залив",
  },
];

const logistics = {
  options: [
    {
      title: "Общественный транспорт",
      text: "Пешеходный ритм с переездами на метро или такси: быстро, экономно и ближе всего к повседневному Токио.",
    },
    {
      title: "Частный транспорт",
      text: "Городская программа в основном пешеходная: переходы заметные, и к машине маршрут возвращается. Зато становятся доступными более сложные по логистике маршруты — удалённые районы и точки вне пешей досягаемости, поэтому под частный транспорт существуют отдельные варианты программ.",
    },
    {
      title: "Заказной транспорт",
      text: "Лимузин-сервис с просторным минивэном — вариант для семьи или группы, когда важно ехать всем вместе и беречь силы. Комфорт предсказуем в любую погоду и любой час дня.",
    },
  ],
};

export default async function CityTourDayTwoPage() {
  // Sort stops by Airtable order
  const airtableStops = await getIntercityRouteStopsCached('city-tour/day-two').catch(() => [])
  const stopOrder = Object.fromEntries(airtableStops.map((s, i) => [
    s.titleOverride || s.poiNameSnapshot, s.order || (i + 1)
  ]))
  const sortedStops = [...stops].sort((a, b) => {
    const aOrder = stopOrder[a.title] ?? 999
    const bOrder = stopOrder[b.title] ?? 999
    return aOrder - bOrder
  })

  // Schema mirrors day-one/hidden-spots: TouristTrip with guideRef provider
  // (was the only city-tour page without it — audit backlog item).
  const tourSchema = {
    "@context": "https://schema.org",
    "@type": "TouristTrip",
    name: "Tokyo Day Two Guided Tour",
    description:
      "One-day guided Tokyo itinerary covering the Imperial Palace East Gardens, Asakusa and Odaiba.",
    url: `https://jumboinjapan.com${canonicalPath}`,
    touristType: "Russian-speaking travelers",
    provider: guideRef,
    offers: {
      "@type": "Offer",
      availability: "https://schema.org/InStock",
      url: `https://jumboinjapan.com${canonicalPath}`,
    },
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <CityTourDayPage hero={hero} program={program} stops={sortedStops} logistics={logistics} />
    <RouteFaq slug="city-tour/day-two" />
      </>
  );
}

