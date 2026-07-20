'use client'
import { ptSerif } from './fonts'

/**
 * Единый календарь с захватом диапазона для ветки «Даты точные» опросника
 * (спека v3): выбор от прилёта до вылета одним виджетом, продолжительность
 * видна сразу. Мобильный формат: один месяц, переключение стрелками.
 * Без зависимостей — лёгкая сетка на нативных Date.
 */

import { useState } from 'react'

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function todayIso(): string {
  const now = new Date()
  return toIso(now.getFullYear(), now.getMonth(), now.getDate())
}

export function DateRangeCalendar({
  start,
  end,
  onChange,
}: {
  start: string | null
  end: string | null
  onChange: (start: string | null, end: string | null) => void
}) {
  const initial = start ? new Date(start) : new Date()
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())

  const minIso = todayIso()

  function shiftMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(next.getFullYear())
    setViewMonth(next.getMonth())
  }

  function handleDayClick(iso: string) {
    if (iso < minIso) return
    // Первый клик — прилёт; второй — вылет; клик раньше прилёта начинает заново.
    if (!start || (start && end)) {
      onChange(iso, null)
      return
    }
    if (iso <= start) {
      onChange(iso, null)
      return
    }
    onChange(start, iso)
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  // Понедельник — первый день недели.
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7

  const nights =
    start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86400_000) : null

  const cells: Array<{ day: number; iso: string } | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      iso: toIso(viewYear, viewMonth, i + 1),
    })),
  ]

  const canGoBack = new Date(viewYear, viewMonth, 1) > new Date(new Date().getFullYear(), new Date().getMonth(), 1)

  return (
    <div className="rounded-[4px] border border-[var(--border)] bg-[var(--surface)] p-[18px] lg:px-6 lg:py-[22px]">
      {/* Шапка: месяц + стрелки */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={!canGoBack}
          aria-label="Предыдущий месяц"
          className="flex size-[34px] items-center justify-center text-[16px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-30"
        >
          ‹
        </button>
        <span className={`${ptSerif.className} text-[15.5px] lg:text-[16px]`}>
          {MONTHS_RU[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Следующий месяц"
          className="flex size-[34px] items-center justify-center text-[16px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          ›
        </button>
      </div>

      {/* Сетка */}
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAYS_RU.map((weekday) => (
          <span key={weekday} className="pb-1 text-[11px] text-[var(--text-muted)]">
            {weekday}
          </span>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <span key={`blank-${i}`} />
          const { day, iso } = cell
          const disabled = iso < minIso
          const isStart = iso === start
          const isEnd = iso === end
          const inRange = start !== null && end !== null && iso > start && iso < end
          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              onClick={() => handleDayClick(iso)}
              className={[
                'mx-auto flex size-9 items-center justify-center rounded-full text-[14px] transition',
                disabled
                  ? 'cursor-default text-[var(--border)]'
                  : isStart || isEnd
                    ? 'bg-[var(--accent)] font-medium text-white'
                    : inRange
                      ? 'bg-[var(--accent)]/15 text-[var(--text)]'
                      : 'hover:bg-[var(--bg-warm)]',
              ].join(' ')}
            >
              {day}
            </button>
          )
        })}
      </div>

      {/* Подпись выбранного диапазона */}
      <div className="mt-3.5 flex items-center justify-between border-t border-[var(--border)] pt-3 text-[13px] text-[var(--text-muted)]">
        {start && end ? (
          <>
            {new Date(start).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} —{' '}
            {new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
            {nights !== null && nights > 0 && (
              <span className="ml-2 font-medium text-[var(--gold)]">
                {nights}{' '}
                {nights % 10 === 1 && nights % 100 !== 11
                  ? 'ночь'
                  : nights % 10 >= 2 && nights % 10 <= 4 && (nights % 100 < 10 || nights % 100 >= 20)
                    ? 'ночи'
                    : 'ночей'}
              </span>
            )}
          </>
        ) : start ? (
          <>Прилёт {new Date(start).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} — теперь выберите дату вылета</>
        ) : (
          'Выберите дату прилёта'
        )}
      </div>
    </div>
  )
}
