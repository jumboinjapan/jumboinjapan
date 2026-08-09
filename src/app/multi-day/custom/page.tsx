import Link from 'next/link'
import { ArrowRight, ChevronDown } from 'lucide-react'

import { PageHero } from '@/components/sections/PageHero'
import { multiDayCustomCopy } from '@/data/multiDayCustom'
import { buildPageMetadata } from '@/lib/page-metadata'
import { typoDeep } from '@/lib/typography'

/**
 * Индивидуальный маршрут (/multi-day/custom).
 *
 * ВЕСЬ ТЕКСТ — в src/data/multiDayCustom.ts. Здесь только вёрстка и схема.
 *
 * Страница держится на одном разговоре: человек боится, что под видом
 * индивидуального тура ему продадут общий, и что интересное покажут не всё.
 * Ответ — компромиссы, названные вслух. Поэтому блоков четыре, а не восемь:
 * страх и ответ, четыре статьи расхода, короткий FAQ, приглашение.
 *
 * Предыдущая версия была полноценным лендингом (восемь блоков, ~5800 px) —
 * её просто не стали бы читать. Не наращивать обратно без причины.
 */

const copy = typoDeep(multiDayCustomCopy)

export const metadata = buildPageMetadata('/multi-day/custom', {
  title: copy.meta.title,
  description: copy.meta.description,
  openGraph: {
    title: `${copy.meta.title} | JumboInJapan`,
    description: copy.meta.ogDescription,
    images: [{ url: `https://jumboinjapan.com${copy.hero.image}` }],
  },
})

/** Схема собирается из того же массива, что и видимый аккордеон. */
const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: copy.faq.items.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
}

const EYEBROW = 'text-label font-medium uppercase tracking-[0.18em] text-[var(--accent)]'
const PROSE = 'text-body-sm font-light leading-[1.85] text-[var(--text-muted)]'
/** Мера строки: в широких блоках абзац без ограничения уходит за 100 знаков. */
const MEASURE = 'max-w-[62ch]'

export default function MultiDayCustomPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <PageHero
        image={copy.hero.image}
        alt={copy.hero.alt}
        objectPosition={copy.hero.objectPosition}
        eyebrow={copy.hero.eyebrow}
        title={copy.hero.title}
        subtitle={copy.hero.subtitle}
      />

      {/* Страх и прямой ответ. Одна колонка: это не справка, а реплика. */}
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto w-full max-w-6xl">
          <div className="max-w-[46rem] space-y-5">
            <p className={EYEBROW}>{copy.lead.eyebrow}</p>
            <h2 className="text-section text-[var(--text)]">{copy.lead.title}</h2>
            {copy.lead.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-body font-light leading-[1.8] text-[var(--text-muted)]">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* Четыре статьи расхода — ядро страницы. Сетка 2×2 без карточек:
          сканируется взглядом, а не читается подряд. */}
      <section className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-12">
          <div className="max-w-3xl space-y-3">
            <p className={EYEBROW}>{copy.tradeoffs.eyebrow}</p>
            <h2 className="text-section text-[var(--text)]">{copy.tradeoffs.title}</h2>
          </div>

          <ul className="grid gap-x-12 gap-y-8 md:grid-cols-2 md:gap-y-10">
            {copy.tradeoffs.items.map((item) => (
              <li key={item.title} className="border-t border-[var(--border)] pt-5">
                <h3 className="text-lead leading-[1.3] text-[var(--text)]">{item.title}</h3>
                <p className={`mt-2 ${MEASURE} ${PROSE}`}>{item.text}</p>
              </li>
            ))}
          </ul>

          {/* Тот же обмен в числах. Единственный «предметный» объект страницы,
              поэтому он на surface, а всё остальное — открытый текст. */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-5 md:px-8 md:py-7">
            <p className={EYEBROW}>{copy.tradeoffs.example.label}</p>
            <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
              {copy.tradeoffs.example.cities.map((city, index) => (
                <li key={city} className="flex items-center gap-2">
                  {index > 0 && (
                    <span aria-hidden="true" className="text-[var(--accent)]">
                      →
                    </span>
                  )}
                  <span className="text-lead leading-[1.3] tracking-[-0.01em] text-[var(--text)]">{city}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-body-sm font-light text-[var(--text-muted)]">
              {copy.tradeoffs.example.facts.join(' · ')}
            </p>
            <p className={`mt-4 ${MEASURE} ${PROSE}`}>{copy.tradeoffs.example.note}</p>
          </div>
        </div>
      </section>

      {/* FAQ. Свёрнут, весит мало, но несёт разметку FAQPage — единственный
          структурированный источник страницы для поиска и языковых моделей.
          Ответы присутствуют в HTML и в свёрнутом виде, поэтому схема
          соответствует контенту. */}
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto w-full max-w-6xl space-y-7 md:space-y-9">
          <div className="max-w-3xl space-y-2">
            <p className={EYEBROW}>{copy.faq.eyebrow}</p>
            <h2 className="font-sans text-xl text-[var(--text-muted)]">{copy.faq.title}</h2>
          </div>

          <div className="space-y-3">
            {copy.faq.items.map((item, index) => (
              <details
                key={item.q}
                open={index === 0}
                className="group overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-1)] transition-colors hover:border-[var(--accent)]"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none">
                  <h3 className="text-body leading-[1.4] text-[var(--text)]">{item.q}</h3>
                  <ChevronDown
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-[var(--accent)] transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="border-t border-[var(--border)] px-5 py-4 font-sans text-body-sm font-light leading-[1.82] text-[var(--text-muted)]">
                  <span className={`block ${MEASURE}`}>{item.a}</span>
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Приглашение и выход на готовые маршруты: страница не должна
          заканчиваться тупиком «пишите или уходите». */}
      <section className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto w-full max-w-6xl space-y-8">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
            <h2 className="font-sans text-xl">{copy.cta.title}</h2>
            <p className={`max-w-2xl ${PROSE}`}>{copy.cta.text}</p>
            <Link
              href={copy.cta.href}
              className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--accent)] px-5 py-2.5 text-body-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
            >
              {copy.cta.buttonLabel}
            </Link>
          </div>

          <div className="space-y-3">
            <p className={EYEBROW}>{copy.cta.alternatives.label}</p>
            <ul className="flex flex-wrap gap-x-8 gap-y-1">
              {copy.cta.alternatives.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center gap-1.5 text-body-sm font-medium text-[var(--text)] transition-colors hover:text-[var(--accent)]"
                  >
                    {link.title}
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-[var(--accent)]" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  )
}
