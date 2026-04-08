import Link from "next/link";
import type { Metadata } from "next";

const sections = [
  {
    href: '/resources/hotels',
    title: 'Отели',
    description:
      'Подборка по регионам и уровню — чтобы быстрее понять, где имеет смысл жить, а не просто открыть длинный список.',
  },
  {
    href: '/resources/restaurants',
    title: 'Рестораны',
    description:
      'Собранные варианты для тех дней, когда хочется заранее выбрать хороший ужин или понимать, в каком районе бронировать стол.',
  },
  {
    href: '/resources/services',
    title: 'Услуги',
    description:
      'Практичные сервисы и занятия, которые полезно добавить в поездку только там, где они действительно усиливают маршрут.',
  },
  {
    href: '/events',
    title: 'События и выставки',
    description:
      'Временные записи теперь живут на том же Resources backbone: выставки, концерты и события со своими датами и lifecycle.',
  },
] as const;

export const metadata: Metadata = {
  title: "Ресурсы для поездки по Японии",
  description:
    "Подборки отелей, ресторанов и сервисов по Японии с коротким редакторским ориентиром: с чего начать и как использовать списки при планировании.",
};

export default function ResourcesPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-12 md:px-6 md:py-16">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <header className="max-w-4xl space-y-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Ресурсы</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Не каталог ради каталога, а спокойная точка опоры для маршрута</h1>
          <p className="text-[15px] leading-[1.85] text-[var(--text-muted)]">
            Здесь собраны отели, рестораны и полезные сервисы, которые помогают не начинать планирование с пустого места.
            Это не попытка покрыть всё подряд. Скорее — curated база, от которой удобно оттолкнуться, а дальше уже уточнить
            район, темп поездки и общий стиль маршрута.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <article className="border border-[var(--border)] bg-[var(--bg)] p-5">
            <h2 className="font-sans text-lg font-medium tracking-[-0.01em]">С чего начать</h2>
            <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
              Сначала определите города и ритм поездки. Только после этого имеет смысл выбирать конкретный отель или ресторан.
            </p>
          </article>
          <article className="border border-[var(--border)] bg-[var(--bg)] p-5">
            <h2 className="font-sans text-lg font-medium tracking-[-0.01em]">Как использовать списки</h2>
            <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
              Лучше воспринимать их как короткий шорт-лист. Выберите несколько сильных вариантов, а не пытайтесь просмотреть всё.
            </p>
          </article>
          <article className="border border-[var(--border)] bg-[var(--bg)] p-5">
            <h2 className="font-sans text-lg font-medium tracking-[-0.01em]">Когда писать мне</h2>
            <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
              Когда уже есть даты, состав группы и базовый маршрут. Тогда я смогу подсказать, что действительно подойдёт именно вам.
            </p>
          </article>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="group flex h-full flex-col border border-[var(--border)] bg-[var(--bg)] p-6 transition-colors hover:border-[var(--text)]"
            >
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">{section.title}</h2>
              <p className="mt-3 flex-1 text-[14px] font-light leading-[1.85] text-[var(--text-muted)]">{section.description}</p>
              <span className="mt-5 inline-flex min-h-11 items-center text-sm font-medium uppercase tracking-wide text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
                Открыть раздел →
              </span>
            </Link>
          ))}
        </div>

        <div className="max-w-4xl border border-[var(--border)] bg-[var(--bg)] px-5 py-4 text-[14px] font-light leading-[1.85] text-[var(--text-muted)] md:px-6">
          Если вы уже понимаете, что хотите связать ресурсы с конкретными экскурсиями, удобнее всего начать с <Link href="/intercity" className="text-[var(--accent)] underline underline-offset-4">загородных маршрутов</Link> или <Link href="/city-tour" className="text-[var(--accent)] underline underline-offset-4">туров по Токио</Link>, а потом вернуться сюда за деталями.
        </div>
      </div>
    </section>
  );
}
