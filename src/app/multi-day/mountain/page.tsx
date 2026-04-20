import type { Metadata } from 'next'
import { MultiDayRouteLanding } from '@/components/sections/MultiDayRouteLanding'
import { multiDayJourneys } from '@/data/multiDayJourneys'

const journey = multiDayJourneys.find((item) => item.slug === 'mountain-japan')!

export const metadata: Metadata = {
  title: 'Горная Япония | JumboInJapan',
  description: 'Такаяма, Сиракава-го и Канадзава: многодневный маршрут по японской глубинке с понятной логикой переездов и ночёвок.',
  alternates: { canonical: 'https://jumboinjapan.com/multi-day/mountain' },
  openGraph: {
    title: 'Горная Япония | JumboInJapan',
    description: 'Такаяма, Сиракава-го и Канадзава: деревни, деревянная архитектура и горная Япония без лишней суеты.',
    images: [{ url: 'https://jumboinjapan.com/dest-multi-day-journeys-hero-20260421c.jpg' }],
  },
}

export default function MultiDayMountainPage() {
  return (
    <MultiDayRouteLanding
      eyebrow="Готовый маршрут"
      title="Горная Япония"
      subtitle="Маршрут для тех, кому важнее глубинка, воздух регионов, деревни и более редкое ощущение страны, чем обязательная классика первого визита."
      image="/dest-multi-day-journeys-hero-20260421c.jpg"
      intro="Этот маршрут строится не вокруг самых известных городов, а вокруг другой Японии: деревянной, горной, более тихой и более материальной. Такаяма даёт старый городской слой, Сиракава-го показывает деревенский ландшафт, а Канадзава собирает всё в культурный финал без ощущения, что поездка рассыпается на фрагменты."
      highlights={[
        'Сильный вариант для второй поездки или для тех, кто избегает банального маршрута',
        'Деревни, горная долина, деревянная архитектура и городской финал в Канадзаве',
        'Подходит тем, кому нужен маршрут с более редкой Японией, а не только с главными символами',
      ]}
      journey={journey}
    />
  )
}
