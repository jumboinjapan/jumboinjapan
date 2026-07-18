'use client'

/**
 * Опросник «Профиль туриста» v3 — мультишаговый wizard, мобильный прежде всего.
 *
 * Канон содержания: docs/tourist-profile-questionnaire-spec.md (спецификация
 * владельца v3) — тексты вопросов и пояснений дословно, 11 экранов основной
 * ветки, один вопрос — один экран. Пояснения только там, где вопрос
 * неочевиден или чувствителен. Черновик — localStorage.
 *
 * Антибот (Фаза 1 финального стека): reCAPTCHA v3 (невидимая; токен
 * выполняется при отправке — TTL токена ~2 мин, а анкета занимает 3–5,
 * поэтому без серверных сессий выполнение на первом экране протухло бы),
 * honeypot-поле, время заполнения. Клиентская валидация дублируется
 * серверной. Без ключа NEXT_PUBLIC_RECAPTCHA_SITE_KEY слой отключён.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ─── reCAPTCHA v3 (невидимая) ────────────────────────────────────────────────

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? ''

interface Grecaptcha {
  ready: (cb: () => void) => void
  execute: (siteKey: string, options: { action: string }) => Promise<string>
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha
  }
}

function loadRecaptchaScript() {
  if (!RECAPTCHA_SITE_KEY || typeof window === 'undefined') return
  if (document.querySelector('script[data-recaptcha]')) return
  const script = document.createElement('script')
  script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`
  script.async = true
  script.defer = true
  script.dataset.recaptcha = 'true'
  document.head.appendChild(script)
}

async function getRecaptchaToken(): Promise<string | null> {
  if (!RECAPTCHA_SITE_KEY || typeof window === 'undefined' || !window.grecaptcha) return null
  try {
    const grecaptcha = window.grecaptcha
    await new Promise<void>((resolve) => grecaptcha.ready(resolve))
    return await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'profile_submit' })
  } catch {
    return null
  }
}

import { trackEvent } from '@/lib/analytics'
import { DateRangeCalendar } from './DateRangeCalendar'
import {
  isValidContactValue,
  type ArtHuntingType,
  type ContactChannel,
  type DatesPrecision,
  type FirstTripPreference,
  type GuideFormat,
  type HotelBooking,
  type InterestKey,
  type InterestsDepth,
  type MobilityFlag,
  type NewType,
  type ProfilePace,
  type RepeatMode,
  type TouristProfilePayload,
} from '@/lib/tourist-profile'

// ─── Состояние формы ─────────────────────────────────────────────────────────

interface FormState {
  datesPrecision: DatesPrecision | null
  dateStart: string
  dateEnd: string
  month: string
  firstTrip: boolean | null
  firstTripPreference: FirstTripPreference | null
  regionsVisitedText: string
  repeatMode: RepeatMode | null
  newType: NewType | null
  newIdeasNote: string
  adults: number
  childrenAges: number[]
  groupFinal: boolean
  mobility: MobilityFlag[]
  interests: InterestKey[]
  activeCustom: string
  activeAskRecommend: boolean
  artHuntingType: ArtHuntingType | null
  interestsCustom: string
  interestsDepth: InterestsDepth | null
  pace: ProfilePace | null
  budgetMin: number
  budgetMax: number
  ryokanNight: boolean
  hotelBooking: HotelBooking | null
  guideFormat: GuideFormat | null
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
  firstTripPreference: null,
  regionsVisitedText: '',
  repeatMode: null,
  newType: null,
  newIdeasNote: '',
  adults: 2,
  childrenAges: [],
  groupFinal: true,
  mobility: [],
  interests: [],
  activeCustom: '',
  activeAskRecommend: false,
  artHuntingType: null,
  interestsCustom: '',
  interestsDepth: null,
  pace: null,
  // Спека v3: стартовые значения ползунка $150–400.
  budgetMin: 150,
  budgetMax: 400,
  ryokanNight: false,
  hotelBooking: null,
  guideFormat: null,
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
    firstTripPreference: p.first_trip_preference,
    regionsVisitedText: p.regions_visited_text ?? '',
    repeatMode: p.repeat_mode,
    newType: p.new_type,
    newIdeasNote: p.new_ideas_note ?? '',
    adults: p.group.adults,
    childrenAges: p.group.children.map((c) => c.age),
    groupFinal: p.group.final,
    mobility: p.mobility,
    interests: p.interests,
    activeCustom: p.active_detail?.custom ?? '',
    activeAskRecommend: p.active_detail?.ask_recommend ?? false,
    artHuntingType: p.art_hunting_type,
    interestsCustom: p.interests_custom ?? '',
    interestsDepth: p.interests_depth,
    pace: p.pace,
    budgetMin: p.hotel_budget_usd.min,
    budgetMax: p.hotel_budget_usd.max,
    ryokanNight: p.ryokan_night,
    hotelBooking: p.hotel_booking,
    guideFormat: p.guide_format,
    notes: p.notes,
    contactName: p.contact.name,
    contactChannel: p.contact.channel,
    contactValue: p.contact.value,
  }
}

function payloadFromState(s: FormState): TouristProfilePayload {
  const isExact = s.datesPrecision === 'exact'
  return {
    dates: {
      start: isExact ? s.dateStart || null : null,
      end: isExact ? s.dateEnd || null : null,
      precision: s.datesPrecision ?? 'flexible',
      month: !isExact ? s.month || null : null,
    },
    first_trip: s.firstTrip === true,
    first_trip_preference: s.firstTrip ? s.firstTripPreference : null,
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
    active_detail: s.interests.includes('active')
      ? { custom: s.activeCustom.trim() || null, ask_recommend: s.activeAskRecommend }
      : null,
    art_hunting_type: s.interests.includes('art_hunting') ? s.artHuntingType : null,
    interests_custom: s.interestsCustom.trim() || null,
    interests_depth: hasRealInterest(s) ? s.interestsDepth : null,
    pace: s.pace ?? 'few_moves',
    hotel_budget_usd: { min: s.budgetMin, max: s.budgetMax },
    ryokan_night: s.ryokanNight,
    hotel_booking: s.hotelBooking ?? 'self_with_recs',
    guide_format: s.guideFormat ?? 'self_with_route_recs',
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
  | 'first_preference'
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
  | 'final'

function computeSteps(s: FormState): StepId[] {
  const steps: StepId[] = ['dates', 'first_trip']
  if (s.firstTrip === false) {
    steps.push('regions_visited', 'repeat_mode')
    if (s.repeatMode === 'only_new' || s.repeatMode === 'mix') steps.push('new_type')
  } else {
    // Пока Q2 не отвечен, считаем основную ветку — «Вопрос N из 11» (спека v3).
    steps.push('first_preference')
  }
  steps.push('group', 'mobility', 'interests', 'pace', 'hotel_budget', 'hotel_booking', 'guide_format', 'final')
  return steps
}

function isStepComplete(step: StepId, s: FormState): boolean {
  switch (step) {
    case 'dates':
      if (!s.datesPrecision) return false
      if (s.datesPrecision === 'exact') return s.dateStart !== '' && s.dateEnd !== ''
      return s.month !== ''
    case 'first_trip':
      return s.firstTrip !== null
    case 'first_preference':
      return s.firstTripPreference !== null
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
    case 'final':
      return (
        s.contactName.trim() !== '' &&
        s.contactChannel !== null &&
        s.contactValue.trim() !== '' &&
        isValidContactValue(s.contactChannel, s.contactValue)
      )
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

// Спека v3: шкала $80–800+, шаг $10.
const BUDGET_MIN = 80
const BUDGET_MAX = 800
const BUDGET_STEP = 10

function DualRange({
  min,
  max,
  onChange,
}: {
  min: number
  max: number
  onChange: (min: number, max: number) => void
}) {
  const pct = (v: number) => ((v - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * 100
  return (
    <div>
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
          onChange={(e) => onChange(Math.min(Number(e.target.value), max - BUDGET_STEP), max)}
          className="dual-range absolute top-0 h-10 w-full"
          aria-label="Нижняя граница стоимости отеля за ночь"
        />
        <input
          type="range"
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={BUDGET_STEP}
          value={max}
          onChange={(e) => onChange(min, Math.max(Number(e.target.value), min + BUDGET_STEP))}
          className="dual-range absolute top-0 h-10 w-full"
          aria-label="Верхняя граница стоимости отеля за ночь"
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

// ─── Справочники подписей ────────────────────────────────────────────────────

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
  const [draftRestored, setDraftRestored] = useState(false)
  // Honeypot: скрытое поле — человек его не видит и не заполняет.
  const [honeypot, setHoneypot] = useState('')
  // Время заполнения (антибот): старт первого экрана, восстанавливается из черновика.
  const startedAtRef = useRef<number>(Date.now())
  // Год для режимов «примерные» / «только месяц» до выбора месяца.
  const [pendingYear, setPendingYear] = useState(() => String(new Date().getFullYear()))
  const restoredRef = useRef(false)

  // reCAPTCHA v3: скрипт грузится один раз при открытии формы.
  useEffect(() => {
    loadRecaptchaScript()
  }, [])

  // Восстановление черновика (только если нет сохранённых ответов).
  useEffect(() => {
    if (restoredRef.current || isEditMode) return
    restoredRef.current = true
    try {
      const raw = window.localStorage.getItem(draftKey)
      if (!raw) return
      const draft = JSON.parse(raw) as { state?: Partial<FormState>; stepIndex?: number; startedAt?: number }
      if (draft.state) {
        setState((prev) => ({ ...prev, ...draft.state }))
        if (typeof draft.stepIndex === 'number' && draft.stepIndex > 0) setStepIndex(draft.stepIndex)
        if (typeof draft.startedAt === 'number') startedAtRef.current = draft.startedAt
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
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({ state, stepIndex, startedAt: startedAtRef.current })
      )
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
      trackEvent('questionnaire_step', { step: steps[safeIndex], index: safeIndex })
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
      const recaptchaToken = await getRecaptchaToken()
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          src: src ?? null,
          payload: payloadFromState(state),
          hp: honeypot,
          elapsedSeconds: Math.round((Date.now() - startedAtRef.current) / 1000),
          recaptchaToken,
        }),
      })
      const data = (await response.json().catch(() => null)) as { ok?: boolean } | null
      if (!response.ok || !data?.ok) throw new Error('submit failed')
      try {
        window.localStorage.removeItem(draftKey)
      } catch {
        // ignore
      }
      setSubmitState('done')
      trackEvent('questionnaire_submit', { edit_mode: isEditMode })
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
          Мы изучим ответы и вернёмся с наброском маршрута в течение двух дней. Это ни к чему вас не
          обязывает.
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
  const contactValueInvalid =
    state.contactChannel !== null &&
    state.contactValue.trim() !== '' &&
    !isValidContactValue(state.contactChannel, state.contactValue)

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
        <p className="mb-4 text-[13px] text-[var(--text-muted)]">
          Мы сохранили ваш черновик — продолжайте с того места, где остановились.
        </p>
      )}

      {/* Honeypot: невидимое поле-ловушка для ботов. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Ваш сайт
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>

      <div className="space-y-5">
        {/* ── Q1. Даты ── */}
        {step === 'dates' && (
          <>
            <QuestionTitle>Когда вы отправляетесь?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.datesPrecision === 'exact'}
                onClick={() => patch({ datesPrecision: 'exact' })}
                title="Даты точные"
              />
              <OptionButton
                selected={state.datesPrecision === 'flexible'}
                onClick={() => patch({ datesPrecision: 'flexible' })}
                title="Примерные, плюс-минус несколько дней"
              />
              <OptionButton
                selected={state.datesPrecision === 'month_only'}
                onClick={() => patch({ datesPrecision: 'month_only' })}
                title="Пока знаю только месяц"
              />
            </div>
            {state.datesPrecision === 'exact' && (
              <DateRangeCalendar
                start={state.dateStart || null}
                end={state.dateEnd || null}
                onChange={(start, end) => patch({ dateStart: start ?? '', dateEnd: end ?? '' })}
              />
            )}
            {(state.datesPrecision === 'flexible' || state.datesPrecision === 'month_only') && (
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
              Цены отелей и доступность гидов в Японии сильно зависят от сезона — период цветения сакуры, сезон
              багряных клёнов, праздники, фестивали и события национального масштаба бронируются заблаговременно.
              Предварительное планирование поможет обеспечить лучшие условия для вашей поездки.
            </Explainer>
          </>
        )}

        {/* ── Q2. Опыт ── */}
        {step === 'first_trip' && (
          <>
            <QuestionTitle>Вы уже бывали в Японии?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.firstTrip === true}
                onClick={() =>
                  patch({ firstTrip: true, regionsVisitedText: '', repeatMode: null, newType: null, newIdeasNote: '' })
                }
                title="Нет, это первая поездка"
              />
              <OptionButton
                selected={state.firstTrip === false}
                onClick={() => patch({ firstTrip: false, firstTripPreference: null })}
                title="Да"
              />
            </div>
          </>
        )}

        {/* ── Q3a. Первая поездка: что ближе ── */}
        {step === 'first_preference' && (
          <>
            <QuestionTitle>Первая поездка — и тут выбор всегда разный. Что вам ближе?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.firstTripPreference === 'main_highlights'}
                onClick={() => patch({ firstTripPreference: 'main_highlights' })}
                title="Хочу увидеть главное"
                sub="То, ради чего чаще всего впервые едут в Японию"
              />
              <OptionButton
                selected={state.firstTripPreference === 'off_beaten_path'}
                onClick={() => patch({ firstTripPreference: 'off_beaten_path' })}
                title="Тянет туда, где меньше туристов"
                sub="Необычные маршруты, не самые известные места"
              />
              <OptionButton
                selected={state.firstTripPreference === 'mix'}
                onClick={() => patch({ firstTripPreference: 'mix' })}
                title="И то и другое, если получится совместить"
              />
              <OptionButton
                selected={state.firstTripPreference === 'recommend'}
                onClick={() => patch({ firstTripPreference: 'recommend' })}
                title="Не знаю — предложите вы"
              />
            </div>
            <Explainer>
              По этому ответу и вашим датам мы соберём конкретные города — обсудим на следующем шаге.
            </Explainer>
          </>
        )}

        {/* ── Q3b. Где уже были ── */}
        {step === 'regions_visited' && (
          <>
            <QuestionTitle>Где вы уже были? Пишите как вспомнится — города, места, что запомнилось.</QuestionTitle>
            <textarea
              value={state.regionsVisitedText}
              onChange={(e) => patch({ regionsVisitedText: e.target.value })}
              placeholder="Например: Токио, Киото, Осака, Хиросима, Сендай…"
              rows={4}
              className={inputClass}
            />
          </>
        )}

        {/* ── Q3c. Вернуться или новое ── */}
        {step === 'repeat_mode' && (
          <>
            <QuestionTitle>В знакомые места хочется вернуться, или лучше открыть новое?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.repeatMode === 'only_new'}
                onClick={() => patch({ repeatMode: 'only_new' })}
                title="Хотим только новое — знакомое уже видели"
              />
              <OptionButton
                selected={state.repeatMode === 'repeat_familiar'}
                onClick={() => patch({ repeatMode: 'repeat_familiar', newType: null, newIdeasNote: '' })}
                title="Готовы вернуться — были давно, или едем в новом составе (с друзьями, детьми)"
              />
              <OptionButton
                selected={state.repeatMode === 'mix'}
                onClick={() => patch({ repeatMode: 'mix' })}
                title="Микс: знакомые города можно оставить, а программу — сделать новой"
              />
            </div>
            <Explainer>
              Вернуться в знакомые места — не шаг назад: с детьми или друзьями это фактически новая поездка.
              А для тех, кто хочет только новое, Япония глубже, чем кажется.
            </Explainer>
          </>
        )}

        {/* ── Q3d. Какое новое ── */}
        {step === 'new_type' && (
          <>
            <QuestionTitle>
              А новое — это что? То, что вы просто ещё не успели увидеть, или что-то совсем в стороне от
              туристических троп?
            </QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.newType === 'known_new'}
                onClick={() => patch({ newType: 'known_new' })}
                title="Известная Япония, где мы ещё не были"
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
              placeholder="Есть конкретные идеи? Напишите (необязательно)"
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
            <QuestionTitle>Кто едет с вами?</QuestionTitle>
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
                <OptionButton selected={!state.groupFinal} onClick={() => patch({ groupFinal: false })} title="Состав может измениться" />
              </div>
            </div>
            <Explainer>
              От состава зависят номера в отелях (в Японии строгие лимиты по числу гостей в номере) и тип
              транспорта.
            </Explainer>
          </>
        )}

        {/* ── Q5. Мобильность и темп ── */}
        {step === 'mobility' && (
          <>
            <QuestionTitle>Кому-то из группы лучше двигаться помедленнее?</QuestionTitle>
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
              Есть увлечение, вокруг которого хочется построить поездку — целиком или частично?
            </QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.interests.includes('gastronomy')}
                onClick={() => toggleInterest('gastronomy')}
                title="Гастрономия"
              />
              <OptionButton
                selected={state.interests.includes('active')}
                onClick={() => toggleInterest('active')}
                title="Активный отдых"
              />
              {state.interests.includes('active') && (
                <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                  <input
                    type="text"
                    value={state.activeCustom}
                    onChange={(e) => patch({ activeCustom: e.target.value, activeAskRecommend: false })}
                    placeholder="Впишите, что интересует"
                    className={inputClass}
                  />
                  <OptionButton
                    selected={state.activeAskRecommend}
                    onClick={() => patch({ activeAskRecommend: !state.activeAskRecommend, activeCustom: '' })}
                    title="Жду ваших предложений"
                  />
                </div>
              )}
              <OptionButton
                selected={state.interests.includes('photography')}
                onClick={() => toggleInterest('photography')}
                title="Фототур"
              />
              <OptionButton
                selected={state.interests.includes('art_hunting')}
                onClick={() => toggleInterest('art_hunting')}
                title="Охота за искусством"
              />
              {state.interests.includes('art_hunting') && (
                <div className="grid grid-cols-3 gap-2">
                  <OptionButton
                    selected={state.artHuntingType === 'modern'}
                    onClick={() => patch({ artHuntingType: 'modern' })}
                    title="Современное"
                  />
                  <OptionButton
                    selected={state.artHuntingType === 'traditional'}
                    onClick={() => patch({ artHuntingType: 'traditional' })}
                    title="Традиционное"
                  />
                  <OptionButton
                    selected={state.artHuntingType === 'both'}
                    onClick={() => patch({ artHuntingType: 'both' })}
                    title="И то и другое"
                  />
                </div>
              )}
              <OptionButton
                selected={state.interests.includes('culture')}
                onClick={() => toggleInterest('culture')}
                title="Культура"
                sub="Лёгкое знакомство: ремёсла, мастер-классы, театр, единоборства"
              />
              <OptionButton
                selected={state.interests.includes('none')}
                onClick={() => toggleInterest('none')}
                title="Ничего специального"
              />
              <input
                type="text"
                value={state.interestsCustom}
                onChange={(e) => patch({ interestsCustom: e.target.value })}
                placeholder="Своя тема (необязательно)"
                className={inputClass}
              />
            </div>
            {hasRealInterest(state) && (
              <div className="grid grid-cols-2 gap-2">
                <OptionButton
                  selected={state.interestsDepth === 'accent'}
                  onClick={() => patch({ interestsDepth: 'accent' })}
                  title="Как акцент"
                />
                <OptionButton
                  selected={state.interestsDepth === 'dedicated_tour'}
                  onClick={() => patch({ interestsDepth: 'dedicated_tour' })}
                  title="Как отдельный тур"
                />
              </div>
            )}
            <Explainer>
              Один сильный интерес часто даёт лучший день всей поездки — ради него можно перестроить маршрут.
              Если таких тем нет, это тоже нормальный ответ.
            </Explainer>
          </>
        )}

        {/* ── Q7. Ритм поездки ── */}
        {step === 'pace' && (
          <>
            <QuestionTitle>Какой ритм поездки вам ближе?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.pace === 'no_hotel_change'}
                onClick={() => patch({ pace: 'no_hotel_change' })}
                title="Выездные туры без смены отеля"
                sub="Живём в одном отеле, интересные локации смотрим однодневными выездами"
              />
              <OptionButton
                selected={state.pace === 'few_moves'}
                onClick={() => patch({ pace: 'few_moves' })}
                title="Готовы к паре переездов ради ярких остановок"
                sub="Например, ночь в традиционном отеле в горах — впечатление, ради которого стоит собрать чемодан"
              />
              <OptionButton
                selected={state.pace === 'max_experience'}
                onClick={() => patch({ pace: 'max_experience' })}
                title="Максимум впечатлений за отведённое время"
                sub="Плотный график и частая смена мест — ради того, чтобы увидеть больше"
              />
            </div>
            <Explainer>
              Выездные туры экономят силы, но означают дорогу в два конца и сужают географию — вы увидите то,
              что в паре часов от отеля. Частая смена отеля открывает больше мест и подойдёт тем, кто спокойно
              относится к переездам и новым номерам почти каждый день.
            </Explainer>
          </>
        )}

        {/* ── Q8. Стоимость отелей ── */}
        {step === 'hotel_budget' && (
          <>
            <QuestionTitle>Выберите комфортный диапазон стоимости отеля за ночь.</QuestionTitle>
            <DualRange
              min={state.budgetMin}
              max={state.budgetMax}
              onChange={(min, max) => patch({ budgetMin: min, budgetMax: max })}
            />
            <OptionButton
              selected={state.ryokanNight}
              onClick={() => patch({ ryokanNight: !state.ryokanNight })}
              title="Хотя бы одну ночь — традиционный отель рёкан с термальными источниками онсэн"
            />
            <Explainer>
              Нам важно понимать ваши предпочтения по уровню комфорта — это влияет не только на отель, но и на
              остальные решения в маршруте: стоит ли предлагать мастер-класс, закладывать ли дополнительный
              переезд и так далее.
            </Explainer>
          </>
        )}

        {/* ── Q9. Рекомендации отелей ── */}
        {step === 'hotel_booking' && (
          <>
            <QuestionTitle>Рекомендации отелей</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.hotelBooking === 'self_with_recs'}
                onClick={() => patch({ hotelBooking: 'self_with_recs' })}
                title="Бронирую самостоятельно. Нужны рекомендации"
              />
              <OptionButton
                selected={state.hotelBooking === 'full_service'}
                onClick={() => patch({ hotelBooking: 'full_service' })}
                title="Хочу делегировать бронирование отелей"
              />
              <OptionButton
                selected={state.hotelBooking === 'self_no_recs'}
                onClick={() => patch({ hotelBooking: 'self_no_recs' })}
                title="Самостоятельно. Рекомендаций не требуется"
              />
            </div>
            <Explainer>
              Любой вариант нормален. Если бронируете сами — просто дадим точные названия и лучшие даты для
              брони.
            </Explainer>
          </>
        )}

        {/* ── Q10. Формат сопровождения — без пояснений: выбор — дело вкуса ── */}
        {step === 'guide_format' && (
          <>
            <QuestionTitle>Какой формат сопровождения вам ближе?</QuestionTitle>
            <div className="space-y-2">
              <OptionButton
                selected={state.guideFormat === 'self_with_route_recs'}
                onClick={() => patch({ guideFormat: 'self_with_route_recs' })}
                title="Самостоятельно. Хотел бы получить рекомендации по маршруту"
              />
              <OptionButton
                selected={state.guideFormat === 'partial_tours'}
                onClick={() => patch({ guideFormat: 'partial_tours' })}
                title="Отдельные экскурсии и туры с гидом"
              />
              <OptionButton
                selected={state.guideFormat === 'full_guide'}
                onClick={() => patch({ guideFormat: 'full_guide' })}
                title="Сопровождение гида по всему маршруту"
              />
            </div>
          </>
        )}

        {/* ── Q11. Финал: комментарий + контакт ── */}
        {step === 'final' && (
          <>
            <QuestionTitle>Что-то важное, о чём мы не спросили?</QuestionTitle>
            <textarea
              value={state.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Аллергии, особые даты (день рождения, годовщина), особые пожелания"
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
              {contactValueInvalid && (
                <p className="text-[13px] text-[var(--accent)]">
                  Проверьте контакт — похоже, в нём опечатка.
                </p>
              )}
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
