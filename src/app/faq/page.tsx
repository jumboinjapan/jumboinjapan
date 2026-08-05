/**
 * /faq — общий FAQ сайта.
 *
 * Сквозные вопросы про поездку в Японию, на которые ответ не меняется от
 * маршрута: виза, деньги, транспорт, быт. Страницы маршрутов на них
 * ссылаются, а не повторяют — иначе пятнадцать страниц отвечают одинаково,
 * и канонического источника для цитаты не остаётся.
 *
 * Содержимое приходит из Airtable (src/lib/faq-general.ts). В этом файле не
 * должно появиться ни одного вопроса, ответа или названия раздела: правки
 * делаются в таблице FAQ General и выкатываются без деплоя.
 *
 * Разметка FAQPage собирается из того же массива, что и видимый текст, но
 * только из вопросов с готовым ответом (answeredFaqItems): объявлять схеме
 * вопрос, под которым на странице стоит заглушка, нельзя.
 *
 * АТРИБУЦИЯ — ТОЛЬКО В РАЗМЕТКЕ, НА СТРАНИЦЕ ЕЁ НЕТ. Решение владельца
 * 2026-08-05. Обоснование было такое: движки режут страницу на пассажи, и
 * при извлечении одного вопроса заголовок страницы с именем может не
 * поехать вместе с ним — значит автора надо назвать в каждом ответе. Из
 * этого следовал видимый байлайн под каждым вопросом, и он отклонён: сайт
 * персональный, подписывать на нём каждый ответ своим же именем странно.
 *
 * Поэтому author проставлен на FAQPage и на КАЖДОМ acceptedAnswer, но
 * ссылкой (guideRef), а не копией полей. Person объявлен ровно один раз в
 * корневом layout со стабильным @id — см. src/lib/schema.ts, находка В-3
 * аудита: несколько несвязанных Person на странице не дают движку понять,
 * что это одно лицо. Разворачивать здесь второй Person нельзя.
 *
 * Оговорка, чтобы не переоценивать эффект: доходит ли JSON-LD до ChatGPT и
 * Perplexity — публично неизвестно, стандартные извлекатели текста
 * выбрасывают <script> целиком. Для Google разбор структурированных данных
 * установлен. То есть это страховка с нулевой ценой, а не гарантия.
 */

import type { Metadata } from 'next'

import { GeneralFaq } from '@/components/sections/GeneralFaq'
import { answeredFaqItems, getCachedFaqGeneral } from '@/lib/faq-general'
import { buildPageMetadata } from '@/lib/page-metadata'
import { BASE_URL, guideRef, organizationRef } from '@/lib/schema'

export const metadata: Metadata = buildPageMetadata('/faq', {
  title: 'Вопросы о поездке в Японию — JumboInJapan',
  description:
    'Виза, транспорт и проездные, деньги, багаж, сезоны, поездка с детьми. Отвечает частный русскоязычный гид в Японии.',
})

export default async function FaqPage() {
  const sections = await getCachedFaqGeneral()

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${BASE_URL}/faq#faq`,
    url: `${BASE_URL}/faq`,
    inLanguage: 'ru',
    author: guideRef,
    publisher: organizationRef,
    mainEntity: answeredFaqItems(sections).map((item) => ({
      '@type': 'Question',
      name: item.q,
      // Якорь ведёт на конкретный вопрос, а не на страницу целиком: если
      // движок процитирует один ответ, ссылка приведёт человека к нему.
      url: `${BASE_URL}/faq#${item.id}`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a.join(' '),
        url: `${BASE_URL}/faq#${item.id}`,
        author: guideRef,
      },
    })),
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <header className="mx-auto w-full max-w-6xl px-4 pb-12 pt-16 md:px-6 md:pb-12 md:pt-22">
        <div className="max-w-[640px]">
          <h1 className="text-page leading-[1.08] tracking-[-0.02em] text-[var(--text)] text-balance">
            Вопросы о поездке в Японию
          </h1>
          <p className="mt-5 max-w-[54ch] font-sans text-body font-light leading-[1.65] text-[var(--text-muted)] md:text-lead">
            Отвечаю на то, что спрашивают чаще всего — коротко и по делу. Если вашего вопроса здесь нет,
            напишите: отвечу лично.
          </p>
          <div className="mt-8 flex max-w-[460px] items-center gap-3.5 border-t border-[var(--border)] pt-5.5">
            <svg width="22" height="28" viewBox="11 5 64 80" fill="none" aria-hidden="true">
              <path d="M 64 16 V 56 A 21 21 0 0 1 22 56" stroke="var(--text)" strokeWidth="10" strokeLinecap="round" />
              <circle cx="64" cy="16" r="8.5" fill="var(--accent)" />
              <circle cx="64" cy="16" r="3" fill="var(--bg)" />
              <circle cx="22" cy="56" r="8.5" fill="var(--accent)" />
              <circle cx="22" cy="56" r="3" fill="var(--bg)" />
            </svg>
            <span className="flex flex-col gap-0.5">
              <span className="text-body-sm text-[var(--text)]">Эдуард Ревидович</span>
              <span className="text-meta text-[var(--text-muted)]">частный гид в Японии, отвечает лично</span>
            </span>
          </div>
        </div>
      </header>

      <GeneralFaq sections={sections} />
    </>
  )
}
