import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";

export default function NaraPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Нара</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">История Нары ещё более древняя и драматичная, чем история Киото. Всё то, за что мы любим Киото — утончённость храмов, элегантность городской планировки — зародилось именно в Нара. Нара была первой по-настоящему крупной столицей объединённой Японии — в эпоху, когда буддизм начинал завоёвывать умы аристократии.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Парк Нара. Кормление оленей</h3>
              <p>Наша прогулка приведёт нас к главной святыне Нары — храму Тодай-дзи, поистине грандиозному сооружению мирового масштаба. Главный павильон Дайбуцудэн на протяжении столетий оставался крупнейшим деревянным зданием на планете. Внутри — бронзовая статуя Великого Будды, одно из самых масштабных культовых изображений в азиатском буддизме. По дороге к храму — олени, которые совершенно свободно гуляют по парку и подходят к людям.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Касуга Тайся — святилище тысячи фонарей</h3>
              <p>Одно из самых почитаемых синтоистских храмов Японии, основан в 768 году как родовое святилище клана Фудзивара. Знаменито аллеей каменных и бронзовых фонарей — их здесь более трёх тысяч. Во время специальных фестивалей, дважды в год, все фонари зажигаются. Прогулка вдоль покрытых мхом древних фонарей создаёт ощущение прикосновения к чему-то нетленному.</p>
            </div>
          </div>
        </section>

        <Link
          href="/contact"
          className="inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
        >
          Связаться →
        </Link>
      </div>
    </section>
  );
}
