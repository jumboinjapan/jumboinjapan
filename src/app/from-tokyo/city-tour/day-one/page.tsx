import Link from "next/link";

const program = {
  title: "Токио. Первый день",
  description: "У меня есть личный рецепт идеального знакомства с Токио. Этот город удивляет своей контрастностью и во многом становится окном в самые разные грани Японии. Именно поэтому Токио — лучшее место для первого глубокого знакомства со страной. Здесь можно увидеть всё сразу: древние храмы и японские сады, самобытные районы, где рождаются новые субкультуры, кварталы, бережно хранящие старые традиции, впечатляющие смотровые площадки и культовые заведения, без которых невозможно почувствовать настоящий ритм города. Такое разнообразие делает знакомство с Токио по-настоящему ярким, цельным и запоминающимся.",
  duration: "6–8 часов",
};

export default function CityTourDayOnePage() {
  return (
    <section className="bg-[var(--bg-warm)] px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-12">
        <div className="aspect-[21/9] w-full bg-stone-200" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">{program.duration}</p>
          <h1 className="font-sans font-bold text-4xl leading-tight tracking-tight md:text-6xl">{program.title}</h1>
          <p className="text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">{program.description}</p>
        </header>

        <section className="space-y-3">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Маршрут</h2>
          <div className="rounded-sm border border-[var(--border)] bg-white p-6 text-[var(--text-muted)] space-y-4">
            <p>Мы начнём знакомство с Токио с квартала <strong className="font-semibold text-[var(--text)]">Гинза</strong> — элегантного района в самом центре города, где за сияющими витринами и современными фасадами скрывается важная история превращения Эдо в крупнейший мегаполис Японии.</p>
            <p>Затем нас ждёт <strong className="font-semibold text-[var(--text)]">сад Хамарикю</strong> — бывшая резиденция могущественного самурайского клана Токугава. Здесь, среди прудов, сосен и чайного павильона, особенно ярко ощущается контраст старого и нового Токио: традиционный японский пейзаж соседствует с небоскрёбами района Сиодомэ.</p>
            <p>К обеду мы дойдём до внешней части <strong className="font-semibold text-[var(--text)]">рынка Цукидзи</strong>, который сегодня стал настоящим местом притяжения для гурманов со всего мира. Здесь можно попробовать японский стритфуд, свежие устрицы, икру морского ежа, премиальный тунец оторо и сезонные японские фрукты.</p>
            <p>После обеда нас ждёт <strong className="font-semibold text-[var(--text)]">святилище Мэйдзи</strong> — один из самых значимых синтоистских храмов Японии, укрытый среди вековых деревьев. Здесь можно не только почувствовать особую атмосферу места, но и поговорить об отношении японцев к религии, синтоизме и истории вестернизации страны.</p>
            <p>Завершим день прогулкой по <strong className="font-semibold text-[var(--text)]">Харадзюку</strong> с его знаменитой улицей Такэсита — пространством молодёжных субкультур и токийской моды. Финальной точкой станет <strong className="font-semibold text-[var(--text)]">Сибуя</strong>: легендарный перекрёсток, памятник Хатико и, при предварительном бронировании, смотровая площадка Shibuya Sky с панорамным видом на вечерний Токио.</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Логистика</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Общественный транспорт</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"В предложенном маршруте, помимо переезда от отеля к месту старта и возвращения в конце дня, предусмотрен всего один переезд на общественном транспорте. Это хорошая возможность заодно познакомиться с тем, как устроено токийское метро."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Такси</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"В Токио хорошо развита служба такси, причём пользоваться ей можно не только через приложение. Это удобное решение для коротких переездов по городу. Если хочется большего комфорта, рекомендую Uber Black Van."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Лимузин сервис</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Для групп, предпочитающих максимальный уровень комфорта, доступна услуга индивидуального транспорта с водителем на целый день. Комфортабельные минивэны с профессиональными водителями заберут и высадят вас в условленных местах, сделают переезды по городу максимально удобными и при необходимости помогут доставить покупки в отель."}</p>
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
  );
}
