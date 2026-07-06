'use client'

/**
 * Ф-2: редактор текстов маршрутов (Routes: SEO Title / SEO Description /
 * Route Intro, Draft → Approved). Закрывает асимметрию Этапа 2: публичные
 * страницы рендерят Approved-поля, но до этого экрана их можно было править
 * только в интерфейсе Airtable. Отдельный воркспейс — сознательно НЕ секция
 * внутри AdminOperationsConsole (правило Т-1: монолит не наращиваем).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'

import { AdminShell } from '@/components/admin/AdminShell'
import { adminInputClass, adminPanelClass, adminPrimaryButtonClass, adminSecondaryButtonClass, EmptyNote, StatusChip } from '@/components/admin/ui'
import { cn } from '@/lib/utils'

interface RouteTextItem {
  id: string
  slug: string
  title: string
  routeType: string
  seoTitleDraft: string
  seoTitleApproved: string
  seoDescriptionDraft: string
  seoDescriptionApproved: string
  routeIntroDraft: string
  routeIntroApproved: string
  faq: string
}

interface FaqPair {
  q: string
  a: string
}

function parseFaqPairs(raw: string): FaqPair[] {
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => ({
      q: String((item as { q?: unknown })?.q ?? ''),
      a: String((item as { a?: unknown })?.a ?? ''),
    }))
  } catch {
    return []
  }
}

function serializeFaqPairs(pairs: FaqPair[]): string {
  const cleaned = pairs.filter((p) => p.q.trim() !== '' || p.a.trim() !== '')
  return cleaned.length === 0 ? '' : JSON.stringify(cleaned)
}

type FieldPair = {
  key: 'seoTitle' | 'seoDescription' | 'routeIntro'
  label: string
  hint: string
  airtableDraft: string
  airtableApproved: string
  rows: number
}

const FIELD_PAIRS: FieldPair[] = [
  {
    key: 'seoTitle',
    label: 'SEO Title',
    hint: 'Заголовок в поиске; ориентир до ~60 символов',
    airtableDraft: 'SEO Title Draft',
    airtableApproved: 'SEO Title Approved',
    rows: 2,
  },
  {
    key: 'seoDescription',
    label: 'SEO Description',
    hint: 'Описание в поиске; ориентир 140–160 символов',
    airtableDraft: 'SEO Description Draft',
    airtableApproved: 'SEO Description Approved',
    rows: 3,
  },
  {
    key: 'routeIntro',
    label: 'Вводный текст маршрута',
    hint: 'Абзац-вступление на странице маршрута и в печатной программе',
    airtableDraft: 'Route Intro Draft',
    airtableApproved: 'Route Intro Approved',
    rows: 5,
  },
]

function sectionOf(slug: string): string {
  if (slug.startsWith('intercity/')) return 'Выездные'
  if (slug.startsWith('city-tour/')) return 'Городские'
  if (slug.startsWith('multi-day/')) return 'Многодневные'
  return 'Прочее'
}

export function RouteTextWorkspace() {
  const [routes, setRoutes] = useState<RouteTextItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<RouteTextItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/admin/route-text')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setRoutes(data)
          if (data.length > 0) setSelectedId(data[0].id)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const selected = useMemo(() => routes.find((r) => r.id === selectedId) ?? null, [routes, selectedId])

  useEffect(() => {
    setDraft(selected ? { ...selected } : null)
  }, [selected])

  const grouped = useMemo(() => {
    const map: Record<string, RouteTextItem[]> = {}
    for (const r of routes) {
      ;(map[sectionOf(r.slug)] ??= []).push(r)
    }
    return map
  }, [routes])

  const isDirty = useMemo(() => {
    if (!draft || !selected) return false
    if (draft.faq !== selected.faq) return true
    return FIELD_PAIRS.some(
      (pair) =>
        draft[`${pair.key}Draft` as keyof RouteTextItem] !== selected[`${pair.key}Draft` as keyof RouteTextItem] ||
        draft[`${pair.key}Approved` as keyof RouteTextItem] !== selected[`${pair.key}Approved` as keyof RouteTextItem],
    )
  }, [draft, selected])

  const persist = useCallback(
    async (next: RouteTextItem, okMessage: string) => {
      setSaving(true)
      try {
        const fields: Record<string, string> = {}
        for (const pair of FIELD_PAIRS) {
          fields[pair.airtableDraft] = next[`${pair.key}Draft` as keyof RouteTextItem] as string
          fields[pair.airtableApproved] = next[`${pair.key}Approved` as keyof RouteTextItem] as string
        }
        fields['FAQ'] = next.faq
        const res = await fetch('/api/admin/route-text', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: next.id, fields }),
        })
        const data = (await res.json()) as { ok?: boolean; error?: string }
        if (!res.ok || !data.ok) {
          setToast({ type: 'err', msg: data.error || 'Не удалось сохранить' })
          return
        }
        setRoutes((prev) => prev.map((r) => (r.id === next.id ? next : r)))
        setToast({ type: 'ok', msg: okMessage })
      } catch {
        setToast({ type: 'err', msg: 'Не удалось сохранить' })
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  function updateDraft(key: string, value: string) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  function approvePair(pair: FieldPair) {
    if (!draft) return
    const draftValue = draft[`${pair.key}Draft` as keyof RouteTextItem] as string
    const next = { ...draft, [`${pair.key}Approved`]: draftValue }
    setDraft(next)
    void persist(next, `«${pair.label}» утверждён — уже на сайте`)
  }

  return (
    <AdminShell
      currentPath="/admin/route-text"
      title="Тексты маршрутов"
      subtitle="SEO-заголовки, описания и вводные абзацы — то, что рендерят публичные страницы"
    >
      {toast && (
        <div
          className={cn(
            'mb-4 rounded-xl px-4 py-2 text-sm',
            toast.type === 'ok'
              ? 'border border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]'
              : 'border border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]',
          )}
        >
          {toast.msg}
        </div>
      )}

      <div className="flex flex-1 gap-4">
        {/* Routes sidebar */}
        <aside className={cn(adminPanelClass, 'w-72 shrink-0 overflow-y-auto p-3')}>
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--adm-text-3)]">Маршруты</div>
          {loading ? (
            <div className="py-8 text-center text-sm text-[var(--adm-text-3)]">Загрузка…</div>
          ) : (
            <div className="mt-3 space-y-3">
              {Object.entries(grouped).map(([section, list]) => (
                <div key={section}>
                  <div className="mb-1 text-[11px] font-medium text-[var(--adm-text-3)]">{section}</div>
                  {list.map((r) => {
                    const approvedCount = FIELD_PAIRS.filter(
                      (p) => (r[`${p.key}Approved` as keyof RouteTextItem] as string).trim() !== '',
                    ).length
                    return (
                      <button
                        key={r.id}
                        onClick={() => setSelectedId(r.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition',
                          selectedId === r.id
                            ? 'bg-[var(--adm-active)] text-[var(--adm-text)]'
                            : 'text-[var(--adm-text-2)] hover:bg-[var(--adm-hover)] hover:text-[var(--adm-text)]',
                        )}
                      >
                        <span className="truncate">{r.title || r.slug}</span>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-1.5 text-[10px] tabular-nums',
                            approvedCount === FIELD_PAIRS.length
                              ? 'bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]'
                              : 'bg-[var(--adm-active)] text-[var(--adm-text-3)]',
                          )}
                        >
                          {approvedCount}/{FIELD_PAIRS.length}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Editor */}
        <div className={cn(adminPanelClass, 'flex-1 overflow-y-auto p-5')}>
          {!draft ? (
            <EmptyNote>Выберите маршрут</EmptyNote>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-[var(--adm-text)]">{draft.title || draft.slug}</h2>
                  <a
                    href={`/${draft.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[var(--adm-accent-text)] hover:underline"
                  >
                    Открыть на сайте ↗
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      setSaving(true)
                      try {
                        const res = await fetch('/api/admin/revalidate', { method: 'POST' })
                        setToast(
                          res.ok
                            ? { type: 'ok', msg: 'Кэш сайта сброшен — правки из Airtable видны сразу' }
                            : { type: 'err', msg: 'Не удалось сбросить кэш' },
                        )
                      } catch {
                        setToast({ type: 'err', msg: 'Не удалось сбросить кэш' })
                      } finally {
                        setSaving(false)
                      }
                    }}
                    disabled={saving}
                    className={adminSecondaryButtonClass}
                    title="Для правок, внесённых напрямую в Airtable: сайт увидит их сразу, а не через час"
                  >
                    Обновить кэш сайта
                  </button>
                  <button
                    onClick={() => draft && persist(draft, 'Сохранено')}
                    disabled={!isDirty || saving}
                    className={adminPrimaryButtonClass}
                    title={isDirty ? undefined : 'Нет несохранённых изменений'}
                  >
                    {saving ? 'Сохраняю…' : 'Сохранить'}
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                {FIELD_PAIRS.map((pair) => {
                  const draftKey = `${pair.key}Draft` as keyof RouteTextItem
                  const approvedKey = `${pair.key}Approved` as keyof RouteTextItem
                  const draftValue = draft[draftKey] as string
                  const approvedValue = draft[approvedKey] as string
                  return (
                    <section key={pair.key} className="rounded-xl border border-[var(--adm-border)] bg-[var(--adm-inset)] p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-medium text-[var(--adm-text)]">{pair.label}</h3>
                          <p className="text-xs text-[var(--adm-text-3)]">{pair.hint}</p>
                        </div>
                        {approvedValue.trim() !== '' ? (
                          <StatusChip tone="success">на сайте</StatusChip>
                        ) : (
                          <StatusChip tone="warning">approved пуст — сайт на fallback</StatusChip>
                        )}
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 flex items-center justify-between text-xs text-[var(--adm-text-3)]">
                            <span>Черновик</span>
                            <span className="tabular-nums">{draftValue.length}</span>
                          </span>
                          <textarea
                            value={draftValue}
                            onChange={(e) => updateDraft(draftKey as string, e.target.value)}
                            rows={pair.rows}
                            className={adminInputClass}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 flex items-center justify-between text-xs text-[var(--adm-text-3)]">
                            <span>Утверждено (рендерится на сайте)</span>
                            <span className="tabular-nums">{approvedValue.length}</span>
                          </span>
                          <textarea
                            value={approvedValue}
                            onChange={(e) => updateDraft(approvedKey as string, e.target.value)}
                            rows={pair.rows}
                            className={adminInputClass}
                          />
                        </label>
                      </div>
                      <button
                        onClick={() => approvePair(pair)}
                        disabled={saving || draftValue.trim() === ''}
                        className={cn(adminSecondaryButtonClass, 'mt-3')}
                        title="Скопировать черновик в утверждённое и сохранить"
                      >
                        Утвердить черновик
                        <ArrowRight className="size-3.5" />
                      </button>
                    </section>
                  )
                })}
              </div>

              {/* FAQ (GEO): пары вопрос-ответ, рендерятся на странице маршрута с FAQPage-схемой */}
              <section className="mt-6 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-inset)] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium text-[var(--adm-text)]">FAQ маршрута</h3>
                    <p className="text-xs text-[var(--adm-text-3)]">5–8 реальных вопросов клиентов; появятся на странице маршрута с разметкой для поисковиков и AI</p>
                  </div>
                  {parseFaqPairs(draft.faq).length > 0 ? (
                    <StatusChip tone="success">{parseFaqPairs(draft.faq).length} вопр. на сайте</StatusChip>
                  ) : (
                    <StatusChip tone="neutral">не заполнен</StatusChip>
                  )}
                </div>
                <div className="space-y-3">
                  {parseFaqPairs(draft.faq).map((pair, index, all) => (
                    <div key={index} className="rounded-lg border border-[var(--adm-border)] p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs text-[var(--adm-text-3)]">Вопрос {index + 1}</span>
                        <button
                          onClick={() => {
                            const next = all.filter((_, i) => i !== index)
                            updateDraft('faq', serializeFaqPairs(next))
                          }}
                          className="text-xs text-[var(--adm-danger-text)] hover:underline"
                        >
                          Удалить
                        </button>
                      </div>
                      <input
                        type="text"
                        value={pair.q}
                        onChange={(e) => {
                          const next = all.map((p, i) => (i === index ? { ...p, q: e.target.value } : p))
                          updateDraft('faq', serializeFaqPairs(next))
                        }}
                        placeholder="Вопрос — как его задал бы клиент"
                        className={cn(adminInputClass, 'mb-2')}
                      />
                      <textarea
                        value={pair.a}
                        onChange={(e) => {
                          const next = all.map((p, i) => (i === index ? { ...p, a: e.target.value } : p))
                          updateDraft('faq', serializeFaqPairs(next))
                        }}
                        placeholder="Ответ — коротко и с конкретикой (время, сезон, цены)"
                        rows={3}
                        className={adminInputClass}
                      />
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const next = [...parseFaqPairs(draft.faq), { q: '', a: ' ' }]
                      updateDraft('faq', JSON.stringify(next))
                    }}
                    className={adminSecondaryButtonClass}
                  >
                    + Добавить вопрос
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </AdminShell>
  )
}
