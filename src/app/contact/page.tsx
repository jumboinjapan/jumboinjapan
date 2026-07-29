import type { Metadata } from "next";
import Image from "next/image";
import { ContactForm } from "@/components/sections/ContactForm";
import { ObfuscatedEmail } from "@/components/ObfuscatedEmail";

export const metadata: Metadata = {
  title: "Обсудить маршрут",
  description: "Несколько слов о ваших планах — и я помогу подобрать маршрут и формат поездки по Японии.",
  alternates: { canonical: "https://jumboinjapan.com/contact" },
  openGraph: {
    title: "Обсудить маршрут | JumboInJapan",
    description: "Несколько слов о ваших планах — и я помогу подобрать маршрут и формат поездки по Японии.",
  },
};

/**
 * Что происходит после отправки. Формулировки не придуманы заново — это тот
 * же порядок работы, что описан на главной (processSteps), сжатый до одной
 * строки на шаг: страница контактов не место для повторного рассказа, но
 * человек должен понимать, во что он ввязывается, до того как напишет.
 */
const whatHappensNext = [
  "Вы рассказываете о поездке: даты, состав группы, интересы и темп.",
  "Я предлагаю формат и маршрут — с понятной логикой, а не набором точек.",
  "Уточняем детали: логистику, транспорт, сезонные акценты и ритм дня.",
] as const;

export default function ContactPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-2 lg:gap-16">
        {/*
          Левая колонка. До аудита 2026-07-27 здесь были только заголовок и
          одна строка в 22 слова — на десктопе половина страницы оставалась
          пустой ровно там, где незнакомый человек решает, доверить ли
          поездку одному частному гиду. Всё, чем эта пустота заполнена,
          на сайте уже существовало: портрет — на главной, обещание времени
          ответа — в блоках CTA страниц маршрутов, порядок работы — в
          processSteps. Просто ничего из этого не было на странице, которая
          в этом нуждается больше всех.
        */}
        <div className="space-y-8">
          <div className="max-w-xl space-y-4">
            <h1 className="text-3xl md:text-4xl">Обсудить маршрут</h1>
            <p className="font-sans text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">
              Несколько слов о ваших планах — и я помогу подобрать маршрут и формат поездки. Достаточно пары
              строк: даты, состав группы и то, как вам хочется прожить эту поездку.
            </p>
          </div>

          <div className="flex items-start gap-5">
            <div className="relative aspect-[4/5] w-28 shrink-0 overflow-hidden border border-[var(--border)] bg-[var(--bg)] sm:w-32">
              <Image
                src="/about-photo.jpg"
                alt="Эдуард Ревидович, частный гид по Японии"
                fill
                className="object-cover object-top"
                sizes="128px"
              />
            </div>
            <div className="space-y-2 pt-1">
              <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">
                Эдуард Ревидович • частный гид в Японии
              </p>
              <p className="text-body-sm font-medium text-[var(--text)]">Ответ обычно в тот же день</p>
              <p className="text-body-sm font-light leading-[1.7] text-[var(--text-muted)]">
                Пишу лично — это не служба поддержки и не колл-центр.
              </p>
            </div>
          </div>

          {/* Нумерация здесь несёт смысл: это последовательность, а не список. */}
          <div className="space-y-4 border-t border-[var(--border)] pt-8">
            <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">Что дальше</p>
            <ol className="space-y-3">
              {whatHappensNext.map((step, index) => (
                <li key={step} className="flex gap-4 text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">
                  <span className="shrink-0 pt-px font-medium tabular-nums text-[var(--accent)]">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-2 border-t border-[var(--border)] pt-8">
            <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">
              Если удобнее письмом
            </p>
            <p className="text-body-sm text-[var(--text)]">
              <ObfuscatedEmail className="inline-flex min-h-11 items-center font-medium underline underline-offset-4 transition-colors hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-warm)]" />
            </p>
            <p className="text-meta font-light leading-[1.7] text-[var(--text-muted)]">
              Имя, контакт и даты нужны только для ответа на ваше обращение. Никаких рассылок.
            </p>
          </div>
        </div>

        <ContactForm />
      </div>
    </section>
  );
}
