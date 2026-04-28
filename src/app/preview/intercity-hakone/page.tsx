import type { Metadata } from 'next'
import { ArrowRight, CarFront, TrainFront, UserRound } from 'lucide-react'
import { IntercityRouteTimeline } from '@/components/IntercityRouteTimeline'
import { PageHero } from '@/components/sections/PageHero'
import { PreviewVariantFlag } from '@/components/preview/PreviewVariantFlag'

export const metadata: Metadata = {
  title: 'Preview — intercity Hakone | JumboInJapan',
  robots: { index: false, follow: false },
}

const timelineStops = [
  {
    eyebrow: 'История и вход в маршрут',
    title: 'Застава Хаконэ Сэкисё',
    description:
      'Старт через старую заставу сразу задаёт маршруту историческую глубину: Хаконэ читается не только как природа и панорамы, но и как часть дороги Токайдо и старой географии страны.',
    type: 'landmark' as const,
    arrivalTime: '09:30',
  },
  {
    eyebrow: 'Вода и рельеф',
    title: 'Хаконэ Дзиндзя и озеро Аси',
    description:
      'Озеро и святилище собирают тот мягкий слой Хаконэ, который делает его не просто техническим day trip, а цельным выездом с чувством пространства и паузы.',
    type: 'landmark' as const,
    arrivalTime: '10:20',
  },
  {
    eyebrow: 'Смена темпа',
    title: 'Круиз по озеру Аси',
    description:
      'Переход через озеро нужен не только как фото-точка. Он меняет ритм дня и помогает связать историческую часть с подъёмом в кальдеру.',
    type: 'transport' as const,
    arrivalTime: '11:15',
  },
  {
    eyebrow: 'Подъём',
    title: 'Канатная дорога Хаконэ',
    description:
      'Здесь маршрут начинает работать как последовательная смена высоты, а не как набор разрозненных остановок. Именно это стоит ясно показать в верхней части страницы.',
    type: 'transport' as const,
    arrivalTime: '12:00',
  },
  {
    eyebrow: 'Кульминация',
    title: 'Овакудани',
    description:
      'Вулканическая долина даёт маршруту характер. Сера, пар, чёрные яйца и сама кальдера превращают Хаконэ в день с сильной драматургией, а не просто в красивую поездку.',
    type: 'nature' as const,
    arrivalTime: '12:35',
  },
  {
    eyebrow: 'Финальный слой',
    title: 'Музей под открытым небом Хаконэ',
    description:
      'Финал через искусство под открытым небом делает день более сложным и взрослым по тону: после природы и рельефа появляется культурный слой, который красиво закрывает маршрут.',
    type: 'museum' as const,
    arrivalTime: '14:30',
  },
]

const helperCards = [
  {
    title: 'Для первой сильной поездки из Токио',
    description:
      'Если нужен один собранный загородный день без ощущения хаотичного набора точек, Хаконэ должен читаться вверху страницы как один из самых цельных вариантов.',
  },
  {
    title: 'Для тех, кто думает о ночёвке',
    description:
      'Ночёвка здесь меняет сам характер маршрута: Хаконэ становится не просто выездом, а мягким курортным пространством. Этот helper-слой должен появляться до CTA, а не теряться внизу.',
  },
  {
    title: 'Для сравнения с соседними intercity-маршрутами',
    description:
      'Камакура, Никко и Фудзи нужны не как шумный блок наверху, а как следующий шаг после понимания, чем сам Хаконэ отличается по ритму, рельефу и ощущению дня.',
  },
]

const transportOptions = [
  {
    title: 'Общественный транспорт',
    Icon: TrainFront,
    summary:
      'Рабочий вариант, но со стыковками и более жёстким ритмом. На странице это важно проговаривать честно, уже после того как пользователь захотел сам маршрут.',
  },
  {
    title: 'Гид-водитель',
    Icon: UserRound,
    summary:
      'Главный формат для Хаконэ, если хочется сохранить мягкость дня, не терять время на пересадки и не ломать драматургию маршрута логистикой.',
  },
  {
    title: 'Частная машина',
    Icon: CarFront,
    summary:
      'Уместна там, где важны семья, возраст группы, паузы или желание добавить ночёвку и онсэн без ощущения перегруженного тайминга.',
  },
]

const related = [
  { title: 'Камакура', href: '/intercity/kamakura' },
  { title: 'Никко', href: '/intercity/nikko' },
  { title: 'Гора Фудзи', href: '/intercity/fuji' },
  { title: 'Все загородные туры', href: '/intercity' },
]

export default function PreviewIntercityHakonePage() {
  return (
    <>
      <PreviewVariantFlag />
      <PageHero
        image="/tours/hakone/hakone-hero.jpg"
        alt="Хаконэ, озеро Аси и горы"
        eyebrow="Загородный тур · День и более · preview"
        title="Хаконэ из Токио"
        subtitle="Тот же реальный маршрут, но со структурой, где семейная ориентация, сводка и suitability стоят на своих местах до логистики и CTA."
        objectPosition="center 30%"
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20 lg:space-y-24">
          <section className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:items-start">
            <div className="space-y-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Почему ехать именно сюда</p>
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">
                Хаконэ — не просто day trip, а редкий цельный день: вода, высота, вулканический рельеф и возможность превратить выезд в мягкую поездку с ночёвкой.
              </h2>
              <p className="max-w-3xl text-[15px] font-light leading-[1.9] text-[var(--text-muted)] md:text-[16px]">
                Здесь сохраняется текущая логика страницы Hakone, но верх становится конкретнее: кому маршрут особенно подходит, почему он сильнее читается как один собранный день, чем отличается от других загородных выездов и зачем логистику опускать ниже самой драматургии маршрута.
              </p>
            </div>
            <aside className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Краткая сводка</p>
              <ul className="mt-4 space-y-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                <li>Первый сильный выезд из Токио, если нужен цельный маршрут, а не хаотичный набор точек</li>
                <li>Подходит и для насыщенного дня, и для более мягкого сценария с ночёвкой и онсэном</li>
                <li>Лучше всего читается через смену рельефа, темпа и ощущение собранного дня</li>
              </ul>
            </aside>
          </section>

          <section className="space-y-6 md:space-y-8">
            <div className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
              {[
                'Хаконэ нужен тем, кто хочет не просто выехать из Токио, а прожить один собранный день с ясной драматургией.',
                'Главная сила маршрута — не список точек, а естественная смена воды, высоты, вулканического слоя и культурного финала.',
                'Если хочется большего, ночёвка и онсэн не ломают маршрут, а мягко переводят его в другую категорию опыта.',
              ].map((item) => (
                <p key={item} className="bg-[var(--bg)] px-5 py-4 text-[14px] font-light leading-[1.8] text-[var(--text-muted)] md:px-6">
                  {item}
                </p>
              ))}
            </div>

            <div className="space-y-3 md:space-y-4">
              <div className="flex items-center gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Маршрут дня</p>
                <span aria-hidden="true" className="h-px w-14 bg-[var(--border)]" />
              </div>
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Как развивается маршрут по Хаконэ</h2>
              <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[16px]">
                Таймлайн остаётся центром страницы, но приходит уже после краткой ориентации, когда пользователь понял, почему именно этот маршрут стоит смотреть первым внутри intercity family.
              </p>
            </div>
            <IntercityRouteTimeline stops={timelineStops} />
          </section>

          <section className="space-y-6 md:space-y-8">
            <div className="space-y-2">
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Кому подходит такой формат</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {helperCards.map((item) => (
                <article key={item.title} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                  <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.title}</h3>
                  <p className="mt-3 font-sans text-[14px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[15px]">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-6 md:space-y-8">
            <div className="space-y-3 md:space-y-4">
              <div className="flex items-center gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Логистика</p>
                <span aria-hidden="true" className="h-px w-14 bg-[var(--border)]" />
              </div>
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Как ехать, чтобы не сломать ритм дня</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {transportOptions.map(({ title, Icon, summary }) => (
                <article key={title} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <h3 className="font-sans text-[16px] font-medium leading-[1.3] tracking-[-0.01em]">{title}</h3>
                  </div>
                  <p className="font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{summary}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-6 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:px-8 md:py-8">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Следующий шаг</p>
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Открыть текущий маршрут Хаконэ</h2>
              <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                В этой версии меняется только структура подачи: семейная ориентация, порядок блоков и связи с соседними intercity-маршрутами. Сам маршрут остаётся тем же.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <a
                href="/intercity/hakone"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
              >
                Перейти к текущей странице
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Куда смотреть дальше</p>
              <p className="text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                Когда логика Хаконэ уже понятна, тогда имеет смысл сравнивать его с другими загородными направлениями — по истории, морю, горам или общей интенсивности дня.
              </p>
            </div>
            <nav className="flex flex-wrap gap-3" aria-label="Связанные загородные туры">
              {related.map((link) => (
                <a key={link.href} href={link.href} className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
                  {link.title}
                </a>
              ))}
            </nav>
          </section>
        </div>
      </section>
    </>
  )
}
