'use client'

/**
 * Профиль туриста (паспорт группы) — сквозная «шторка».
 *
 * Используется в двух местах:
 *   1) /admin/clients/[id] — карточка клиента;
 *   2) /admin/multi-day?client=… — билдер маршрута, когда собираешь
 *      программу для конкретного клиента и нужно сверяться с составом
 *      группы/пожеланиями, не уходя со страницы.
 *
 * Оба места закрепляют панель наверху скролл-контейнера (`sticky top-0`) и
 * дают аккордеон на полный разбор анкеты — сводная строка «даты · состав»
 * остаётся видна и в свёрнутом виде, поэтому то, что обычно уточняют на
 * лету, всегда под рукой.
 */

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

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
import { Dash, Panel, ProfileField, StatusChip, adminSecondaryButtonClass, formatDateTime } from './ui'
import { cn } from '@/lib/utils'

// Состав группы в одну строку — общий источник и для компактной сводки
// (видна даже в свёрнутом виде), и для развёрнутой карточки.
function buildPartyLine(payload: TouristProfilePayload, groupFinalNote: boolean): string {
  const p = payload
  return [
    `${p.group.adults} взр.`,
    p.group.children.length > 0
      ? `${p.group.children.length} дет. (${p.group.children.map((c) => c.age).join(', ')} лет)`
      : null,
    groupFinalNote ? null : 'состав может измениться',
  ]
    .filter(Boolean)
    .join(' · ')
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

  const party = buildPartyLine(p, groupFinalNote)

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
      <ProfileField label="Состав">{party}</ProfileField>

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

export function TouristProfilePanel({
  profile,
  factFindUrl,
  factFindCompletedAt,
  defaultExpanded = true,
  className,
}: {
  profile: TouristProfilePayload | null
  factFindUrl?: string | null
  factFindCompletedAt?: string | null
  defaultExpanded?: boolean
  className?: string
}) {
  // Два независимых источника «открыто»: pinned — закреплено кнопкой (как
  // было раньше), hovering — временный разворот от наведения курсора, без
  // клика («шторка» — при уходе курсора сворачивается обратно, если не
  // закреплена). Разворот всегда сдвигает контент под собой вниз (обычный
  // поток документа), никакого overlay поверх страницы.
  const [pinned, setPinned] = useState(defaultExpanded)
  const [hovering, setHovering] = useState(false)
  const expanded = pinned || hovering
  const partySummary = profile ? buildPartyLine(profile, profile.group.final) : null

  return (
    <Panel
      className={cn('sticky top-0 z-20 shadow-[0_8px_24px_rgba(0,0,0,0.35)]', className)}
      title="Профиль туриста"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
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
          {profile && (
            <button
              type="button"
              onClick={() => setPinned((v) => !v)}
              aria-expanded={expanded}
              title={pinned ? 'Открепить — свернётся, когда уведёте курсор' : 'Закрепить открытым'}
              className={cn(adminSecondaryButtonClass, 'gap-1.5')}
            >
              {pinned ? 'Открепить' : 'Закрепить'}
              <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
            </button>
          )}
        </div>
      }
    >
      {profile && (
        <p className="mb-3 text-sm text-[var(--adm-text-2)]">
          {formatProfileDates(profile)} <span className="text-[var(--adm-text-3)]">·</span> {partySummary}
        </p>
      )}
      {profile ? (
        expanded && <TouristProfileView payload={profile} groupFinalNote={profile.group.final} />
      ) : (
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-sm text-[var(--adm-text-3)]">
            Опросник не заполнен. Отправьте клиенту персональную ссылку — ответы появятся здесь и лягут в основу
            маршрута.
          </p>
          {factFindUrl && <CopyButton text={factFindUrl} label="Скопировать ссылку" copiedLabel="Скопировано ✓" />}
        </div>
      )}
      {profile && expanded && factFindCompletedAt && (
        <p className="mt-4 text-xs text-[var(--adm-text-3)]">Анкета заполнена {formatDateTime(factFindCompletedAt)}</p>
      )}
    </Panel>
  )
}
