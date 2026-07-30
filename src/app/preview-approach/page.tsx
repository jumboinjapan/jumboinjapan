import Link from "next/link";

import { typo } from "@/lib/typography";

/**
 * ВРЕМЕННАЯ страница для выбора варианта блока «Подход» на главной.
 * Удалить после решения владельца.
 */

const PROSE = {
  p1: "Япония часто остаётся понятой лишь наполовину. Даже насыщенное путешествие может превратиться в набор красивых кадров, если в нём не хватает контекста, ритма и правильной оптики.",
  p2: "Человек приезжает со своими ожиданиями, клише и представлениями о Японии, и от этого зависит, с чего начать, где сделать паузу, а где устроить кульминацию. Кому-то нужна точка входа через тихий храмовый район, другому через арт-пространство, а третьему по душе сразу оказаться в гуще молодёжного района.",
  p3: "Моя задача — сделать так, чтобы маршрут имел форму и был чуть больше, чем просто список мест для посещения.",
};

function Marker({ children, note }: { children: string; note: string }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-16 pb-4 md:px-6">
      <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--accent)]">{children}</p>
      <p className="mt-1 text-meta font-light text-[var(--text-muted)]">{note}</p>
    </div>
  );
}

export default function PreviewApproachPage() {
  return (
    <div className="bg-[var(--bg)]">
      {/* ─────────── СЕЙЧАС ─────────── */}
      <Marker note="Заголовок 75 знаков (предел 66) в четыре строки, справа абзац на 482 знака, колонки 4 строки против 11, связи между ними нет.">
        Сейчас
      </Marker>
      <section className="border-y border-[var(--border)] bg-[var(--surface)] px-4 py-16 md:px-6 md:py-24 section-tint">
        <div className="mx-auto grid w-full max-w-6xl gap-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(320px,0.98fr)] lg:gap-20">
          <div className="space-y-5">
            <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">Подход</p>
            <h2 className="text-section leading-[1.1] text-[var(--text)] md:leading-[1.06]">
              {typo("Как и в театре, в путешествии каждый выбирает свой жанр и свою драматургию.")}
            </h2>
          </div>
          <div className="max-w-[38rem] space-y-6 text-body font-light leading-[1.92] text-[var(--text-muted)] lg:pt-1">
            <p>{typo(`${PROSE.p1} ${PROSE.p2}`)}</p>
            <p>{typo(PROSE.p3)}</p>
          </div>
        </div>
      </section>

      {/* ─────────── ВАРИАНТ A ─────────── */}
      <Marker note="Одна колонка: метка → короткий тезис → метафора лидом → проза узкой мерой. Иерархия читается сверху вниз.">
        Вариант A — вертикальный каскад
      </Marker>
      <section className="border-y border-[var(--border)] bg-[var(--surface)] px-4 py-16 md:px-6 md:py-24 section-tint">
        <div className="mx-auto w-full max-w-[40rem] space-y-6">
          <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">Подход</p>
          <h2 className="text-section leading-[1.08] text-[var(--text)]">
            {typo("У каждого путешествия свой жанр")}
          </h2>
          <p className="text-lead font-light leading-[1.55] text-[var(--text)]">
            {typo("Как и в театре, в путешествии каждый выбирает свой жанр и свою драматургию.")}
          </p>
          <div className="space-y-4 border-t border-[var(--border)] pt-6 text-body font-light leading-[1.8] text-[var(--text-muted)]">
            <p>{typo(PROSE.p1)}</p>
            <p>{typo(PROSE.p2)}</p>
            <p>{typo(PROSE.p3)}</p>
          </div>
        </div>
      </section>

      {/* ─────────── ВАРИАНТ B ─────────── */}
      <Marker note="Те же две колонки, но со связью: вертикальная линейка, первая мысль лидом, низ левой колонки закрыт ссылкой — воздух становится намеренным.">
        Вариант B — редакционный разворот
      </Marker>
      <section className="border-y border-[var(--border)] bg-[var(--surface)] px-4 py-16 md:px-6 md:py-24 section-tint">
        <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,0.88fr)_minmax(320px,1.12fr)] lg:gap-16">
          <div className="flex flex-col justify-between gap-10">
            <div className="space-y-5">
              <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">Подход</p>
              <h2 className="text-section leading-[1.08] text-[var(--text)]">
                {typo("Как и в театре, каждый выбирает свой жанр")}
              </h2>
              <p className="max-w-[22rem] border-t border-[var(--border)] pt-5 text-body-sm font-light leading-[1.7] text-[var(--text-muted)]">
                {typo("Один и тот же маршрут можно прожить очень по-разному.")}
              </p>
            </div>
            <Link
              href="#"
              className="hidden items-center gap-2 text-label font-medium uppercase tracking-[0.16em] text-[var(--text-muted)] transition-colors hover:text-[var(--accent)] lg:inline-flex"
            >
              Форматы путешествия
              <span aria-hidden>↓</span>
            </Link>
          </div>
          <div className="space-y-5 text-body font-light leading-[1.8] text-[var(--text-muted)] lg:border-l lg:border-[var(--border)] lg:pt-2 lg:pl-12">
            <p className="text-lead leading-[1.6] text-[var(--text)]">{typo(PROSE.p1)}</p>
            <p className="max-w-[34rem]">{typo(PROSE.p2)}</p>
            <p className="max-w-[34rem]">{typo(PROSE.p3)}</p>
          </div>
        </div>
      </section>

      {/* ─────────── ВАРИАНТ C ─────────── */}
      <Marker note="Тезис эпиграфом на всю ширину, проза под линейкой в двух равных колонках. Конфликта высот нет структурно.">
        Вариант C — эпиграф и две равные колонки
      </Marker>
      <section className="border-y border-[var(--border)] bg-[var(--surface)] px-4 py-16 md:px-6 md:py-24 section-tint">
        <div className="mx-auto w-full max-w-6xl">
          <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">Подход</p>
          <h2 className="mt-5 max-w-[46rem] text-section leading-[1.08] text-[var(--text)]">
            {typo("Как и в театре, каждый выбирает свой жанр")}
          </h2>
          <div className="mt-10 grid gap-8 border-t border-[var(--border)] pt-10 text-body font-light leading-[1.8] text-[var(--text-muted)] md:grid-cols-2 md:gap-14">
            <p>{typo(`${PROSE.p1} ${PROSE.p2.split(" Кому-то")[0]}`)}</p>
            <div className="space-y-4">
              <p>{typo(`Кому-то${PROSE.p2.split(" Кому-то")[1]}`)}</p>
              <p>{typo(PROSE.p3)}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="h-24" />
    </div>
  );
}
