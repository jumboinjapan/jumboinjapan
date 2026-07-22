export type MultiDayTransportMode = 'train' | 'car' | 'bus' | 'flight'

export interface MultiDayRouteCardSpec {
  title: string
  description: string
  durationLabel: string
  slug: string
  image: string
  /** Фокус-точка кропа (CSS object-position, напр. "50% 18%"); дефолт center. */
  focal?: string
  startCity: string
  regionCountLabel: string
  /** Подпись третьей ячейки параметров; по умолчанию «Охват» (у маршрутов из конструктора — «Маршрут») */
  regionLabelText?: string
  transportModes: MultiDayTransportMode[]
  transportLabel: string
}

export const multiDayRouteCards: MultiDayRouteCardSpec[] = [
  {
    title: 'Классическая Япония',
    description:
      'Маршрут, после которого Япония становится не просто красивой, а понятной: Токио, Хаконе, Киото, Нара и Осака в правильной последовательности.',
    durationLabel: '7–8 дней',
    slug: 'multi-day/classic',
    image: '/tours/kyoto-1/kyoto-1.jpg',
    startCity: 'Токио',
    regionCountLabel: '2 региона',
    transportModes: ['train', 'car'],
    transportLabel: 'ЖД + частный транспорт',
  },
  {
    title: 'Горная Япония',
    description:
      'Маршрут для тех, кому важнее не обязательная классика, а деревни, горные дороги, деревянная архитектура и более редкое ощущение страны.',
    durationLabel: '5–6 дней',
    slug: 'multi-day/mountain',
    image: '/dest-multi-day-journeys-hero-20260421c.jpg',
    startCity: 'Токио',
    regionCountLabel: '3 региона',
    transportModes: ['train', 'bus', 'car'],
    transportLabel: 'ЖД + общественный / частный транспорт',
  },
  {
    title: 'Своим маршрутом',
    description:
      'Если сначала есть вы, ваш ритм, ваши интересы и ваша Япония, тогда маршрут строится вокруг них, а не наоборот.',
    durationLabel: 'От 4 дней',
    slug: 'multi-day/custom',
    image: '/hero-city-tour-rainbow-bridge-tokyo-tower.jpg',
    startCity: 'Токио / Осака',
    regionCountLabel: 'От 1 региона',
    transportModes: ['train', 'car', 'bus', 'flight'],
    transportLabel: 'комбинированная логистика',
  },
]
