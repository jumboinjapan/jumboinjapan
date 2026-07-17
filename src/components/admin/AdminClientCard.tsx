'use client'

/**
 * Карточка клиента /admin/clients/[id].
 *
 * Структура сверху вниз — требование владельца (Задание 12):
 *   1) «Профиль туриста» — компактный рендер JSON-ответов опросника;
 *   2) сборка программы (Linked Routes + «Создать маршрут»);
 *   3) коммуникация и воронка (Stage, таймлайн, заметки).
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import {
  PROSPECT_STAGES,
  PROSPECT_TOUR_TYPES,
  STAGE_LABELS,
  SOURCE_LABELS,
  TOUR_TYPE_LABELS,
} from '@/lib/prospect-labels'
import type { ProspectComment, ProspectDetail } from '@/lib/prospects'
import { TouristProfilePanel } from './TouristProfilePanel'
import { EmptyNote, Panel, ProfileField, Dash, adminInputClass, adminInsetClass, adminPrimaryButtonClass, adminSecondaryButtonClass, formatDateTime } from './ui'
import { cn } from '@/lib/utils'

// ─── Помощники ────────────────────────────────────────────────────────────────

async function patchProspect(
  recordId: string,
  body: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/admin/clients/${recordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return { ok: true }
    const data = (await response.json().catch(() => null)) as { error?: string } | null
    return { ok: false, error: data?.error }
  } catch {
    return { ok: false }
  }
}

/** Сводка привязанного маршрута из конструктора (для рендера вместо голого slug). */
export interface LinkedRouteSummary {
  title: string
  status: string
  dayCount: number
}

// ─── Основной компонент ──────────────────────────────────────────────────────

export function AdminClientCard({
  prospect,
  factFindUrl,
  routeSummaries = {},
}: {
  prospect: ProspectDetail
  factFindUrl: string | null
  /** slug → сводка из конструктора; отсутствие ключа = маршрут в Routes не найден. */
  routeSummaries?: Record<string, LinkedRouteSummary>
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)

  const [notesDraft, setNotesDraft] = useState(prospect.notes ?? '')
  const [notesSaving, setNotesSaving] = useState(false)
  const [slugDraft, setSlugDraft] = useState('')
  const [slugSaving, setSlugSaving] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)

  const refresh = () => startTransition(() => router.refresh())

  async function update(body: Record<string, string>, errorLabel: string) {
    setSaveError(null)
    const result = await patchProspect(prospect.recordId, body)
    // Сервер может вернуть человекочитаемую причину (например, «маршрут не
    // найден» при ручной привязке) — она информативнее общего лейбла.
    if (!result.ok) setSaveError(result.error && /[а-яА-ЯёЁ ]/.test(result.error) ? result.error : errorLabel)
    else refresh()
    return result.ok
  }

  const profile = prospect.factFindAnswers
  // Профиль туриста — сквозная «шторка»: закреплён наверху скролла карточки
  // клиента, чтобы состав группы и даты были под рукой, пока листаешь
  // маршруты/воронку/комментарии ниже. Компонент сам сворачивает полный
  // разбор анкеты в аккордеон — сводная строка (даты · состав) видна и в
  // свёрнутом виде. Тот же компонент используется в билдере маршрута
  // (MultiDayBuilderWorkspace), когда билдер открыт с клиентским контекстом.

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* ── Раскладка 3a: профиль-анкета ядром слева, сжатая колонка справа ── */}
      <div className="grid items-start gap-4 lg:grid-cols-[1.85fr_1fr]">
        {/* Профиль туриста — ядро карточки (card-вариант панели). */}
        <TouristProfilePanel
          card
          className="static shadow-none"
          profile={profile}
          factFindUrl={factFindUrl}
          factFindCompletedAt={prospect.factFindCompletedAt}
        />

        {/* Правая колонка: маршрут · воронка · контакт. «Создать маршрут» — в шапке страницы. */}
        <div className="flex flex-col gap-4">
          <Panel title="Маршрут клиента">
            <div className="flex flex-col gap-2">
              {prospect.linkedRoutes.length === 0 ? (
                <EmptyNote>
                  Маршрутов пока нет. «Создать маршрут» вверху откроет билдер — сохранённый там маршрут
                  привяжется к этой карточке сам.
                </EmptyNote>
              ) : (
                prospect.linkedRoutes.map((slug) => {
                  const summary = routeSummaries[slug]
                  return (
                    <div key={slug} className={cn(adminInsetClass, 'flex items-center justify-between gap-3 px-3 py-2')}>
                      <div className="min-w-0 flex-1">
                        {summary ? (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-[var(--adm-text)]">{summary.title || slug}</span>
                              {summary.status === 'Published' && (
                                <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">
                                  на сайте
                                </span>
                              )}
                            </div>
                            <div className="truncate text-xs text-[var(--adm-text-3)]">
                              {summary.dayCount > 0 ? `${summary.dayCount} дн. · ` : ''}{slug}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="truncate text-sm text-[var(--adm-text)]">{slug}</div>
                            {/* Сводки есть только у multi-day: для них отсутствие = маршрут удалён/переименован. */}
                            {slug.startsWith('multi-day/') && (
                              <div className="text-xs text-[var(--adm-warning-text,var(--adm-text-3))]">
                                не найден в конструкторе — маршрут удалён или переименован
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {slug.startsWith('multi-day/') && (
                          <Link
                            href={`/admin/multi-day?client=${prospect.recordId}&route=${encodeURIComponent(slug)}`}
                            className="text-xs font-medium text-[var(--adm-accent-text)] transition hover:text-[var(--adm-accent-text)]"
                          >
                            открыть в билдере →
                          </Link>
                        )}
                        <button
                          type="button"
                          title="Отвязать маршрут от клиента (сам маршрут не удаляется)"
                          onClick={async () => {
                            if (!window.confirm(`Отвязать «${summary?.title || slug}» от этой карточки? Маршрут в конструкторе останется.`)) return
                            await update({ removeLinkedRoute: slug }, 'Не удалось отвязать маршрут')
                          }}
                          className="text-xs text-[var(--adm-text-3)] transition hover:text-[var(--adm-danger-text)]"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )
                })
              )}

              {/* Ручная привязка — для маршрутов, собранных вне клиентского контекста. */}
              <form
                className="mt-1 flex items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const slug = slugDraft.trim()
                  if (!slug) return
                  setSlugSaving(true)
                  const ok = await update({ appendLinkedRoute: slug }, 'Не удалось привязать маршрут')
                  if (ok) setSlugDraft('')
                  setSlugSaving(false)
                }}
              >
                <input
                  type="text"
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(e.target.value)}
                  placeholder="Привязать slug маршрута (multi-day/…)"
                  className={adminInputClass}
                />
                <button type="submit" disabled={slugSaving || slugDraft.trim() === ''} className={adminSecondaryButtonClass}>
                  {slugSaving ? 'Сохраняю…' : 'Привязать'}
                </button>
              </form>
            </div>
          </Panel>

          <Panel title="Воронка">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs text-[var(--adm-text-3)]">Стадия</span>
                  <select
                    value={prospect.stage || ''}
                    onChange={(e) => update({ stage: e.target.value }, 'Не удалось сменить стадию')}
                    className={adminInputClass}
                  >
                    {!prospect.stage && <option value="">не указана</option>}
                    {PROSPECT_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {STAGE_LABELS[stage]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs text-[var(--adm-text-3)]">Тип тура</span>
                  <select
                    value={prospect.tourType || ''}
                    onChange={(e) => update({ tourType: e.target.value }, 'Не удалось сменить тип тура')}
                    className={adminInputClass}
                  >
                    {!prospect.tourType && <option value="">не указан</option>}
                    {PROSPECT_TOUR_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {TOUR_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-col text-[13px]">
                {[
                  { label: 'Заявка получена', value: formatDateTime(prospect.createdAt) },
                  { label: 'Анкета заполнена', value: formatDateTime(prospect.factFindCompletedAt) },
                  { label: 'Стадия менялась', value: formatDateTime(prospect.stageUpdatedAt) },
                  ...(prospect.convertedAt ? [{ label: 'Конвертирован', value: formatDateTime(prospect.convertedAt) }] : []),
                ].map((row) => (
                  <div key={row.label} className="flex justify-between gap-3 border-b border-[var(--adm-border)] py-1.5 last:border-0">
                    <span className="text-[var(--adm-text-3)]">{row.label}</span>
                    <span className="font-medium text-[var(--adm-text-2)]">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel
            title="Контакт и заметки"
            actions={
              <button
                type="button"
                disabled={notesSaving || notesDraft === (prospect.notes ?? '')}
                onClick={async () => {
                  setNotesSaving(true)
                  await update({ notes: notesDraft }, 'Не удалось сохранить заметки')
                  setNotesSaving(false)
                }}
                className={adminSecondaryButtonClass}
              >
                {notesSaving ? 'Сохраняю…' : 'Сохранить'}
              </button>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <ProfileField label="Контакт">{prospect.contact || <Dash />}</ProfileField>
                <ProfileField label="Источник">
                  {prospect.source ? (SOURCE_LABELS[prospect.source] ?? prospect.source) : <Dash />}
                </ProfileField>
              </div>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={4}
                placeholder="Внутренние заметки по клиенту…"
                className={adminInputClass}
              />
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Комментарии лентой (лог общения и решений, новые сверху) ── */}
      <Panel title={`Комментарии${prospect.comments.length > 0 ? ` — ${prospect.comments.length}` : ''}`}>
        <form
          className="flex items-start gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const text = commentDraft.trim()
            if (!text) return
            setCommentSaving(true)
            const ok = await update({ addComment: text }, 'Не удалось сохранить комментарий')
            if (ok) setCommentDraft('')
            setCommentSaving(false)
          }}
        >
          <textarea
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            rows={2}
            placeholder="Что обсудили, о чём договорились, что дальше…"
            className={adminInputClass}
          />
          <button
            type="submit"
            disabled={commentSaving || commentDraft.trim() === ''}
            className={cn(adminPrimaryButtonClass, 'shrink-0')}
          >
            {commentSaving ? 'Сохраняю…' : 'Добавить'}
          </button>
        </form>

        {prospect.comments.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {[...prospect.comments].reverse().map((comment: ProspectComment, i) => (
              <div key={`${comment.at}-${i}`} className={cn(adminInsetClass, 'px-3 py-2.5')}>
                <div className="text-xs text-[var(--adm-text-3)]">
                  {new Date(comment.at).toLocaleString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--adm-text-2)]">{comment.text}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {saveError && <p className="text-sm text-[var(--adm-danger-text)]">{saveError}</p>}
    </div>
  )
}
