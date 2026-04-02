import Link from "next/link";
import Image from "next/image";
import { PageHero } from "@/components/sections/PageHero";

const program = {
  title: "Скрытые уголки Токио",
  description: "Нетуристический Токио: Сибамата, Янака Гинза, Акихабара, ретро-кварталы Кабуки-тё, парк Уэно и сад Рикугиэн. Индивидуальная экскурсия по скрытым уголкам Токио с русским гидом — маршрут собирается под ваши интересы.",
  duration: "Гибкий формат",
};

const stops = [
  {
    id: "shibamata",
    number: "01 · Утро",
    title: "Сибамата",
    text: "Сибамата — район, практически не пострадавший в войну: памятник Тора-сан, старинная торговая улочка, храм Тайсякутэн с деревянной резьбой невероятной тонкости и последняя в Токио вёсельная переправа через реку Эдо.\n\nЗдесь время замедляется. Бабушки продают рисовые сладости, дети бегают по переулкам, а туристов почти нет. Это Токио, каким он был полвека назад — и каким остался в этом единственном районе.",
    duration: "~60 минут",
    photo: "/tours/city-tour-hidden-spots/neighborhood.jpg",
  },
  {
    id: "yanaka",
    number: "02 · Середина дня",
    title: "Янака Гинза",
    text: "«Кошачья улица» с сувенирами и уличной едой в тихом историческом квартале. Янака — это один из немногих районов старого Токио, где до сих пор сохранилась атмосфера ситамати: низкая застройка, маленькие храмы, кладбище с вишнями и лестница Юуяке Дандан с видом на закат.\n\nЗдесь стоит попробовать мэнти-кацу — мясные котлеты в панировке, которые жарят прямо при вас, и выпить кофе в одной из крошечных кофеен, спрятанных в переулках.",
    duration: "~50 минут",
    photo: "/tours/city-tour-hidden-spots/alley.jpg",
  },
  {
    id: "akihabara",
    number: "03 · День",
    title: "Акихабара",
    text: "Акихабара — это гаджеты, аниме-магазины и мэйдо-кафе. Но за кричащими вывесками скрывается район с интересной историей: когда-то здесь продавали радиодетали, потом — компьютеры, а теперь это столица поп-культуры.\n\nЯ покажу не только мейнстрим, но и скрытые этажи ретро-гейм-шопов, магазины с виниловыми фигурками и тихие переулки, где можно найти настоящие раритеты.",
    duration: "~60 минут",
    photo: "/tours/city-tour-hidden-spots/street.jpg",
  },
  {
    id: "golden-gai",
    number: "04 · Вечер",
    title: "Голден Гай / Омоидэ Йокотё",
    text: "Вечером — Омоидэ Йокотё у станции Синдзюку с крошечными трактирами якитори, где дым смешивается с разговорами, и Голден Гай — две сотни баров в переулках, каждый на пять-шесть человек.\n\nЭто Токио без фильтров. Некоторым барам шестьдесят лет, и они не менялись. Я знаю несколько мест, куда пускают иностранцев без рекомендации — мы зайдём в пару из них.",
    duration: "~90 минут",
    photo: "/tours/city-tour-day-two/tokyo-night.jpg",
  },
];

export default function CityTourHiddenSpotsPage() {
  return (
    <>
      <PageHero
        image="/hero-city-tour-hidden-spots.jpg"
        eyebrow="Гибкий формат"
        title="Скрытые уголки Токио"
        subtitle="Сибамата, Янака Гинза, Акихабара, Голден Гай — нетуристический Токио."
        objectPosition="center"
      />
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">{program.duration}</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">{program.title}</h1>
          <p className="text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">{program.description}</p>
        </header>

        {/* Route Stops */}
        <section>
          <div className="flex items-center gap-5 pb-12">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--text-muted)] whitespace-nowrap">Маршрут дня</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>

          <div className="space-y-0">
            {stops.map((stop, i) => (
              <div
                key={stop.id}
                className={`grid grid-cols-1 md:grid-cols-[62fr_38fr] border-t border-[var(--border)] ${
                  i % 2 === 1 ? "md:grid-cols-[38fr_62fr]" : ""
                }`}
              >
                <div className={`flex flex-col justify-center py-8 md:py-12 ${
                  i % 2 === 1 ? "md:order-2 md:pl-12" : "md:pr-12"
                }`}>
                  <p className="text-[10px] tracking-[0.2em] uppercase text-[var(--text-muted)] mb-3">{stop.number}</p>
                  <h3 className="text-2xl font-medium tracking-[-0.02em] mb-5">{stop.title}</h3>
                  <div className="space-y-3.5">
                    {stop.text.split("\n\n").map((p, j) => (
                      <p key={j} className="text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{p}</p>
                    ))}
                  </div>
                  <span className="mt-6 text-[11px] tracking-[0.1em] uppercase text-[var(--accent)]">{stop.duration}</span>
                </div>
                <div className={`relative overflow-hidden self-stretch min-h-[220px] md:min-h-[300px] ${
                  i % 2 === 1 ? "md:order-1" : ""
                }`}>
                  <Image src={stop.photo} alt={stop.title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 38vw" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Как добраться</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Общественный транспорт</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"До Сибаматы, Янаки или Уэно — метро и электрички. Для скрытых мест это часто единственный способ: на машине туда просто не подъехать."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Такси</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Такси пригодится для перегонов между отдалёнными районами — например, из Сибаматы в Акихабару. Комбинируем с метро по ситуации."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Гид с автомобилем</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Если хочется собрать Сибамату, Янаку и вечерний Синдзюку в один день — машина с водителем экономит время и силы."}</p>
            </article>
          </div>
        </section>

        <Link
          href="/contact"
          className="inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] uppercase transition-colors hover:text-[var(--accent)]"
        >
          Связаться с нами →
        </Link>
      </div>
    </section>
    </>
  );
}
