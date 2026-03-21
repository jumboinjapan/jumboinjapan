import Link from "next/link";

export default function FujiPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="aspect-[21/9] w-full bg-stone-200" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Гора Фудзи</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Фудзи — самая высокая точка Японии высотой 3776 метров. Её почти идеальная коническая форма веками вдохновляла художников, паломников и поэтов. Сегодня регион Фудзи — это не только символ страны, но и популярное направление для активного отдыха и культурного туризма.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Пятая станция горы Фудзи</h3>
              <p>Последняя точка на склоне горы, до которой можно добраться на автомобиле. Здесь начинается пеший подъём на вершину, если позволяют погодные условия. Можно отправить открытку с одной из самых высокорасположенных почтовых станций в мире, прокатиться на лошади и посетить синтоистское святилище. На высоте значительно холоднее — тёплая одежда обязательна.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Обсерватория на горе Тэндзё (Кати-кати яма)</h3>
              <p>С берега озера Кавагутико мы поднимемся на канатной дороге к обзорной площадке выше 1000 метров над уровнем моря. Отсюда один из лучших видов на гору Фудзи и озеро у её подножия. Это место также связано с японской народной сказкой о Зайце и Тануки. При возможных очередях можно полюбоваться горой с озера — индивидуальный фрахт моторной лодки или круиз по озеру Кавагути.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Парк Ияси-но Сато</h3>
              <p>На западном берегу озера Сайко расположилась восстановленная деревня Ияси-но Сато — музей под открытым небом. Изначально это было фермерское поселение, разрушенное оползнем в 1966 году. Здесь можно посетить традиционные японские избы с соломенными крышами, поучаствовать в ремесленных мастер-классах и приобрести уникальные сувениры.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Музей кимоно Итику Кубота</h3>
              <p>Художник Кубота Итику посвятил жизнь возрождению утраченного искусства окрашивания шёлка в технике цудзигахана. На северном берегу озера Кавагутико расположен музей с кимоно, изображающими природу, времена года и вселенную — включая части монументального проекта «Симфония света», серии из 80 кимоно о горе Фудзи.</p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Опции</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Пагода Тюрейто</h3>
              <p>Пятиэтажная пагода на склоне горы в парке Аракурияма — одна из самых популярных панорамных точек Японии с видом на Фудзи и цветущую сакуру весной. Построена в 1963 году как мемориал павшим воинам. Подъём — около 400 ступеней.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Лес Аокигахара</h3>
              <p>Густой лес у северо-западного подножия горы Фудзи, выросший на древнем лавовом потоке. Японцы называют его дзюкай — «море деревьев». Здесь можно увидеть застывшие лавовые пещеры, редкие виды мха и деревьев, насладиться особой тишиной. Магнетические аномалии вызывают сбои в компасах.</p>
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
