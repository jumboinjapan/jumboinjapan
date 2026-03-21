import Link from "next/link";

export default function OsakaPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="aspect-[21/9] w-full bg-stone-200" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День и больше</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Осака</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Осака — город с древней историей, в первую очередь известный как торговая столица Японии. Здесь всё устроено немного иначе: даже на эскалаторах люди стоят с другой стороны, чем в Токио. Осакцы славятся открытым характером, юмором и готовностью к живому общению.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Океанариум Каиюкан</h3>
              <p>Один из крупнейших океанариумов мира. Экспозиции организованы по географическому принципу — путешествие вдоль Тихоокеанского огненного кольца. Главный аквариум — гигантский резервуар с китовой акулой, тунцами, скатами и другими обитателями открытого океана. При желании — круиз вдоль залива и колесо обозрения.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Осакский замок</h3>
              <p>Не просто красивая крепость, а важнейший исторический символ эпохи объединения Японии. Построен в конце XVI века полководцем Тоётоми Хидэёси. В своё время — самая масштабная и укреплённая крепость в стране. Смотровая площадка с панорамными видами на город, экспозиция о войнах за объединение страны.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Квартал Дотонбори</h3>
              <p>Сердце вечерней Осаки, шумный и яркий район вдоль канала. Здесь родились окономияки и такояки, которые подают на каждом углу. Витрины с гигантскими объёмными осьминогами, крабами и коровами. Главный ориентир — светящаяся фигура бегуна Glico, символ города.</p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Опции</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Universal Studios Japan</h3>
              <p>Один из крупнейших развлекательных парков в Азии для путешественников с детьми. Тематические зоны: Гарри Поттер, Мир Марио, Парк юрского периода и другие. Рекомендуется заранее приобрести билеты и fast track для избежания очередей.</p>
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
