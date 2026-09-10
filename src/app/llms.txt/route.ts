import { tours } from '@/data/tours'
import { serviceTerms } from '@/data/service-terms'
import { BASE_URL } from '@/lib/schema'

export const dynamic = 'force-static'
export const revalidate = false

export async function GET() {
  // Reuse the public catalogue used by pages. Dynamic programmes remain
  // discoverable through the public hub and sitemap; no separate POI export.
  const tourList = tours.map(t =>
    `- [${t.shortTitle}](${BASE_URL}/${t.slug}): ${t.duration}. Регион: ${t.region}.`,
  ).join('\n')

  const content = `# JumboInJapan — частный гид по Японии

> Эдуард Ревидович — частный гид в Японии, живёт в Токио. Индивидуальные экскурсии на русском языке и маршруты по стране под интересы и темп группы.

${serviceTerms.language}

${serviceTerms.pricing} ${serviceTerms.inquiry}

Чтобы обсудить поездку, достаточно указать даты, количество человек, города и интересы. Продолжительность и состав конкретной программы описаны на её странице. Токио — место базирования гида; город начала каждой поездки нужно уточнять по выбранному маршруту.

## Услуги и направления

${tourList}

## Подробные маршруты по Токио

- [Токио за один день](${BASE_URL}/city-tour/day-one): программа, остановки и варианты транспорта.
- [Второй день в Токио](${BASE_URL}/city-tour/day-two): программа и логистика.
- [Нетуристический Токио](${BASE_URL}/city-tour/hidden-spots): индивидуальная программа по районам города.
- [Гора Такао](${BASE_URL}/city-tour/takao): маршрут и продолжительность прогулки.
- [Гора Митакэ](${BASE_URL}/city-tour/mitake): маршрут и продолжительность прогулки.

## Планирование и обращение

- [Обсудить маршрут](${BASE_URL}/contact): обращение к гиду, индивидуальная стоимость и порядок обсуждения поездки.
- [Вопросы о поездке](${BASE_URL}/faq): практические ответы для подготовки путешествия.
- [Многодневные программы](${BASE_URL}/multi-day): актуальная публичная подборка маршрутов по стране.
- [Транспорт по Токио](${BASE_URL}/city-tour): сравнение форматов передвижения.
- [Журнал](${BASE_URL}/journal): авторские материалы о Японии.

## Optional

- [Об авторе и формате работы](${BASE_URL}): информация о гиде и услугах.
- [Карта сайта](${BASE_URL}/sitemap.xml): адреса индексируемых страниц, включая опубликованные программы.
- [Instagram Jumbo in Japan](https://www.instagram.com/jumboinjapan/): профиль проекта.
`

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
