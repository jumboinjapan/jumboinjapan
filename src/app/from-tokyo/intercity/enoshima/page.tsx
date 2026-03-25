import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";

export default function EnoshimaPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel images={["/tours/enoshima/enoshima-1.jpg","/tours/enoshima/enoshima-2.jpg","/tours/enoshima/enoshima-3.jpg"]} alt="Эносима" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Эносима</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Остров Эносима расположен в нескольких минутах езды к западу от Камакуры и соединён с материком пешеходным мостом. Это популярное направление для однодневных путешествий, сочетающее природную красоту, традиционную культуру и морскую гастрономию. Тур прекрасно подойдёт путешественникам, которые ценят мифы, историю и дух жизни на берегу океана.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Святилище Эносима</h3>
              <p>Главная святыня острова — синтоистский комплекс из трёх павильонов. Здесь поклоняются богине Бэнтэн — покровительнице искусства, музыки и богатства. Статуя Бэнтэн в главном павильоне входит в число трёх самых уважаемых образов этой богини в стране.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Сад Самуэля Кокинга</h3>
              <p>В конце XIX века британский торговец Самуэль Кокинг построил на Эносиме виллу и основал при ней ботанический сад. Сегодня здесь растут экзотические растения, в том числе редкие тропические виды. Сад открыт круглый год.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Смотровая башня «Морская свеча»</h3>
              <p>Современная смотровая башня — символ Эносимы. Предлагает панорамный обзор на залив Сагами, Фудзисаву и Камакуру. На высоте 60 метров — открытая и закрытая площадки, особенно популярные на закате.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Пещеры Ивая</h3>
              <p>На южной стороне острова — природные пещеры, легко доступные для посетителей. Первая украшена буддийскими статуями, вторая посвящена легенде о драконе. Атмосферная подсветка усиливает ощущение мифа. Требуется физическая подготовка для подъёма обратно.</p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Опции</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Океанариум Эносима</h3>
              <p>Современный аквариум у побережья залива Сагами с медузами, скатами, акулами и дельфинами. Подходит для посещения в любую погоду, особенно с детьми.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">EnoSPA</h3>
              <p>Термальные ванны с видом на океан прямо у побережья Эносимы. Несколько видов купален — под открытым небом и в помещениях. При ясной погоде — виды на залив Сагами и гору Фудзи.</p>
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
