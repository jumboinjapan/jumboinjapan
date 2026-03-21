import Link from "next/link";

export default function KanazawaPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="aspect-[21/9] w-full bg-stone-200" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">2 дня</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Канадзава</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Это город-шедевр на побережье Японского моря, с богатейшей традицией художественных ремёсел и одним из самых прекрасных садов Японии. Канадзава — Япония без суеты мегаполисов, но с роскошью, которая ощущается в деталях: в изящных мостиках, в шуме воды в саду, в отблеске сусального золота в витринах.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Сад Кэнрокуэн</h3>
              <p>Один из трёх великих садов Японии, признанный образцом ландшафтного совершенства. Здесь сочетаются шесть идеальных качеств: простор, уединение, искусственность, древность, водные элементы и панорама. Весной — сакура, летом — туман над прудом, осенью — клёны, зимой — легендарные верёвочные подвязки юкитсуру, защищающие деревья от снега.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Замок Канадзава</h3>
              <p>Некогда мощная феодальная крепость с белоснежными стенами, деревянными воротами и обзорной башней. Замок и сад Кэнрокуэн соединены пешеходным мостом — отсюда лучшие виды на историческую часть города.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Рыбный рынок Омитё</h3>
              <p>«Кухня Канадзавы», действующая с эпохи Эдо. Свежайшие крабы, морские ежи, сушёные кальмары и знаменитые сладости из фасоли и золота. Можно остановиться на дегустацию стрит-фуда или быструю обеденную паузу.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Район Хигаси Тяя-гай</h3>
              <p>Атмосфера старой Японии в районе чайных домов — узкие улочки, решётчатые фасады, антикварные магазины и действующие чайные дома, где до сих пор проходят выступления гейш. Один из лучших районов страны для прогулок в кимоно.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Музей современного искусства 21 века</h3>
              <p>Неожиданно контрастное место, прекрасно вписывающееся в художественное ДНК города. Здесь можно посетить «The Swimming Pool» Леандро Эрлиха, увидеть актуальные выставки на пересечении традиций и технологий.</p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Опции</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Храм Ниндзядэра («Храм ниндзя»)</h3>
              <p>Известен не столько религией, сколько системой потайных лестниц, скрытых дверей и ловушек. Построен как часть оборонительной стратегии. Требует предварительного бронирования. Отличный выбор для путешественников с детьми.</p>
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
