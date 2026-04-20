import type { Metadata } from 'next'
import { MultiDayRouteLanding } from '@/components/sections/MultiDayRouteLanding'
import { multiDayJourneys } from '@/data/multiDayJourneys'

const journey = multiDayJourneys.find((item) => item.slug === 'classic-japan')!

export const metadata: Metadata = {
  title: 'Классическая Япония | JumboInJapan',
  description: 'Токио, Хаконэ, Киото, Нара и Осака в одном маршруте: понятная логика поездки, ночёвки, переезды и ключевые точки по дням.',
  alternates: { canonical: 'https://jumboinjapan.com/multi-day/classic' },
  openGraph: {
    title: 'Классическая Япония | JumboInJapan',
    description: 'Первый большой маршрут по Японии: Токио, Хаконэ, Киото, Нара и Осака.',
    images: [{ url: 'https://jumboinjapan.com/tours/kyoto-1/kyoto-1.jpg' }],
  },
}

export default function MultiDayClassicPage() {
  return (
    <MultiDayRouteLanding
      eyebrow="Готовый маршрут"
      title="Классическая Япония"
      subtitle="Первое большое путешествие по Японии, собранное так, чтобы страна раскрывалась по нарастающей, без хаоса и бессмысленных переездов."
      image="/tours/kyoto-1/kyoto-1.jpg"
      intro="Это маршрут для тех, кто хочет увидеть главные культурные опоры Японии, но не в виде случайного набора городов. Токио даёт вход в страну, Хаконэ меняет ритм, Киото и Нара углубляют исторический слой, а Осака завершает поездку более живым городским акцентом перед вылетом."
      highlights={[
        'Сильный маршрут для первой поездки по Японии',
        'Понятный баланс между городом, природой и историей',
        'Ночёвки стоят так, чтобы не уставать от постоянной смены отелей',
      ]}
      journey={journey}
    />
  )
}
