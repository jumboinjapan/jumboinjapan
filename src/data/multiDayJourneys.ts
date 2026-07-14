export interface JourneyPoi {
  name: string
  note?: string
}

export interface JourneyCity {
  name: string
  note?: string
  pois: JourneyPoi[]
}

export interface JourneyRegion {
  name: string
  note?: string
  cities: JourneyCity[]
}

export interface JourneyTransfer {
  from: string
  to: string
  mode: string
  note?: string
}

export interface JourneyDay {
  day: number
  title: string
  summary: string
  transfers?: JourneyTransfer[]
  regions: JourneyRegion[]
  overnightCity: string
}

export interface MultiDayJourney {
  slug: string
  title: string
  duration: string
  rhythm: string
  bestFor: string
  geography: string
  arrival: string
  departure: string
  days: JourneyDay[]
}

export const multiDayJourneys: MultiDayJourney[] = [
  {
    slug: 'classic-japan',
    title: 'Классическая Япония',
    duration: '7–8 дней',
    rhythm: 'Для первого большого знакомства со страной без хаотичных переездов.',
    bestFor: 'Первая поездка, пары, семьи, гости, которым важен баланс города, природы и старой Японии.',
    geography: 'Токио → Хаконе → Киото → Нара → Осака',
    arrival: 'Токио',
    departure: 'Осака',
    days: [
      {
        day: 1,
        title: 'Прилёт в Токио',
        summary: 'Прилёт, заселение в отель и спокойный вечер рядом с гостиницей — в первый день без насыщенной программы.',
        regions: [
          {
            name: 'Канто',
            cities: [
              {
                name: 'Токио',
                pois: [
                  { name: 'Прилёт и встреча' },
                  { name: 'Заселение в отель' },
                  { name: 'Вечерняя прогулка рядом с районом проживания' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Токио',
      },
      {
        day: 2,
        title: 'Знакомство с городом',
        summary: 'Смотрим главные районы Токио так, чтобы за один день сложилась цельная картина города.',
        regions: [
          {
            name: 'Канто',
            cities: [
              {
                name: 'Токио',
                pois: [
                  { name: 'Исторический район или храмовый блок' },
                  { name: 'Современный район с архитектурой и городским ритмом' },
                  { name: 'Смотровая точка или вечерний район по интересам группы' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Токио',
      },
      {
        day: 3,
        title: 'Выезд в Хаконе',
        summary: 'Едем в Хаконе: горы, озеро Аси и онсэн после двух дней в городе.',
        transfers: [
          { from: 'Токио', to: 'Хаконе', mode: 'поезд или машина', note: 'Утренний переезд с багажом' },
        ],
        regions: [
          {
            name: 'Канто',
            cities: [
              {
                name: 'Хаконе',
                pois: [
                  { name: 'Озеро Аси' },
                  { name: 'Овакудани' },
                  { name: 'Онсэн или вечер в рёкане' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Хаконе',
      },
      {
        day: 4,
        title: 'Переезд в Киото',
        summary: 'Переезд на синкансэне и первый вечер в старой столице.',
        transfers: [
          { from: 'Хаконе', to: 'Киото', mode: 'синкансэн', note: 'Через Одавару' },
        ],
        regions: [
          {
            name: 'Кансай',
            cities: [
              {
                name: 'Киото',
                pois: [
                  { name: 'Заселение в отель' },
                  { name: 'Вечерняя прогулка по историческому району' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Киото',
      },
      {
        day: 5,
        title: 'Храмы и сады Киото',
        summary: 'Самый насыщенный по истории день маршрута: храмы, сады, старые кварталы.',
        regions: [
          {
            name: 'Кансай',
            cities: [
              {
                name: 'Киото',
                pois: [
                  { name: 'Северный или восточный храмовый маршрут' },
                  { name: 'Сад или дзен-блок' },
                  { name: 'Вечерний исторический квартал' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Киото',
      },
      {
        day: 6,
        title: 'Поездка в Нару',
        summary: 'Однодневный выезд из Киото: парк с оленями, храм Тодайдзи и более свободный темп дня.',
        transfers: [
          { from: 'Киото', to: 'Нара', mode: 'поезд', note: 'Туда и обратно в течение дня' },
        ],
        regions: [
          {
            name: 'Кансай',
            cities: [
              {
                name: 'Нара',
                pois: [
                  { name: 'Парк Нара' },
                  { name: 'Тодайдзи' },
                  { name: 'Старые кварталы или чайная пауза' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Киото',
      },
      {
        day: 7,
        title: 'Переезд в Осаку',
        summary: 'Осака более живая и шумная, чем Киото — хорошая точка, чтобы завершить поездку перед вылетом.',
        transfers: [
          { from: 'Киото', to: 'Осака', mode: 'поезд', note: 'Короткий утренний переезд' },
        ],
        regions: [
          {
            name: 'Кансай',
            cities: [
              {
                name: 'Осака',
                pois: [
                  { name: 'Центральный городской маршрут' },
                  { name: 'Гастрономический район' },
                  { name: 'Вечер перед вылетом' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Осака',
      },
      {
        day: 8,
        title: 'День отъезда',
        summary: 'Завтрак, сборы и спокойный выезд в аэропорт.',
        transfers: [
          { from: 'Осака', to: 'Аэропорт Кансай', mode: 'поезд или трансфер' },
        ],
        regions: [
          {
            name: 'Кансай',
            cities: [
              {
                name: 'Осака',
                pois: [
                  { name: 'Завтрак, сборы и выезд' },
                ],
              },
            ],
          },
        ],
        overnightCity: '—',
      },
    ],
  },
  {
    slug: 'mountain-japan',
    title: 'Горная Япония',
    duration: '5–6 дней',
    rhythm: 'Для тех, кому важнее глубинка, деревни, региональный воздух и меньше очевидных точек.',
    bestFor: 'Повторная поездка, любители природы, деревянной архитектуры, онсэнов и менее туристической Японии.',
    geography: 'Токио → Такаяма → Сиракава-го → Канадзава',
    arrival: 'Токио',
    departure: 'Канадзава или Токио',
    days: [
      {
        day: 1,
        title: 'Прилёт и ночь в Токио',
        summary: 'Короткий вход в поездку без попытки сразу ехать далеко.',
        regions: [
          {
            name: 'Канто',
            cities: [
              {
                name: 'Токио',
                pois: [
                  { name: 'Прилёт и встреча' },
                  { name: 'Заселение' },
                  { name: 'Спокойный вечер рядом с отелем' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Токио',
      },
      {
        day: 2,
        title: 'Переезд в Такаяму',
        summary: 'Выход из большой городской оси в сторону горной Японии.',
        transfers: [
          { from: 'Токио', to: 'Такаяма', mode: 'поезд', note: 'Длинный переезд через Нагою' },
        ],
        regions: [
          {
            name: 'Тюбу',
            cities: [
              {
                name: 'Такаяма',
                pois: [
                  { name: 'Старый город' },
                  { name: 'Вечерняя прогулка по деревянным улицам' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Такаяма',
      },
      {
        day: 3,
        title: 'День деревень и горной долины',
        summary: 'Самый атмосферный день маршрута с деревенской Японией.',
        transfers: [
          { from: 'Такаяма', to: 'Сиракава-го', mode: 'машина или автобус', note: 'Переезд по долине' },
          { from: 'Сиракава-го', to: 'Такаяма', mode: 'машина или автобус', note: 'Возвращение вечером' },
        ],
        regions: [
          {
            name: 'Тюбу',
            cities: [
              {
                name: 'Сиракава-го',
                pois: [
                  { name: 'Деревня гассё-дзукури' },
                  { name: 'Смотровая точка' },
                  { name: 'Старые дома и деревенский ритм' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Такаяма',
      },
      {
        day: 4,
        title: 'Через деревни в Канадзаву',
        summary: 'Переезд, в котором сама дорога становится частью путешествия.',
        transfers: [
          { from: 'Такаяма', to: 'Канадзава', mode: 'машина', note: 'Через Сиракава-го или долину' },
        ],
        regions: [
          {
            name: 'Хокурику',
            cities: [
              {
                name: 'Канадзава',
                pois: [
                  { name: 'Заселение' },
                  { name: 'Вечер в историческом квартале' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Канадзава',
      },
      {
        day: 5,
        title: 'Основной день в Канадзаве',
        summary: 'Сад, городской ритм и культурный финал после горного блока.',
        regions: [
          {
            name: 'Хокурику',
            cities: [
              {
                name: 'Канадзава',
                pois: [
                  { name: 'Кэнрокуэн' },
                  { name: 'Чайный квартал' },
                  { name: 'Рынок или ремесленный блок' },
                ],
              },
            ],
          },
        ],
        overnightCity: 'Канадзава',
      },
      {
        day: 6,
        title: 'День отъезда',
        summary: 'Возвращение в Токио или выезд в следующий регион.',
        transfers: [
          { from: 'Канадзава', to: 'Токио или следующий регион', mode: 'синкансэн' },
        ],
        regions: [
          {
            name: 'Хокурику',
            cities: [
              {
                name: 'Канадзава',
                pois: [
                  { name: 'Утро без перегруза и выезд' },
                ],
              },
            ],
          },
        ],
        overnightCity: '—',
      },
    ],
  },
]
