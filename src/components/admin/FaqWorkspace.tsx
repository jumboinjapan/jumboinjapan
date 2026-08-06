'use client'

/**
 * Редактор общего FAQ (/admin/faq). Владелец правит вопросы и ответы сам,
 * без пересылки текстов через разработчика.
 *
 * Почему не хватило Airtable, где те же поля уже редактируются: ответ здесь
 * многоабзацный, и в ячейке грида его не видно целиком — а именно ответ и
 * правится чаще всего. Плюс редактор показывает то, чего таблица не знает:
 * попадёт ли вопрос в FAQPage-разметку, на сколько абзацев разобьётся текст и
 * что произойдёт при публикации без ответа.
 *
 * Якорь не редактируется намеренно — он часть публичного URL и ломает ссылки
 * молча. Менять только вручную в Airtable, вместе со всеми ссылками на него.
 *
 * Сохраняются только изменённые вопросы; после записи API инвалидирует тег
 * 'airtable:faq', так что правка на сайте появляется сразу.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { AdminShell } from '@/components/admin/AdminShell'
import {
  adminInputClass,
  adminPanelClass,
  adminPrimaryButtonClass,
  adminSecondaryButtonClass,
  EmptyNote,
  SectionTitle,
  StatusChip,
} from '@/components/admin/ui'
import { cn } from '@/lib/utils'

const ATTRS = ['первая поездка', 'с детьми', 'мобильность'] as const
type Attr = (typeof ATTRS)[number]

const STATUSES = [
  { value: 'published', label: 'На сайте' },
  { value: 'draft', label: 'Черновик' },
  { value: 'hidden', label: 'Скрыт' },
] as const
type Status = (typeof STATUSES)[number]['value']

interface Section {
  id: string
  title: string
  anchor: string
  order: number
  status: Status
}

interface Item {
  id: string
  question: string
  anchor: string
  answer: string
  sectionId: string | null
  order: number
  status: Status
  attrs: Attr[]
  note: string
  checkedAt: string
}

type Filter = 'all' | 'draft' | 'empty'

/** Абзац = блок, отделённый пустой строкой. Тот же разбор, что на сайте. */
function countParagraphs(answer: string): number {
  return answer
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean).length
}

export function FaqWorkspace() {
  const [sections, setSections] = useState<Section[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [initial, setInitial] = useState<Record<string, Item>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const absorb = useCallback((data: { sections?: Section[]; items?: Item[] }) => {
    if (Array.isArray(data.sections)) setSections(data.sections)
    if (Array.isArray(data.items)) {
      setItems(data.items)
      setInitial(Object.fromEntries(data.items.map((item) => [item.id, item])))
    }
  }, [])

  useEffect(() => {
    fetch('/api/admin/faq')
      .then((r) => r.json())
      .then(absorb)
      .catch(() => setToast({ type: 'err', msg: 'Не удалось загрузить FAQ' }))
      .finally(() => setLoading(false))
  }, [absorb])

  function update(id: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  // Отправляем только изменённое: так случайный клик по чекбоксу не переписывает
  // тридцать записей и не путает историю правок в Airtable.
  const dirty = useMemo(
    () =>
      items.filter((item) => {
        const was = initial[item.id]
        if (!was) return false
        return (
          was.question !== item.question ||
          was.answer !== item.answer ||
          was.sectionId !== item.sectionId ||
          was.order !== item.order ||
          was.status !== item.status ||
          was.note !== item.note ||
          was.checkedAt !== item.checkedAt ||
          was.attrs.join('|') !== item.attrs.join('|')
        )
      }),
    [items, initial],
  )

  async function save() {
    if (dirty.length === 0) return
    setSaving(true)
    setToast(null)
    try {
      const res = await fetch('/api/admin/faq', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: dirty }),
      })
      const data = (await res.json()) as { ok?: boolean; sections?: Section[]; items?: Item[]; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error || 'Ошибка сохранения')
      absorb(data)
      setToast({ type: 'ok', msg: `Сохранено: ${dirty.length}. На сайте уже видно.` })
    } catch (error) {
      setToast({ type: 'err', msg: error instanceof Error ? error.message : 'Ошибка сохранения' })
    } finally {
      setSaving(false)
    }
  }

  const published = items.filter((item) => item.status === 'published')
  const answered = published.filter((item) => item.answer.trim())
  const visible = items.filter((item) => {
    if (filter === 'draft') return item.status !== 'published'
    if (filter === 'empty') return !item.answer.trim()
    return true
  })

  return (
    <AdminShell
      currentPath="/admin/faq"
      title="Общий FAQ"
      subtitle="Вопросы страницы /faq — текст правится здесь и уходит на сайт сразу"
      actions={
        <div className="flex items-center gap-2">
          <a href="/faq" target="_blank" rel="noreferrer" className={adminSecondaryButtonClass}>
            Открыть страницу
          </a>
          <button type="button" onClick={save} disabled={saving || loading || dirty.length === 0} className={adminPrimaryButtonClass}>
            {saving ? 'Сохранение…' : dirty.length > 0 ? `Сохранить (${dirty.length})` : 'Сохранено'}
          </button>
        </div>
      }
    >
      {toast && (
        <div
          className={cn(
            'mt-4 rounded-lg border px-4 py-2.5 text-sm',
            toast.type === 'ok'
              ? 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]'
              : 'border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]',
          )}
        >
          {toast.msg}
        </div>
      )}

      <div className="mt-6">
        <SectionTitle>
          {published.length} на сайте · {answered.length} с ответом · {items.length} всего
        </SectionTitle>
        <p className="mb-4 max-w-2xl text-sm text-[var(--adm-text-3)]">
          В разметку FAQPage попадают только вопросы со статусом «На сайте» и непустым ответом — схема обязана
          совпадать с видимым текстом. Вопрос без ответа отрендерится с заглушкой, поэтому держите его в
          черновиках, пока ответ не написан. Абзацы в ответе разделяются пустой строкой.
        </p>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {([
            ['all', `Все (${items.length})`],
            ['draft', `Черновики (${items.filter((i) => i.status !== 'published').length})`],
            ['empty', `Без ответа (${items.filter((i) => !i.answer.trim()).length})`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                'inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition',
                filter === value
                  ? 'border-[var(--adm-border-strong)] bg-[var(--adm-active)] text-[var(--adm-text)]'
                  : 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-3)] hover:text-[var(--adm-text)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <EmptyNote>Загрузка…</EmptyNote>
        ) : visible.length === 0 ? (
          <EmptyNote>Здесь пусто — смените фильтр</EmptyNote>
        ) : (
          <div className="flex flex-col gap-6">
            {sections.map((section) => {
              const inSection = visible
                .filter((item) => item.sectionId === section.id)
                .sort((a, b) => a.order - b.order)
              if (inSection.length === 0) return null

              return (
                <div key={section.id}>
                  <p className="mb-2 text-sm font-medium text-[var(--adm-text-2)]">
                    {section.title}{' '}
                    <span className="font-normal text-[var(--adm-text-3)]">· {inSection.length}</span>
                  </p>

                  <div className="flex flex-col gap-2">
                    {inSection.map((item) => {
                      const isOpen = open === item.id
                      const paragraphs = countParagraphs(item.answer)
                      const isDirty = dirty.some((d) => d.id === item.id)

                      return (
                        <div key={item.id} className={cn(adminPanelClass, 'overflow-hidden')}>
                          <button
                            type="button"
                            onClick={() => setOpen(isOpen ? null : item.id)}
                            className="flex w-full items-start gap-3 p-4 text-left"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-[var(--adm-text)]">{item.question || '(без вопроса)'}</span>
                              <span className="mt-1 block text-xs text-[var(--adm-text-3)]">
                                {paragraphs > 0 ? `${paragraphs} абз. · ${item.answer.trim().length} зн.` : 'ответа нет'}
                                {item.checkedAt ? ` · сверено ${item.checkedAt}` : ''}
                              </span>
                            </span>
                            {isDirty && <StatusChip tone="warning">не сохранено</StatusChip>}
                            <StatusChip tone={item.status === 'published' ? (item.answer.trim() ? 'success' : 'warning') : 'neutral'}>
                              {STATUSES.find((s) => s.value === item.status)?.label}
                            </StatusChip>
                          </button>

                          {isOpen && (
                            <div className="border-t border-[var(--adm-border)] p-4">
                              <label className="mb-1 block text-xs text-[var(--adm-text-3)]">Вопрос</label>
                              <input
                                type="text"
                                value={item.question}
                                onChange={(e) => update(item.id, { question: e.target.value })}
                                className={adminInputClass}
                              />

                              <label className="mb-1 mt-4 block text-xs text-[var(--adm-text-3)]">
                                Ответ · абзацы разделяются пустой строкой
                              </label>
                              <textarea
                                value={item.answer}
                                onChange={(e) => update(item.id, { answer: e.target.value })}
                                rows={Math.min(24, Math.max(8, item.answer.split('\n').length + 2))}
                                placeholder="Первое предложение должно отвечать на вопрос без него самого — при цитировании вопрос может не поехать вместе с ответом."
                                className={cn(adminInputClass, 'resize-y leading-[1.7]')}
                              />

                              {item.status === 'published' && !item.answer.trim() && (
                                <p className="mt-2 text-xs text-[var(--adm-danger-text)]">
                                  Статус «На сайте», но ответа нет: вопрос выйдет с заглушкой и в разметку не попадёт.
                                </p>
                              )}

                              <div className="mt-4 flex flex-wrap items-end gap-4">
                                <div>
                                  <label className="mb-1 block text-xs text-[var(--adm-text-3)]">Статус</label>
                                  <select
                                    value={item.status}
                                    onChange={(e) => update(item.id, { status: e.target.value as Status })}
                                    className={cn(adminInputClass, 'w-36')}
                                  >
                                    {STATUSES.map((s) => (
                                      <option key={s.value} value={s.value}>
                                        {s.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="mb-1 block text-xs text-[var(--adm-text-3)]">Раздел</label>
                                  <select
                                    value={item.sectionId ?? ''}
                                    onChange={(e) => update(item.id, { sectionId: e.target.value || null })}
                                    className={cn(adminInputClass, 'w-52')}
                                  >
                                    <option value="">— без раздела —</option>
                                    {sections.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.title}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="mb-1 block text-xs text-[var(--adm-text-3)]">Порядок</label>
                                  <input
                                    type="number"
                                    value={item.order}
                                    onChange={(e) => update(item.id, { order: Number(e.target.value) })}
                                    className={cn(adminInputClass, 'w-20')}
                                  />
                                </div>

                                <div>
                                  <label className="mb-1 block text-xs text-[var(--adm-text-3)]">Сверено</label>
                                  <input
                                    type="date"
                                    value={item.checkedAt}
                                    onChange={(e) => update(item.id, { checkedAt: e.target.value })}
                                    className={cn(adminInputClass, 'w-40')}
                                  />
                                </div>
                              </div>

                              <div className="mt-4">
                                <label className="mb-1.5 block text-xs text-[var(--adm-text-3)]">
                                  Признаки · только те, под которые есть поле в Prospects
                                </label>
                                <div className="flex flex-wrap gap-3">
                                  {ATTRS.map((attr) => (
                                    <label key={attr} className="flex items-center gap-2 text-sm text-[var(--adm-text-2)]">
                                      <input
                                        type="checkbox"
                                        checked={item.attrs.includes(attr)}
                                        onChange={(e) =>
                                          update(item.id, {
                                            attrs: e.target.checked
                                              ? [...item.attrs, attr]
                                              : item.attrs.filter((a) => a !== attr),
                                          })
                                        }
                                        className="size-4 accent-[var(--adm-accent)]"
                                      />
                                      {attr}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <label className="mb-1 mt-4 block text-xs text-[var(--adm-text-3)]">
                                Заметка редактора · на сайт не выводится
                              </label>
                              <textarea
                                value={item.note}
                                onChange={(e) => update(item.id, { note: e.target.value })}
                                rows={3}
                                className={cn(adminInputClass, 'resize-y')}
                              />

                              <p className="mt-4 text-xs text-[var(--adm-text-3)]">
                                Якорь <code>{item.anchor}</code> — часть адреса{' '}
                                <a
                                  href={`/faq#${item.anchor}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline underline-offset-2 hover:text-[var(--adm-text)]"
                                >
                                  /faq#{item.anchor}
                                </a>
                                . Здесь не меняется: на него ссылаются страницы маршрутов и внешние источники.
                              </p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
