/**
 * FAQ-блок маршрута (GEO): рендерит вопросы-ответы из Airtable Routes.FAQ
 * с FAQPage-разметкой. Если FAQ не заполнен — не рендерит ничего, так что
 * компонент безопасно стоит на всех маршрутных страницах заранее.
 *
 * Визуально это полноширинная полоса в языке маршрутных страниц (border-t,
 * сетка max-w-6xl, карточки surface с hover-акцентом — как «Похожие туры» и
 * дни в дереве многодневных маршрутов). Аккордеон на нативном <details>,
 * компонент остаётся серверным; полные ответы присутствуют в HTML и в
 * свёрнутом виде, так что схема соответствует контенту страницы.
 *
 * Схема соответствует видимому контенту по построению: оба собираются из
 * одного массива. Редактор — вкладка Route Texts в админке.
 */

import { ChevronDown } from 'lucide-react'

import { getMultiDayRouteSeoFieldsCached } from '@/lib/multi-day-builder-storage'
import { SectionHeading } from '@/components/sections/SectionHeading'

export async function RouteFaq({ slug }: { slug: string }) {
  const seo = await getMultiDayRouteSeoFieldsCached(slug).catch(() => null)
  const faq = seo?.faq ?? []
  if (faq.length === 0) return null

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-12 md:px-6 md:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <div className="mx-auto w-full max-w-6xl space-y-8 md:space-y-10">
        <SectionHeading eyebrow="Частые вопросы" title="Что обычно уточняют перед этим маршрутом" />
        <div className="max-w-3xl space-y-3">
          {faq.map((item, index) => (
            <details
              key={index}
              open={index === 0}
              className="group overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-1)] transition-colors hover:border-[var(--accent)]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none">
                <h3 className="font-sans text-[16px] font-medium leading-[1.4] tracking-[-0.01em] text-[var(--text)] md:text-[17px]">
                  {item.q}
                </h3>
                <ChevronDown
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[var(--accent)] transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="border-t border-[var(--border)] px-5 py-4 font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)] whitespace-pre-line">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
