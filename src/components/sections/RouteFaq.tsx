/**
 * FAQ-блок маршрута (GEO): рендерит вопросы-ответы из Airtable Routes.FAQ
 * с FAQPage-разметкой. Если FAQ не заполнен — не рендерит ничего, так что
 * компонент безопасно стоит на всех маршрутных страницах заранее.
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
    <section className="mx-auto max-w-5xl px-6 py-16 md:py-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <SectionHeading eyebrow="Частые вопросы" title="Что обычно уточняют перед этим маршрутом" />
      {/* Аккордеон на нативном <details> — компонент остаётся серверным.
          Полные ответы присутствуют в HTML и в свёрнутом виде, так что
          FAQPage-разметка по-прежнему соответствует контенту страницы. */}
      <div className="mt-8 max-w-3xl border-t border-[var(--border)]">
        {faq.map((item, index) => (
          <details key={index} open={index === 0} className="group border-b border-[var(--border)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 marker:content-none">
              <h3 className="font-sans text-[16px] font-medium leading-[1.4] tracking-[-0.01em] text-[var(--text)] md:text-[17px]">
                {item.q}
              </h3>
              <ChevronDown className="h-4 w-4 shrink-0 text-[var(--accent)] transition-transform group-open:rotate-180" />
            </summary>
            <p className="max-w-2xl pb-6 font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)] whitespace-pre-line">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  )
}
