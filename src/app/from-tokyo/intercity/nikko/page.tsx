import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";

export default function NikkoPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Никко</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Для тех, кто ценит природу и историческую глубину Японии, Никко — одно из наиболее насыщенных направлений. Этот регион, духовный центр страны и родина японского горного буддизма, сохранил подлинную атмосферу уединения и традиций. Здесь покоится основатель сёгуната Токугава — великий государственный деятель Токугава Иэясу. Курорт также известен термальными источниками и кулинарными изысками, включая знаменитые соевые сливки юба и озёрную форель.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Священный мост Синкё</h3>
              <p>Один из трёх самых живописных мостов Японии — архитектурная визитная карточка Никко. По легенде, именно здесь монах Сёдо, перебравшись через реку с помощью божественного змея, впервые ступил на землю Никко и положил начало буддийской традиции в этих горах.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Святилище Тосёгу</h3>
              <p>В отличие от большинства синтоистских храмов с архитектурной скромностью, Тосёгу поражает богатством оформления. Возведённый в XVII веке, он стал воплощением художественного мастерства эпохи. Роскошные ворота, обилие золота, замысловатая резьба и красочная роспись делают его уникальным для японской религиозной архитектуры. Здесь находится мавзолей Токугавы Иэясу, объединившего Японию.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Аллея исчезающих Будд «Канмангафути»</h3>
              <p>Тихий лесной уголок на берегу горной реки. Здесь находится таинственная Аллея Бездны со статуями Дзидзо — покровителей душ умерших детей и путников. Феномен этого места: каждый раз количество фигур кажется разным, пересчитать их невозможно.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Горное озеро Тюдзэндзи</h3>
              <p>Природная жемчужина Никко у подножия священной горы Нантайсан. Вдоль береговой линии проложены прогулочные тропы. Под вечер здесь нередко появляются японские макаки, олени и кабаны.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Водопад Кэгон</h3>
              <p>Природный символ Никко, один из трёх величайших водопадов Японии. Его мощный поток обрушивается с высоты более 100 метров, питаясь из горного озера Тюдзэндзи. Особенно впечатляет осенью, когда склоны окрашиваются в багряные оттенки.</p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Опции</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Императорская вилла Тамадзава</h3>
              <p>Одна из крупнейших сохранившихся деревянных резиденций Японии. Построена в 1899 году как летняя резиденция императора, соединяет традиционное японское зодчество с западной архитектурой эпохи Мэйдзи. Более 100 комнат, великолепный ландшафтный сад. Открыта для свободного посещения как историко-культурный парк.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Водопад Рюдзунотаки</h3>
              <p>«Голова дракона» — верхняя часть водопада напоминает форму головы мифического существа в месте, где поток делится на два рукава. Особенно красив осенью и зимой.</p>
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
