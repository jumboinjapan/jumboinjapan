/**
 * FAQ-блок маршрута (GEO): рендерит вопросы-ответы из Airtable Routes.FAQ
 * с FAQPage-разметкой. Если FAQ не заполнен — не рендерит ничего, так что
 * компонент безопасно стоит на всех маршрутных страницах заранее.
 *
 * Схема соответствует видимому контенту по построению: оба собираются из
 * одного массива. Редактор — вкладка Route Texts в админке.
 */

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
      <div className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
        {faq.map((item, index) => (
          <div key={index}>
            <h3 className="font-sans text-[17px] font-medium leading-[1.4] text-[var(--text)]">{item.q}</h3>
            <p className="mt-2 font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)] whitespace-pre-line">
              {item.a}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
