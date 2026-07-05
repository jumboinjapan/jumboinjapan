'use client'

/**
 * Опросник «Профиль туриста» — мультишаговый wizard, мобильный прежде всего.
 *
 * Канон содержания: docs/tourist-profile-questionnaire-spec.md — тексты
 * вопросов и пояснений владельца дословно, ветвление 8–10 экранов,
 * один вопрос — один экран. Черновик — localStorage (v1).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  ContactChannel,
  FirstTripRoute,
  GuideFormat,
  GuideMode,
  HotelBooking,
  InterestKey,
  InterestsDepth,
  MobilityFlag,
  NewType,
  ProfilePace,
  RepeatMode,
  TouristProfilePayload,
  DatesPrecision,
} from '@/lib/tourist-profile'

// ─── Состояние формы ─────────────────────────────────────────────────────────

interface FormState {
  datesPrecision: DatesPrecision | null
  dateStart: string
  dateEnd: string
  month: string
  firstTrip: boolean | null
  firstTripRoute: FirstTripRoute | null
  firstTripRouteNote: string
  regionsVisitedText: string
  repeatMode: RepeatMode | null
  newType: NewType | null
  newIdeasNote: string
  adults: number
  childrenAges: number[]
  groupFinal: boolean
  mobility: MobilityFlag[]
  interests: InterestKey[]
  interestsCustom: string
  interestsDepth: InterestsDepth | null
  pace: ProfilePace | null
  budgetMin: number
  budgetMax: number
  ryokanNight: boolean
  hotelUndecided: boolean
  hotelBooking: HotelBooking | null
  guideFormat: GuideFormat | null
  guideMode: GuideMode | null
  notes: string
  contactName: string
  contactChannel: ContactChannel | null
  contactValue: string
}

const EMPTY_STATE: FormState = {
  datesPrecision: null,
  dateStart: '',
  dateEnd: '',
  month: '',
  firstTrip: null,
  firstTripRoute: null,
  firstTripRouteNote: '',
  regionsVisitedText: '',
  repeatMode: null,
  newType: null,
  newIdeasNote: '',
  adults: 2,
  childrenAges: [],
  groupFinal: true,
  mobility: [],
  interests: [],
  interestsCustom: '',
  interestsDepth: null,
  pace: null,
  budgetMin: 120,
  budgetMax: 300,
  ryokanNight: false,
  hotelUndecided: false,
  hotelBooking: null,
  guideFormat: null,
  guideMode: null,
  notes: '',
  contactName: '',
  contactChannel: null,
  contactValue: '',
}

function stateFromPayload(p: TouristProfilePayload): FormState {
  return {
    datesPrecision: p.dates.precision,
    dateStart: p.dates.start ?? '',
    dateEnd: p.dates.end ?? '',
    month: p.dates.month ?? '',
    firstTrip: p.first_trip,
    firstTripRoute: p.first_trip_route,
    firstTripRouteNote: p.first_trip_route_note ?? '',
    regionsVisitedText: p.regions_visited_text ?? '',
    repeatMode: p.repeat_mode,
    newType: p.new_type,
    newIdeasNote: p.new_ideas_note ?? '',
    adults: p.group.adults,
    childrenAges: p.group.children.map((c) => c.age),
    groupFinal: p.group.final,
    mobility: p.mobility,
    interests: p.interests,
    interestsCustom: p.interests_custom ?? '',
    interestsDepth: p.interests_depth,
    pace: p.pace,
    budgetMin: p.hotel_budget_usd.min,
    budgetMax: p.hotel_budget_usd.max,
    ryokanNight: p.ryokan_night,
    hotelUndecided: p.hotel_undecided,
    hotelBooking: p.hotel_booking,
    guideFormat: p.guide_format,
    guideMode: p.guide_mode,
    notes: p.notes,
    contactName: p.contact.name,
    contactChannel: p.contact.channel,
    contactValue: p.contact.value,
  }
}

function payloadFromState(s: FormState): TouristProfilePayload {
  return {
    dates: {
      start: s.datesPrecision === 'month_only' ? null : s.dateStart || null,
      end: s.datesPrecision === 'month_only' ? null : s.dateEnd || null,
      precision: s.datesPrecision ?? 'flexible',
      month: s.datesPrecision === 'month_only' ? s.month || null : null,
    },
    first_trip: s.firstTrip === true,
    first_trip_route: s.firstTrip ? s.firstTripRoute : null,
    first_trip_route_note: s.firstTrip ? s.firstTripRouteNote.trim() || null : null,
    regions_visited_text: s.firstTrip === false ? s.regionsVisitedText.trim() || null : null,
    repeat_mode: s.firstTrip === false ? s.repeatMode : null,
    new_type: s.firstTrip === false ? s.newType : null,
    new_ideas_note: s.firstTrip === false ? s.newIdeasNote.trim() || null : null,
    group: {
      adults: s.adults,
      children: s.childrenAges.map((age) => ({ age })),
      final: s.groupFinal,
    },
    mobility: s.mobility,
    interests: s.interests,
    interests_custom: s.interestsCustom.trim() || null,
    interests_depth: hasRealInterest(s) ? s.interestsDepth : null,
    pace: s.pace ?? 'balanced',
    hotel_budget_usd: { min: s.budgetMin, max: s.budgetMax },
    ryokan_night: s.ryokanNight,
    hotel_undecided: s.hotelUndecided,
    hotel_booking: s.hotelBooking ?? 'recommend',
    guide_format: s.guideFormat ?? 'self',
    guide_mode: s.guideFormat === 'full' ? s.guideMode : null,
    notes: s.notes.trim(),
    contact: {
      name: s.contactName.trim(),
      channel: s.contactChannel ?? 'email',
      value: s.contactValue.trim(),
    },
  }
}

function hasRealInterest(s: FormState): boolean {
  return s.interests.some((i) => i !== 'none') || s.interestsCustom.trim() !== ''
}

// ─── Экраны и ветвление ──────────────────────────────────────────────────────

type StepId =
  | 'dates'
  | 'first_trip'
  | 'first_route'
  | 'regions_visited'
  | 'repeat_mode'
  | 'new_type'
  | 'group'
  | 'mobility'
  | 'interests'
  | 'pace'
  | 'hotel_budget'
  | 'hotel_booking'
  | 'guide_format'
  | 'guide_mode'
  | 'final'

function computeSteps(s: FormState): StepId[] {
  const steps: StepId[] = ['dates', 'first_trip']
  if (s.firstTrip === true) {
    steps.push('first_route')
  } else if (s.firstTrip === false) {
    steps.push('regions_visited', 'repeat_mode')
    if (s.repeatMode === 'only_new' || s.repeatMode === 'mix') steps.push('new_type')
  }
  steps.push('group', 'mobility', 'interests', 'pace', 'hotel_budget', 'hotel_booking', 'guide_format')
  if (s.guideFormat === 'full') steps.push('guide_mode')
  steps.push('final')
  return steps
}

function isStepComplete(step: StepId, s: FormState): boolean {
  switch (step) {
    case 'dates':
      if (!s.datesPrecision) return false
      if (s.datesPrecision === 'month_only') return s.month !== ''
      return s.dateStart !== ''
    case 'first_trip':
      return s.firstTrip !== null
    case 'first_route':
      return s.firstTripRoute !== null
    case 'regions_visited':
      return s.regionsVisitedText.trim() !== ''
    case 'repeat_mode':
      return s.repeatMode !== null
    case 'new_type':
      return s.newType !== null
    case 'group':
      return s.adults >= 1
    case 'mobility':
      return s.mobility.length > 0
    case 'interests':
      return s.interests.length > 0 || s.interestsCustom.trim() !== ''
    case 'pace':
      return s.pace !== null
    case 'hotel_budget':
      return true
    case 'hotel_booking':
      return s.hotelBooking !== null
    case 'guide_format':
      return s.guideFormat !== null
    case 'guide_mode':
      return s.guideMode !== null
    case 'final':
      return s.contactName.trim() !== '' && s.contactChannel !== null && s.contactValue.trim() !== ''
  }
}

// ─── Мелкие UI-примитивы (тёплая публичная тема сайта) ───────────────────────

const optionBase =
  'w-full rounded-lg border px-4 py-3 text-left text-[15px] leading-snug transition min-h-11'
const optionIdle = 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--text-muted)]'
const optionActive = 'border-[var(--accent)] bg-[var(--surface)] ring-1 ring-[var(--accent)]'

function OptionButton({
  selected,
  onClick,
  title,
  sub,
}: {
  selected: boolean
  onClick: () => void
  title: string
  sub?: string
}) {
  return (
    <button type="button" onClick={onClick} className={`${optionBase} ${selected ? optionActive : optionIdle}`}>
      <span className="block font-medium">{title}</span>
      {sub && <span className="mt-1 block text-[13px] font-light text-[var(--text-muted)]">{sub}</span>}
    </button>
  )
}

function Explainer({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-light leading-[1.7] text-[var(--text-muted)]">{children}</p>
}

function QuestionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-medium leading-snug tracking-[-0.01em] md:text-2xl">{children}</h2>
}

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-[15px] outline-none transition focus:border-[var(--accent)] min-h-11'

function Stepper({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  label: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <span className="text-[15px] font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex size-9 items-center justify-center rounded-full border border-[var(--border)] text-lg transition hover:border-[var(--text-muted)] disabled:opacity-40"
          disabled={value <= min}
          aria-label={`Уменьшить: ${label}`}
        >
          −
        </button>
        <span className="w-6 text-center text-[17px] font-medium tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="flex size-9 items-center justify-center rounded-full border border-[var(--border)] text-lg transition hover:border-[var(--text-muted)] disabled:opacity-40"
          disabled={value >= max}
          aria-label={`Увеличить: ${label}`}
        >
          +
        </button>
      </div>
    </div>
  )
}

const BUDGET_MIN = 80
const BUDGET_MAX = 800
const BUDGET_STEP = 20

function DualRange({
  min,
  max,
  onChange,
  disabled,
}: {
  min: number
  max: number
  onChange: (min: number, max: number) => void
  disabled: boolean
}) {
  const pct = (v: number) => ((v - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * 100
  return (
    <div className={disabled ? 'opacity-40' : ''}>
      <div className="mb-2 flex justify-between text-[15px] font-medium tabular-nums">
        <span>${min}</span>
        <span>{max >= BUDGET_MAX ? `$${BUDGET_MAX}+` : `$${max}`}</span>
      </div>
      <div className="relative h-10">
        <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-[var(--border)]" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--accent)]"
          style={{ left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }}
        />
        <input
          type="range"
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={BUDGET_STEP}
          value={min}
          disabled={disabled}
          onChange={(e) => onChange(Math.min(Number(e.target.value), max - BUDGET_STEP), max)}
          className="dual-range absolute top-0 h-10 w-full"
          aria-label="Минимальная стоимость отеля за ночь"
        />
        <input
          type="range"
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={BUDGET_STEP}
          value={max}
          disabled={disabled}
          onChange={(e) => onChange(min, Math.max(Number(e.target.value), min + BUDGET_STEP))}
          className="dual-range absolute top-0 h-10 w-full"
          aria-label="Максимальная стоимость отеля за ночь"
        />
      </div>
      <style jsx>{`
        .dual-range {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          pointer-events: none;
        }
        .dual-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          pointer-events: auto;
          width: 24px;
          height: 24px;
          border-radius: 9999px;
          background: #fdfaf7;
          border: 2px solid var(--accent);
          cursor: pointer;
        }
        .dual-range::-moz-range-thumb {
          pointer-events: auto;
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: #fdfaf7;
          border: 2px solid var(--accent);
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}

// ─── Справочники подписи ─────────────────────────────────────────────────────

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

const MOBILITY_OPTIONS: Array<{ key: MobilityFlag; label: string }> = [
  { key: 'kids_u6', label: 'Дети до 6 лет' },
  { key: 'seniors_70', label: 'Участники старше 70' },
  { key: 'limited_mobility', label: 'Ограниченная мобильность / сложно с лестницами' },
  { key: 'elevator_needed', label: 'Нужен лифт / минимальные пешие переходы' },
  { key: 'none', label: 'Нет, все готовы много ходить' },
]

const INTEREST_OPTIONS: Array<{ key: InterestKey; label: string }> = [
  { key: 'gastronomy', label: 'Гастрономия' },
  { key: 'hiking', label: 'Горные походы / хайкинг' },
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'photography', label: 'Фотография' },
  { key: 'art', label: 'Охота на искусство' },
  { key: 'crafts', label: 'Ремёсла' },
  { key: 'none', label: 'Ничего специального' },
]

// ─── Основной компонент ──────────────────────────────────────────────────────

export interface TouristProfileFormProps {
  /** Токен персональной ссылки; null — общий лендинг /profile. */
  token: string | null
  /** Source из ?src= для общего лендинга. */
  src?: string | null
  /** Уже сохранённые ответы (режим «изменить»). */
  initialPayload?: TouristProfilePayload | null
  /** Предзаполнение контакта из существующего prospect. */
  initialContact?: { name: string; contact: string } | null
}

type SubmitState = 'idle' | 'submitting' | 'done' | 'error'

export function TouristProfileForm({ token, src, initialPayload, initialContact }: TouristProfileFormProps) {
  const draftKey = `tourist-profile-draft:${token ?? 'public'}`
  const isEditMode = Boolean(initialPayload)

  const [state, setState] = useState<FormState>(() => {
    if (initialPayload) return stateFromPayload(initialPayload)
    const base = { ...EMPTY_STATE }
    if (initialContact) {
      base.contactName = initialContact.name
      const raw = initialContact.contact
      const channelMatch = raw.match(/^(telegram|whatsapp|email):\s*(.+)$/i)
      if (channelMatch) {
        base.contactChannel = channelMatch[1].toLowerCase() as ContactChannel
        base.contactValue = channelMatch[2]
      } else {
        base.contactValue = raw
        if (/@.+\./.test(raw)) base.contactChannel = 'email'
        else if (raw.startsWith('@') || raw.includes('t.me')) base.contactChannel = 'telegram'
      }
    }
    return base
  })
  const [stepIndex, setStepIndex] = useState(0)
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  // Год для режима «пока знаю только месяц» до выбора месяца.
  const [pendingYear, setPendingYear] = useState(() => String(new Date().getFullYear()))
  const [draftRestored, setDraftRestored] = useState(false)
  const restoredRef = useRef(false)

  // Восстановление черновика (только если нет сохранённых ответов).
  useEffect(() => {
    if (restoredRef.current || isEditMode) return
    restoredRef.current = true
    try {
      const raw = window.localStorage.getItem(draftKey)
      if (!raw) return
      const draft = JSON.parse(raw) as { state?: Partial<FormState>; stepIndex?: number }
      if (draft.state) {
        setState((prev) => ({ ...prev, ...draft.state }))
        if (typeof draft.stepIndex === 'number' && draft.stepIndex > 0) setStepIndex(draft.stepIndex)
        setDraftRestored(true)
      }
    } catch {
      // повреждённый черновик — просто начинаем заново
    }
  }, [draftKey, isEditMode])

  // Автосохранение черновика.
  useEffect(() => {
    if (!restoredRef.current && !isEditMode) return
    if (submitState === 'done') return
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ state, stepIndex }))
    } catch {
      // localStorage переполнен/недоступен — не мешаем заполнению
    }
  }, [state, stepIndex, draftKey, submitState, isEditMode])

  const steps = useMemo(() => computeSteps(state), [state])
  const safeIndex = Math.min(stepIndex, steps.length - 1)
  const step = steps[safeIndex]
  const canNext = isStepComplete(step, state)

  const patch = useCallback((partial: Partial<FormState>) => {
    setState((prev) => ({ ...prev, ...partial }))
  }, [])

  const goNext = () => {
    if (safeIndex < steps.length - 1) {
      setStepIndex(safeIndex + 1)
      window.scrollTo({ top: 0 })
    }
  }
  const goBack = () => {
    if (safeIndex > 0) {
      setStepIndex(safeIndex - 1)
      window.scrollTo({ top: 0 })
    }
  }

  async function handleSubmit() {
    setSubmitState('submitting')
    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, src: src ?? null, payload: payloadFromState(state) }),
      })
      const data = (await response.json().catch(() => null)) as { ok?: boolean } | null
      if (!response.ok || !data?.ok) throw new Error('submit failed')
      try {
        window.localStorage.removeItem(draftKey)
      } catch {
        // ignore
      }
      setSubmitState('done')
      window.scrollTo({ top: 0 })
    } catch {
      setSubmitState('error')
    }
  }

  // ── Финальный экран «спасибо» ──
  if (submitState === 'done') {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-lg flex-col justify-center gap-4 px-4 py-16">
        <h1 className="text-2xl font-medium tracking-[-0.01em]">Спасибо!</h1>
        <p className="text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
          Мы изучим ответы и вернёмся с наброском маршрута в течение двух дней. Это ни к чему вас не обязывает.
        </p>
      </div>
    )
  }

  const toggleMobility = (key: MobilityFlag) => {
    patch({
      mobility: state.mobility.includes(key)
        ? state.mobility.filter((k) => k !== key)
        : key === 'none'
          ? ['none']
          : [...state.mobility.filter((k) => k !== 'none'), key],
    })
  }

  const toggleInterest = (key: InterestKey) => {
    patch({
      interests: state.interests.includes(key)
        ? state.interests.filter((k) => k !== key)
        : key === 'none'
          ? ['none']
          : [...state.interests.filter((k) => k !== 'none'), key],
    })
  }

  const currentYear = new Date().getFullYear()

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-16 pt-8 md:pt-12">
      {/* Прогресс */}
      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between text-[13px] text-[var(--text-muted)]">
          <span>
            Вопрос {safeIndex + 1} из {steps.length}
          </span>
          {isEditMode && <span>изменение ответов</span>}
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${((safeIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {draftRestored && safeIndex > 0 && (
        <p className="mb-4 text-[13px] text-[var(--text-muted)]">Мы сохранили ваш черновик — продолжайте с того места, где остановились.</p>
      )}

      <div className="space-y-5">
        {/* ── Q1. Даты ── */}
        {step === 'dates' && (
          <>
            <QuestionTitle>Когда планируете поездку?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.datesPrecision === 'exact'}
                onClick={() => patch({ datesPrecision: 'exact' })}
                title="Даты точные"
              />
              <OptionButton
                selected={state.datesPrecision === 'flexible'}
                onClick={() => patch({ datesPrecision: 'flexible' })}
                title="Примерные, ±несколько дней"
              />
              <OptionButton
                selected={state.datesPrecision === 'month_only'}
                onClick={() => patch({ datesPrecision: 'month_only' })}
                title="Пока знаю только месяц"
              />
            </div>
            {(state.datesPrecision === 'exact' || state.datesPrecision === 'flexible') && (
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="block text-[13px] text-[var(--text-muted)]">Прилёт</span>
                  <input
                    type="date"
                    value={state.dateStart}
                    onChange={(e) => patch({ dateStart: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-[13px] text-[var(--text-muted)]">Вылет</span>
                  <input
                    type="date"
                    value={state.dateEnd}
                    min={state.dateStart || undefined}
                    onChange={(e) => patch({ dateEnd: e.target.value })}
                    className={inputClass}
                  />
                </label>
              </div>
            )}
            {state.datesPrecision === 'month_only' && (
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={state.month.split('-')[1] ?? ''}
                  onChange={(e) => {
                    const year = state.month.split('-')[0] || pendingYear
                    patch({ month: e.target.value ? `${year}-${e.target.value}` : '' })
                  }}
                  className={inputClass}
                  aria-label="Месяц"
                >
                  <option value="">Месяц</option>
                  {MONTHS_RU.map((label, i) => (
                    <option key={label} value={String(i + 1).padStart(2, '0')}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={state.month.split('-')[0] || pendingYear}
                  onChange={(e) => {
                    setPendingYear(e.target.value)
                    const mm = state.month.split('-')[1]
                    if (mm) patch({ month: `${e.target.value}-${mm}` })
                  }}
                  className={inputClass}
                  aria-label="Год"
                >
                  {[currentYear, currentYear + 1, currentYear + 2].map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Explainer>
              Цены отелей и доступность гидов в Японии сильно зависят от сезона — сакура, момидзи и праздники
              бронируются за полгода. Чем раньше знаем даты, тем лучше варианты.
            </Explainer>
          </>
        )}

        {/* ── Q2. Опыт ── */}
        {step === 'first_trip' && (
          <>
            <QuestionTitle>Вы уже бывали в Японии?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton selected={state.firstTrip === true} onClick={() => patch({ firstTrip: true, regionsVisitedText: '', repeatMode: null, newType: null, newIdeasNote: '' })} title="Нет, это первая поездка" />
              <OptionButton selected={state.firstTrip === false} onClick={() => patch({ firstTrip: false, firstTripRoute: null, firstTripRouteNote: '' })} title="Да" />
            </div>
          </>
        )}

        {/* ── Q3a. Первая поездка: Токио + Киото ── */}
        {step === 'first_route' && (
          <>
            <QuestionTitle>
              Регионы Токио и Киото — основной выбор для тех, кто приезжает в Японию в первый раз. Хотели бы
              что-то добавить или поменять?
            </QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.firstTripRoute === 'keep'}
                onClick={() => patch({ firstTripRoute: 'keep', firstTripRouteNote: '' })}
                title="Токио и Киото — то, что нужно"
              />
              <OptionButton
                selected={state.firstTripRoute === 'add'}
                onClick={() => patch({ firstTripRoute: 'add' })}
                title="Хотели бы что-то добавить"
                sub="Чаще всего добавляют Осаку и Нару, Канадзаву, Хаконэ/Фудзи или Хиросиму"
              />
              {state.firstTripRoute === 'add' && (
                <input
                  type="text"
                  value={state.firstTripRouteNote}
                  onChange={(e) => patch({ firstTripRouteNote: e.target.value })}
                  placeholder="Что именно? (необязательно)"
                  className={inputClass}
                />
              )}
              <OptionButton
                selected={state.firstTripRoute === 'change'}
                onClick={() => patch({ firstTripRoute: 'change' })}
                title="Хотели бы что-то поменять"
              />
              {state.firstTripRoute === 'change' && (
                <textarea
                  value={state.firstTripRouteNote}
                  onChange={(e) => patch({ firstTripRouteNote: e.target.value })}
                  placeholder="Расскажите, что вам ближе"
                  rows={3}
                  className={inputClass}
                />
              )}
              <OptionButton
                selected={state.firstTripRoute === 'recommend'}
                onClick={() => patch({ firstTripRoute: 'recommend', firstTripRouteNote: '' })}
                title="Не знаем — доверимся вашей рекомендации"
              />
            </div>
            <Explainer>
              Эти два региона покрывают главное и не превращают первую поездку в гонку. Добавлять имеет смысл,
              если у вас 12+ дней — подскажем по вашим датам.
            </Explainer>
          </>
        )}

        {/* ── Q3b. Где уже были ── */}
        {step === 'regions_visited' && (
          <>
            <QuestionTitle>Где вы уже были в Японии? Напишите своими словами.</QuestionTitle>
            <textarea
              value={state.regionsVisitedText}
              onChange={(e) => patch({ regionsVisitedText: e.target.value })}
              placeholder="Например: Токио, Киото, Осака, Хиросима, Сендай…"
              rows={4}
              className={inputClass}
            />
          </>
        )}

        {/* ── Q3c. Повторить или новое ── */}
        {step === 'repeat_mode' && (
          <>
            <QuestionTitle>Как поступим с местами, где вы уже были?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.repeatMode === 'only_new'}
                onClick={() => patch({ repeatMode: 'only_new' })}
                title="Хотим только новое"
              />
              <OptionButton
                selected={state.repeatMode === 'repeat_classic'}
                onClick={() => patch({ repeatMode: 'repeat_classic', newType: null, newIdeasNote: '' })}
                title="Были давно или едем в новом составе — готовы повторить классический маршрут"
              />
              <OptionButton
                selected={state.repeatMode === 'mix'}
                onClick={() => patch({ repeatMode: 'mix' })}
                title="Микс: знакомые города как базы, программа внутри — новая"
              />
            </div>
            <Explainer>
              Вернуться в Токио и Киото — не шаг назад: с детьми или друзьями это фактически новая поездка.
              А для тех, кто хочет только новое, Япония глубже, чем кажется.
            </Explainer>
          </>
        )}

        {/* ── Q3d. Какое новое ── */}
        {step === 'new_type' && (
          <>
            <QuestionTitle>Какого рода новое вам интересно?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.newType === 'known_new'}
                onClick={() => patch({ newType: 'known_new' })}
                title="Известная Япония, где мы ещё не были"
                sub="Канадзава, Хиросима, Хоккайдо, Кюсю…"
              />
              <OptionButton
                selected={state.newType === 'rare_exotic'}
                onClick={() => patch({ newType: 'rare_exotic' })}
                title="Редкие направления и экзотика"
              />
              <OptionButton
                selected={state.newType === 'both'}
                onClick={() => patch({ newType: 'both' })}
                title="И то и другое — соберите микс"
              />
            </div>
            <input
              type="text"
              value={state.newIdeasNote}
              onChange={(e) => patch({ newIdeasNote: e.target.value })}
              placeholder="Есть конкретные идеи? (необязательно)"
              className={inputClass}
            />
            <Explainer>
              Редкие направления — это другая логистика: меньше английского, реже транспорт, зато Япония без
              туристов. Честно предупредим о плюсах и минусах каждого варианта.
            </Explainer>
          </>
        )}

        {/* ── Q4. Состав группы ── */}
        {step === 'group' && (
          <>
            <QuestionTitle>Кто едет?</QuestionTitle>
            <div className="space-y-2">
              <Stepper value={state.adults} onChange={(v) => patch({ adults: v })} min={1} max={20} label="Взрослые" />
              <Stepper
                value={state.childrenAges.length}
                onChange={(v) => {
                  const next = [...state.childrenAges]
                  while (next.length < v) next.push(8)
                  patch({ childrenAges: next.slice(0, v) })
                }}
                min={0}
                max={10}
                label="Дети"
              />
              {state.childrenAges.length > 0 && (
                <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                  {state.childrenAges.map((age, i) => (
                    <label key={i} className="flex items-center justify-between gap-3">
                      <span className="text-[14px] text-[var(--text-muted)]">Возраст ребёнка {i + 1}</span>
                      <select
                        value={age}
                        onChange={(e) => {
                          const next = [...state.childrenAges]
                          next[i] = Number(e.target.value)
                          patch({ childrenAges: next })
                        }}
                        className="min-h-10 rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-[15px]"
                      >
                        {Array.from({ length: 18 }, (_, y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <OptionButton selected={state.groupFinal} onClick={() => patch({ groupFinal: true })} title="Состав окончательный" />
                <OptionButton selected={!state.groupFinal} onClick={() => patch({ groupFinal: false })} title="Может измениться" />
              </div>
            </div>
            <Explainer>
              От состава зависят номера в отелях (в Японии строгие лимиты по числу гостей в номере) и тип
              транспорта.
            </Explainer>
          </>
        )}

        {/* ── Q5. Мобильность ── */}
        {step === 'mobility' && (
          <>
            <QuestionTitle>Есть ли в группе участники, для которых важен щадящий темп?</QuestionTitle>
            <div className="space-y-2">
              {MOBILITY_OPTIONS.map(({ key, label }) => (
                <OptionButton key={key} selected={state.mobility.includes(key)} onClick={() => toggleMobility(key)} title={label} />
              ))}
            </div>
            <Explainer>
              В Японии много лестниц, переходов и станций без лифтов. Зная это заранее, мы строим маршрут так,
              чтобы никому не пришлось терпеть.
            </Explainer>
          </>
        )}

        {/* ── Q6. Специальные интересы ── */}
        {step === 'interests' && (
          <>
            <QuestionTitle>
              Есть ли темы, вокруг которых хочется построить часть поездки — или всю её целиком?
            </QuestionTitle>
            <div className="space-y-2">
              {INTEREST_OPTIONS.map(({ key, label }) => (
                <OptionButton key={key} selected={state.interests.includes(key)} onClick={() => toggleInterest(key)} title={label} />
              ))}
              <input
                type="text"
                value={state.interestsCustom}
                onChange={(e) => patch({ interestsCustom: e.target.value })}
                placeholder="Своя тема (необязательно)"
                className={inputClass}
              />
            </div>
            {hasRealInterest(state) && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <OptionButton
                  selected={state.interestsDepth === 'accent'}
                  onClick={() => patch({ interestsDepth: 'accent' })}
                  title="Акцент внутри обычной поездки"
                />
                <OptionButton
                  selected={state.interestsDepth === 'dedicated_tour'}
                  onClick={() => patch({ interestsDepth: 'dedicated_tour' })}
                  title="Специализированный тур вокруг темы"
                />
              </div>
            )}
            <Explainer>
              Один сильный интерес часто даёт лучший день всей поездки — ради него можно перестроить маршрут.
              Если таких тем нет, это тоже нормальный ответ.
            </Explainer>
          </>
        )}

        {/* ── Q7. Ритм ── */}
        {step === 'pace' && (
          <>
            <QuestionTitle>Какой ритм поездки вам ближе?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.pace === 'relaxed'}
                onClick={() => patch({ pace: 'relaxed' })}
                title="Спокойный"
                sub="Минимум переездов, 1–2 отеля, свободные вечера"
              />
              <OptionButton
                selected={state.pace === 'balanced'}
                onClick={() => patch({ pace: 'balanced' })}
                title="Сбалансированный"
                sub="2–3 базы, насыщенно, без спешки"
              />
              <OptionButton
                selected={state.pace === 'intense'}
                onClick={() => patch({ pace: 'intense' })}
                title="Интенсивный"
                sub="Максимум, ранние выезды — и это в радость"
              />
            </div>
            <Explainer>Правильный ритм — главное, что отличает удачную поездку. Здесь нет правильного ответа, только ваш.</Explainer>
          </>
        )}

        {/* ── Q8. Стоимость отелей ── */}
        {step === 'hotel_budget' && (
          <>
            <QuestionTitle>Укажите комфортный диапазон стоимости отеля за ночь.</QuestionTitle>
            <DualRange
              min={state.budgetMin}
              max={state.budgetMax}
              onChange={(min, max) => patch({ budgetMin: min, budgetMax: max, hotelUndecided: false })}
              disabled={state.hotelUndecided}
            />
            <div className="space-y-2">
              <OptionButton
                selected={state.ryokanNight}
                onClick={() => patch({ ryokanNight: !state.ryokanNight })}
                title="Хотя бы одну ночь — традиционный рёкан с онсэном"
              />
              <OptionButton
                selected={state.hotelUndecided}
                onClick={() => patch({ hotelUndecided: !state.hotelUndecided })}
                title="Затрудняюсь — покажите варианты в разных категориях"
              />
            </div>
            <Explainer>
              Спрашиваем не для того, чтобы предложить подороже. Наоборот — чтобы сразу показывать только то,
              что вам подходит, и не тратить ваше время на лишние варианты.
            </Explainer>
          </>
        )}

        {/* ── Q9. Бронирование отелей ── */}
        {step === 'hotel_booking' && (
          <>
            <QuestionTitle>Как удобнее с бронированием отелей?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.hotelBooking === 'self'}
                onClick={() => patch({ hotelBooking: 'self' })}
                title="Бронирую сам(а) — нужен только маршрут"
              />
              <OptionButton
                selected={state.hotelBooking === 'recommend'}
                onClick={() => patch({ hotelBooking: 'recommend' })}
                title="Дайте рекомендации, бронировать буду сам(а)"
              />
              <OptionButton
                selected={state.hotelBooking === 'full_service'}
                onClick={() => patch({ hotelBooking: 'full_service' })}
                title="Возьмите бронирование на себя"
              />
            </div>
            <Explainer>Любой вариант нормален. Если бронируете сами — просто дадим точные названия и лучшие даты для брони.</Explainer>
          </>
        )}

        {/* ── Q10. Формат сопровождения ── */}
        {step === 'guide_format' && (
          <>
            <QuestionTitle>Какой формат сопровождения вам ближе?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.guideFormat === 'self'}
                onClick={() => patch({ guideFormat: 'self', guideMode: null })}
                title="Самостоятельно, без гида"
                sub="Детальный маршрут, логистика, поддержка на связи"
              />
              <OptionButton
                selected={state.guideFormat === 'partial_days'}
                onClick={() => patch({ guideFormat: 'partial_days', guideMode: null })}
                title="Гид в отдельные дни"
              />
              <OptionButton
                selected={state.guideFormat === 'full'}
                onClick={() => patch({ guideFormat: 'full' })}
                title="Гид на всём маршруте"
              />
            </div>
            <Explainer>Формат влияет на стоимость сильнее всего остального, поэтому спрашиваем прямо. Комбинировать можно.</Explainer>
          </>
        )}

        {/* ── Q10a. Один гид или локальные ── */}
        {step === 'guide_mode' && (
          <>
            <QuestionTitle>Один гид на весь маршрут или локальные гиды?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton selected={state.guideMode === 'single'} onClick={() => patch({ guideMode: 'single' })} title="Один гид на всю поездку" />
              <OptionButton selected={state.guideMode === 'local'} onClick={() => patch({ guideMode: 'local' })} title="Локальные гиды в каждом регионе" />
              <OptionButton selected={state.guideMode === 'recommend'} onClick={() => patch({ guideMode: 'recommend' })} title="Как посоветуете" />
            </div>
            <Explainer>
              Один гид — постоянство и комфорт, но его переезды и проживание входят в стоимость. Локальные гиды
              глубже знают свой регион и обычно выходят дешевле. Оба варианта рабочие.
            </Explainer>
          </>
        )}

        {/* ── Q11. Финал: комментарий + контакт ── */}
        {step === 'final' && (
          <>
            <QuestionTitle>Что-то важное, о чём мы не спросили?</QuestionTitle>
            <textarea
              value={state.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Аллергии, особые даты, страхи (землетрясения, языковой барьер)…"
              rows={4}
              className={inputClass}
            />
            <div className="space-y-2 pt-2">
              <span className="block text-[15px] font-medium">Как с вами связаться?</span>
              <input
                type="text"
                value={state.contactName}
                onChange={(e) => patch({ contactName: e.target.value })}
                placeholder="Имя"
                autoComplete="name"
                className={inputClass}
              />
              <div className="grid grid-cols-3 gap-2">
                {(['telegram', 'whatsapp', 'email'] as ContactChannel[]).map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    onClick={() => patch({ contactChannel: channel })}
                    className={`${optionBase} text-center ${state.contactChannel === channel ? optionActive : optionIdle}`}
                  >
                    {channel === 'telegram' ? 'Telegram' : channel === 'whatsapp' ? 'WhatsApp' : 'Email'}
                  </button>
                ))}
              </div>
              <input
                type={state.contactChannel === 'email' ? 'email' : 'text'}
                value={state.contactValue}
                onChange={(e) => patch({ contactValue: e.target.value })}
                placeholder={
                  state.contactChannel === 'telegram'
                    ? '@username'
                    : state.contactChannel === 'whatsapp'
                      ? '+7 …'
                      : 'you@example.com'
                }
                className={inputClass}
              />
            </div>
            {submitState === 'error' && (
              <p className="text-[14px] text-[var(--accent)]">
                Не получилось отправить ответы. Попробуйте ещё раз — черновик сохранён.
              </p>
            )}
          </>
        )}
      </div>

      {/* Навигация */}
      <div className="mt-8 flex items-center justify-between gap-3">
        {safeIndex > 0 ? (
          <button
            type="button"
            onClick={goBack}
            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-5 text-[15px] text-[var(--text-muted)] transition hover:border-[var(--text-muted)]"
          >
            Назад
          </button>
        ) : (
          <span />
        )}
        {step === 'final' ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canNext || submitState === 'submitting'}
            className="inline-flex min-h-11 items-center bg-[var(--accent)] px-8 text-sm font-medium uppercase tracking-wide text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {submitState === 'submitting' ? 'Отправка…' : isEditMode ? 'Сохранить ответы' : 'Отправить'}
          </button>
        ) : (
          <button
            type="button"
            onClick={goNext}
            disabled={!canNext}
            className="inline-flex min-h-11 items-center bg-[var(--accent)] px-8 text-sm font-medium uppercase tracking-wide text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            Далее
          </button>
        )}
      </div>
    </div>
  )
}
