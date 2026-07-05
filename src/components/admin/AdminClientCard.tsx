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
import {
  ART_HUNTING_TYPE_LABELS,
  CONTACT_CHANNEL_LABELS,
  FIRST_TRIP_PREFERENCE_LABELS,
  GUIDE_FORMAT_LABELS,
  HOTEL_BOOKING_LABELS,
  INTEREST_DEPTH_LABELS,
  INTEREST_LABELS,
  MOBILITY_FLAG_LABELS,
  NEW_TYPE_LABELS,
  PROFILE_PACE_LABELS,
  REPEAT_MODE_LABELS,
  formatProfileDates,
  type TouristProfilePayload,
} from '@/lib/tourist-profile'
import {
  EmptyNote,
  Panel,
  StatusChip,
  adminInputClass,
  adminInsetClass,
  adminPrimaryButtonClass,
  adminSecondaryButtonClass,
} from './ui'
import { cn } from '@/lib/utils'

// ─── Помощники ────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function patchProspect(recordId: string, body: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch(`/api/admin/clients/${recordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return response.ok
  } catch {
    return false
  }
}

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={adminSecondaryButtonClass}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          window.prompt('Скопируйте ссылку вручную:', text)
        }
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}

// ─── Профиль туриста (паспорт группы) ────────────────────────────────────────

function ProfileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--adm-text-3)]">{label}</span>
      <span className="text-sm leading-relaxed text-[var(--adm-text)]">{children}</span>
    </div>
  )
}

function Dash() {
  return <span className="text-[var(--adm-text-3)]">—</span>
}

function TouristProfileView({ payload, groupFinalNote }: { payload: TouristProfilePayload; groupFinalNote: boolean }) {
  const p = payload

  const experience: string[] = []
  if (p.first_trip) {
    experience.push('Первая поездка в Японию')
    if (p.first_trip_preference) experience.push(FIRST_TRIP_PREFERENCE_LABELS[p.first_trip_preference])
  } else {
    experience.push('Уже были в Японии')
    if (p.regions_visited_text) experience.push(`Были: ${p.regions_visited_text}`)
    if (p.repeat_mode) experience.push(REPEAT_MODE_LABELS[p.repeat_mode])
    if (p.new_type) experience.push(NEW_TYPE_LABELS[p.new_type])
    if (p.new_ideas_note) experience.push(`«${p.new_ideas_note}»`)
  }

  const party = [
    `${p.group.adults} взр.`,
    p.group.children.length > 0
      ? `${p.group.children.length} дет. (${p.group.children.map((c) => c.age).join(', ')} лет)`
      : null,
    groupFinalNote ? null : 'состав может измениться',
  ].filter(Boolean)

  const mobility =
    p.mobility.length === 0 ? null : p.mobility.map((flag) => MOBILITY_FLAG_LABELS[flag]).join(' · ')

  const interestChips = p.interests
    .filter((i) => i !== 'none')
    .map((i) => {
      // Под-ветки v3: уточнения прямо в чипе.
      if (i === 'art_hunting' && p.art_hunting_type) {
        return `${INTEREST_LABELS[i]}: ${ART_HUNTING_TYPE_LABELS[p.art_hunting_type]}`
      }
      if (i === 'active' && p.active_detail) {
        if (p.active_detail.custom) return `${INTEREST_LABELS[i]}: ${p.active_detail.custom}`
        if (p.active_detail.ask_recommend) return `${INTEREST_LABELS[i]}: предложить варианты`
      }
      return INTEREST_LABELS[i]
    })
  if (p.interests_custom) interestChips.push(p.interests_custom)

  const hotelBudget = `$${p.hotel_budget_usd.min}–${p.hotel_budget_usd.max >= 800 ? '800+' : p.hotel_budget_usd.max} за ночь`

  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <ProfileField label="Даты">{formatProfileDates(p)}</ProfileField>
      <ProfileField label="Состав">{party.join(' · ')}</ProfileField>

      <div className="sm:col-span-2">
        <ProfileField label="Опыт">
          {experience.map((line, i) => (
            <span key={i} className={cn('block', i > 0 && 'text-[var(--adm-text-2)]')}>
              {line}
            </span>
          ))}
        </ProfileField>
      </div>

      <div className="sm:col-span-2 flex flex-col gap-1.5">
        <span className="text-xs text-[var(--adm-text-3)]">Интересы</span>
        {interestChips.length === 0 ? (
          <span className="text-sm text-[var(--adm-text-3)]">Ничего специального</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {interestChips.map((chip) => (
              <StatusChip key={chip} tone="info">
                {chip}
              </StatusChip>
            ))}
            {p.interests_depth && (
              <span className="text-xs text-[var(--adm-text-3)]">{INTEREST_DEPTH_LABELS[p.interests_depth]}</span>
            )}
          </div>
        )}
      </div>

      <ProfileField label="Ритм">{PROFILE_PACE_LABELS[p.pace]}</ProfileField>
      <ProfileField label="Мобильность">{mobility ?? <Dash />}</ProfileField>

      <ProfileField label="Отели">
        <span className="block">{hotelBudget}</span>
        {p.ryokan_night && <span className="block text-[var(--adm-text-2)]">Хотя бы одна ночь в рёкане с онсэном</span>}
      </ProfileField>
      <ProfileField label="Бронирование">{HOTEL_BOOKING_LABELS[p.hotel_booking]}</ProfileField>

      <ProfileField label="Сопровождение">{GUIDE_FORMAT_LABELS[p.guide_format]}</ProfileField>
      <ProfileField label="Контакт из анкеты">
        {CONTACT_CHANNEL_LABELS[p.contact.channel]}: {p.contact.value}
      </ProfileField>

      {p.notes && (
        <div className="sm:col-span-2">
          <ProfileField label="Пожелания">{p.notes}</ProfileField>
        </div>
      )}
    </div>
  )
}

// ─── Основной компонент ──────────────────────────────────────────────────────

export function AdminClientCard({
  prospect,
  factFindUrl,
}: {
  prospect: ProspectDetail
  factFindUrl: string | null
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
    const ok = await patchProspect(prospect.recordId, body)
    if (!ok) setSaveError(errorLabel)
    else refresh()
    return ok
  }

  const profile = prospect.factFindAnswers

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* ── 1. Профиль туриста ── */}
      <Panel
        title="Профиль туриста"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {factFindUrl && (
              <CopyButton text={factFindUrl} label="Скопировать ссылку на анкету" copiedLabel="Скопировано ✓" />
            )}
            {profile && factFindUrl && (
              <a href={factFindUrl} target="_blank" rel="noreferrer" className={adminSecondaryButtonClass}>
                Изменить ответы
              </a>
            )}
          </div>
        }
      >
        {profile ? (
          <TouristProfileView payload={profile} groupFinalNote={profile.group.final} />
        ) : (
          <div className="flex flex-col items-start gap-3 py-4">
            <p className="text-sm text-[var(--adm-text-3)]">
              Опросник не заполнен. Отправьте клиенту персональную ссылку — ответы появятся здесь и лягут в
              основу маршрута.
            </p>
            {factFindUrl && (
              <CopyButton text={factFindUrl} label="Скопировать ссылку" copiedLabel="Скопировано ✓" />
            )}
          </div>
        )}
        {prospect.factFindCompletedAt && (
          <p className="mt-4 text-xs text-[var(--adm-text-3)]">
            Анкета заполнена {formatDateTime(prospect.factFindCompletedAt)}
          </p>
        )}
      </Panel>

      {/* ── 2. Сборка программы ──
          Единственный инструмент монтирования туров — Multi-Day Builder.
          Workshop не дублирует его, а открывает с клиентским контекстом:
          ?client= привязывает сохранённый маршрут к карточке автоматически,
          ?route= открывает уже привязанный маршрут на редактирование. */}
      <Panel
        title="Маршруты клиента"
        actions={
          <Link href={`/admin/multi-day?client=${prospect.recordId}`} className={adminPrimaryButtonClass}>
            Создать маршрут
          </Link>
        }
      >
        <div className="flex flex-col gap-2">
          {prospect.linkedRoutes.length === 0 ? (
            <EmptyNote>
              Маршрутов пока нет. «Создать маршрут» откроет билдер — сохранённый там маршрут привяжется к
              этой карточке сам.
            </EmptyNote>
          ) : (
            prospect.linkedRoutes.map((slug) => (
              <div key={slug} className={cn(adminInsetClass, 'flex items-center justify-between gap-3 px-3 py-2')}>
                <span className="truncate text-sm text-[var(--adm-text)]">{slug}</span>
                <Link
                  href={`/admin/multi-day?client=${prospect.recordId}&route=${encodeURIComponent(slug.replace(/^multi-day\//, ''))}`}
                  className="shrink-0 text-xs text-[var(--adm-accent-text)] hover:text-[var(--adm-accent-text)] transition"
                >
                  открыть в билдере
                </Link>
              </div>
            ))
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
              placeholder="Привязать slug маршрута, например golden-route-7-days"
              className={adminInputClass}
            />
            <button type="submit" disabled={slugSaving || slugDraft.trim() === ''} className={adminSecondaryButtonClass}>
              {slugSaving ? 'Сохраняю…' : 'Привязать'}
            </button>
          </form>
        </div>
      </Panel>

      {/* ── 3. Коммуникация и воронка ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Воронка">
          <div className="flex flex-col gap-4">
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

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--adm-text-3)]">Таймлайн</span>
              <div className={cn(adminInsetClass, 'flex flex-col gap-1.5 px-3 py-2.5 text-sm')}>
                <div className="flex justify-between gap-3">
                  <span className="text-[var(--adm-text-3)]">Заявка получена</span>
                  <span className="text-[var(--adm-text-2)]">{formatDateTime(prospect.createdAt)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[var(--adm-text-3)]">Анкета заполнена</span>
                  <span className="text-[var(--adm-text-2)]">{formatDateTime(prospect.factFindCompletedAt)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[var(--adm-text-3)]">Стадия менялась</span>
                  <span className="text-[var(--adm-text-2)]">{formatDateTime(prospect.stageUpdatedAt)}</span>
                </div>
                {prospect.convertedAt && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--adm-text-3)]">Конвертирован</span>
                    <span className="text-[var(--adm-text-2)]">{formatDateTime(prospect.convertedAt)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Контакт и заметки">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <ProfileField label="Имя">{prospect.name || <Dash />}</ProfileField>
              <ProfileField label="Контакт">{prospect.contact || <Dash />}</ProfileField>
              <ProfileField label="Источник">
                {prospect.source ? (SOURCE_LABELS[prospect.source] ?? prospect.source) : <Dash />}
              </ProfileField>
              <ProfileField label="Prospect ID">
                <span className="font-mono text-xs text-[var(--adm-text-3)]">{prospect.prospectId || prospect.recordId}</span>
              </ProfileField>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--adm-text-3)]">Заметки</span>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={5}
                placeholder="Внутренние заметки по клиенту…"
                className={adminInputClass}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={notesSaving || notesDraft === (prospect.notes ?? '')}
                  onClick={async () => {
                    setNotesSaving(true)
                    await update({ notes: notesDraft }, 'Не удалось сохранить заметки')
                    setNotesSaving(false)
                  }}
                  className={adminPrimaryButtonClass}
                >
                  {notesSaving ? 'Сохраняю…' : 'Сохранить заметки'}
                </button>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* ── 4. Комментарии (лог общения и решений, новые сверху) ── */}
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
