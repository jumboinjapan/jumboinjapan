import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";

export default function KamakuraPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Камакура</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Камакура — первая военная столица Японии, основанная в XI веке сёгуном из рода Минамото. Именно здесь начал формироваться самурайский класс, ставший доминирующей политической и военной силой Японии. Сегодня Камакура — популярный прибрежный курорт, где можно прикоснуться к наследию японского средневековья и отдохнуть у побережья Тихого океана.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Святилище Цуругаока Хатимангу</h3>
              <p>Основан в 1063 году как храм покровителя воинов Хатимана. Здесь начиналась история первого сёгуната Камакура. Во время прогулки мы пройдём по аллее Дандзакура, увидим пруды Генпей, барабанный мост и храм в честь богини богатства Бэндзайтен.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Большой Будда — Дайбуцу</h3>
              <p>Одна из крупнейших статуй Будды в Японии, возведение завершилось в 1252 году. Это одна из немногих монументальных буддийских скульптур, дошедших до наших дней в оригинальном виде. Храм Котоку-ин, на территории которого расположен Дайбуцу, неоднократно разрушался тайфунами и цунами.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Буддийский храм Хасэ-дэра</h3>
              <p>Около 1300 лет назад мастер вырезал из священного дерева две статуи богини Каннон. Одну отпустили в море — через 15 лет волны вынесли её на берег залива Сагами. Сегодня здесь можно увидеть одиннадцатиголовое изображение Каннон, посетить павильон Дайкокутэн и пещеру Бодхисаттв.</p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Опции</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Кэнтё-дзи</h3>
              <p>Старейший дзэн-буддийский храм Камакуры, первый в ряду пяти великих дзэнских храмов города. Основан в 1253 году. Стал важнейшим духовным и образовательным центром, сыгравшим ключевую роль в распространении дзэн-буддизма в Японии.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Святилище Дзэниараи Бэнтэн</h3>
              <p>Одно из самых посещаемых мест западной части Камакуры — сюда приходят «омыть деньги» в священном источнике. Согласно поверьям, очищенные средства обязательно приумножатся. Святилище вырублено прямо в скале — редкий пример синкретизма синто и буддизма.</p>
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
