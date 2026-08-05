'use client'

/**
 * Общий FAQ (/faq): рельс разделов, поиск и аккордеон.
 *
 * ПОЧЕМУ КЛИЕНТСКИЙ. Нужны поиск, подсветка текущего раздела и раскрытие
 * без перезагрузки. Next рендерит клиентские компоненты на сервере, поэтому
 * ВСЕ вопросы и ответы присутствуют в HTML первой отдачи.
 *
 * КЛЮЧЕВОЕ ПРАВИЛО РЕНДЕРА: ничего не выбрасывается из разметки и нет
 * пагинации. Свёрнутая панель схлопнута через grid-template-rows:0fr, поиск
 * прячет строку через hidden — текст остаётся в DOM. Так человек фильтрует,
 * а краулер и языковая модель видят документ целиком. Если когда-нибудь
 * появится желание рендерить только найденное — этого делать нельзя.
 *
 * ДАННЫЕ приходят пропсом из Airtable (src/lib/faq-general.ts). Компонент
 * ничего не знает про источники вопросов и заметки редактора — этих полей
 * нет в типе FaqItem, и добавлять их сюда нельзя.
 *
 * Разметка FAQPage живёт на странице (src/app/faq/page.tsx) и собирается из
 * того же массива, что и видимый текст, но только из вопросов с готовым
 * ответом: схема обязана совпадать с содержимым страницы.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { FaqSection } from '@/lib/faq-general'
import { pluralRu } from '@/lib/plural'
import { typoDeep } from '@/lib/typography'

export function GeneralFaq({ sections }: { sections: FaqSection[] }) {
  const data = useMemo(() => typoDeep(sections), [sections])

  const total = useMemo(() => data.reduce((n, s) => n + s.items.length, 0), [data])
  const firstAnswered = useMemo(
    () => data.flatMap((s) => s.items).find((i) => i.a.length > 0)?.id ?? null,
    [data],
  )

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(firstAnswered)
  const [active, setActive] = useState<string | null>(null)
  const railRefs = useRef<Record<string, HTMLElement | null>>({})

  const q = query.trim().toLowerCase()

  // Один матчер на всё: и подсчёт для рельса, и фильтрация строк. Ищем по
  // вопросу и по тексту ответа — человек чаще помнит формулировку изнутри.
  const matches = useCallback(
    (item: { q: string; a: string[] }) => !q || (item.q + ' ' + item.a.join(' ')).toLowerCase().includes(q),
    [q],
  )

  const visible = useMemo(() => {
    const map: Record<string, number> = {}
    let shown = 0
    for (const s of data) {
      const n = s.items.filter(matches).length
      map[s.id] = n
      shown += n
    }
    return { map, shown }
  }, [data, matches])

  // Подсветка текущего раздела в рельсе. Порог 140px совпадает со
  // scroll-margin-top секций, чтобы клик по рельсу сразу подсвечивал цель.
  useEffect(() => {
    const onScroll = () => {
      let current: string | null = null
      for (const s of data) {
        const el = railRefs.current[s.id]
        if (el && el.getBoundingClientRect().top <= 140) current = s.id
      }
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [data])

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-0 px-4 md:px-6 lg:grid-cols-[212px_minmax(0,1fr)] lg:gap-18">
      {/* ── рельс разделов ─────────────────────────────────────── */}
      <aside className="sticky top-23 hidden pt-9 lg:block">
        <p className="mb-3.5 text-meta text-[var(--text-muted)]">Разделы</p>
        <nav aria-label="Разделы FAQ" className="flex flex-col">
          {data.map((s) => {
            const on = active === s.id
            const n = visible.map[s.id] ?? 0
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                style={{ opacity: n ? 1 : 0.35 }}
                className={`flex items-center gap-2.5 py-1.5 text-[0.9rem] transition-colors duration-[180ms] ${
                  on ? 'text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-[5px] w-[5px] flex-none rounded-full bg-[var(--accent)] transition-all duration-[260ms] ${
                    on ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                  }`}
                />
                <span>{s.title}</span>
                <span className="ml-auto text-meta tabular-nums text-[var(--text-muted)]">{n}</span>
              </a>
            )
          })}
        </nav>
        <p className="mt-6 border-t border-[var(--border)] pt-4.5 text-meta leading-relaxed text-[var(--text-muted)]">
          Не нашли вопрос — <a href="/contact" className="text-[var(--accent)] hover:text-[var(--accent-hover)]">напишите</a>, отвечу лично.
        </p>
      </aside>

      {/* ── вопросы ────────────────────────────────────────────── */}
      <div className="min-w-0 pb-6">
        <div className="py-4 lg:pt-9">
          <div className="relative">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Поиск по вопросам"
            placeholder="Найти вопрос — «JR Pass», «дети», «чемоданы»"
            className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pl-10.5 pr-4 text-body-sm text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-[180ms] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(181,52,26,.12)]"
          />
          </div>
          <p className="mt-2.5 text-meta text-[var(--text-muted)]">
            {q
              ? `Показано ${visible.shown} из ${total}`
              : `${total} ${pluralRu(total, 'вопрос', 'вопроса', 'вопросов')} в ${data.length} ${pluralRu(data.length, 'разделе', 'разделах', 'разделах')}`}
          </p>
        </div>

        {data.map((section, si) => {
          const items = section.items.filter(matches)
          if (items.length === 0) return null
          return (
            <section
              key={section.id}
              id={section.id}
              ref={(el) => {
                railRefs.current[section.id] = el
              }}
              className="scroll-mt-30"
            >
              <header className="flex items-baseline gap-4 border-b border-[var(--text)] pb-3 pt-10">
                <span className="text-meta tabular-nums tracking-[0.04em] text-[var(--text-muted)]">
                  {String(si + 1).padStart(2, '0')}
                </span>
                <h2 className="text-title text-[var(--text)]">{section.title}</h2>
                <span className="ml-auto text-meta tabular-nums text-[var(--text-muted)]">{items.length}</span>
              </header>

              {items.map((item) => {
                const isOpen = open === item.id
                const answered = item.a.length > 0
                return (
                  <div key={item.id} id={item.id} className="scroll-mt-30 border-b border-[var(--border)]">
                    <h3>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`panel-${item.id}`}
                        onClick={() => setOpen(isOpen ? null : item.id)}
                        className="flex w-full cursor-pointer items-start justify-between gap-7 border-0 bg-transparent px-0.5 py-5 text-left text-[1.1875rem] font-normal leading-[1.45] tracking-[-0.005em] text-[var(--text)]"
                      >
                        <span>{item.q}</span>
                        <span
                          aria-hidden="true"
                          className={`mt-px grid h-7 w-7 flex-none place-items-center rounded-full border border-[var(--border)] transition-[transform,background-color] duration-[420ms] ease-[cubic-bezier(.16,1,.3,1)] ${
                            isOpen ? 'rotate-180 bg-[var(--bg-warm)]' : 'bg-transparent'
                          }`}
                        >
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M2.5 4.75 6 8.25l3.5-3.5" />
                          </svg>
                        </span>
                      </button>
                    </h3>
                    <div
                      id={`panel-${item.id}`}
                      className="grid transition-[grid-template-rows] duration-[460ms] ease-[cubic-bezier(.16,1,.3,1)]"
                      style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                    >
                      <div className="overflow-hidden">
                        <div className="flex max-w-[66ch] flex-col gap-4 px-0.5 pb-7 text-body-sm font-light leading-[1.82] text-[var(--text-muted)]">
                          {answered ? (
                            item.a.map((p, i) => <p key={i}>{p}</p>)
                          ) : (
                            <p className="italic opacity-80">Ответ готовится. Напишите — отвечу лично.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </section>
          )
        })}

        {visible.shown === 0 ? (
          <p className="py-14 text-body-sm text-[var(--text-muted)]">
            Ничего не нашлось. Попробуйте другое слово — или{' '}
            <a href="/contact" className="text-[var(--accent)] hover:text-[var(--accent-hover)]">спросите напрямую</a>.
          </p>
        ) : null}
      </div>
    </div>
  )
}
