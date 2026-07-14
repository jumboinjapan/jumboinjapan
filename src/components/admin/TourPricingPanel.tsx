'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calculator, ChevronDown, Plus, X } from 'lucide-react'

import { adminInputClass, adminPanelClass, adminSecondaryButtonClass } from '@/components/admin/ui'
import type { MultiDayBuilderRoute, RoutePricingData, TourDayPricingFormat, TourPricingRateKey } from '@/lib/multi-day-builder'
import {
  computeTourPricing,
  createEmptyRoutePricingData,
  DAY_FORMAT_LABELS,
  FALLBACK_PRICING_MATRIX,
  formatUsd,
  PRICING_RATE_KEYS,
  type TourPricingMatrix,
} from '@/lib/tour-pricing'
import { cn } from '@/lib/utils'

/**
 * Блок «Расчёт тура» в конструкторе (задание владельца, 2026-07-14).
 *
 * Матрица базовых ставок живёт в Airtable (таблица Pricing) и правится здесь же
 * в подблоке «Базовые ставки» — без деплоя. Вводные конкретного тура (гости,
 * override ставок, формат дня, ночёвки, ручные строки) хранятся в route.pricing
 * и уезжают в Routes.'Pricing Data' общим «Сохранить маршрут».
 */

function parseAmountInput(value: string): number | null {
  const trimmed = value.trim().replace(',', '.')
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function TourPricingPanel({
  route,
  onChangePricing,
}: {
  route: MultiDayBuilderRoute
  /** Обновление route.pricing в состоянии конструктора (сохранение — общей кнопкой). */
  onChangePricing: (pricing: RoutePricingData) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [matrix, setMatrix] = useState<TourPricingMatrix>(FALLBACK_PRICING_MATRIX)
  const [matrixState, setMatrixState] = useState<'loading' | 'ready' | 'error'>('loading')
  // Черновик правок базовых ставок (строки, чтобы не терять ввод «10» на пути к «1000»)
  const [matrixDraft, setMatrixDraft] = useState<Record<TourPricingRateKey, string> | null>(null)
  const [matrixSaveState, setMatrixSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [matrixEditorOpen, setMatrixEditorOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/pricing')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { matrix?: TourPricingMatrix }) => {
        if (cancelled) return
        if (data.matrix) {
          setMatrix({ ...FALLBACK_PRICING_MATRIX, ...data.matrix })
          setMatrixState('ready')
        } else {
          setMatrixState('error')
        }
      })
      .catch(() => {
        if (!cancelled) setMatrixState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const pricing = route.pricing ?? null
  const result = useMemo(() => computeTourPricing(route, matrix), [route, matrix])

  function updatePricing(mutate: (draft: RoutePricingData) => void) {
    const draft: RoutePricingData = pricing
      ? {
          ...pricing,
          rates: { ...pricing.rates },
          dayFormatOverrides: { ...pricing.dayFormatOverrides },
          nightOverrides: { ...pricing.nightOverrides },
          extraLines: pricing.extraLines.map((line) => ({ ...line })),
        }
      : createEmptyRoutePricingData()
    mutate(draft)
    onChangePricing(draft)
  }

  function handleRateOverride(key: TourPricingRateKey, value: string) {
    updatePricing((draft) => {
      const amount = parseAmountInput(value)
      if (amount === null) delete draft.rates[key]
      else draft.rates[key] = amount
    })
  }

  function handleDayFormat(dayNumber: number, derived: TourDayPricingFormat, value: string) {
    updatePricing((draft) => {
      // Выбор, совпадающий с авто-выводом, не фиксируем — день продолжает следовать за данными.
      if (value === '' || value === derived) delete draft.dayFormatOverrides[String(dayNumber)]
      else draft.dayFormatOverrides[String(dayNumber)] = value as TourDayPricingFormat
    })
  }

  function handleNightToggle(dayNumber: number, derived: boolean, checked: boolean) {
    updatePricing((draft) => {
      if (checked === derived) delete draft.nightOverrides[String(dayNumber)]
      else draft.nightOverrides[String(dayNumber)] = checked
    })
  }

  async function handleMatrixSave() {
    if (!matrixDraft) return
    const rates: Partial<Record<TourPricingRateKey, number>> = {}
    for (const key of PRICING_RATE_KEYS) {
      const amount = parseAmountInput(matrixDraft[key])
      if (amount !== null) rates[key] = amount
    }
    setMatrixSaveState('saving')
    try {
      const response = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates }),
      })
      const data = (await response.json()) as { matrix?: TourPricingMatrix; error?: string }
      if (!response.ok || !data.matrix) throw new Error(data.error || 'Не удалось сохранить матрицу')
      setMatrix({ ...FALLBACK_PRICING_MATRIX, ...data.matrix })
      setMatrixDraft(null)
      setMatrixSaveState('saved')
    } catch {
      setMatrixSaveState('error')
    }
  }

  const paxValue = pricing?.paxCount ?? null

  return (
    <section className={cn(adminPanelClass, 'overflow-hidden')}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <Calculator className="size-4 text-[var(--adm-text-3)]" />
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--adm-text-3)]">Расчёт тура</div>
            <div className="mt-0.5 text-base font-semibold text-[var(--adm-text)]">
              {formatUsd(result.total)}
              {result.perPerson !== null ? (
                <span className="ml-2 text-sm font-normal text-[var(--adm-text-2)]">
                  · {formatUsd(result.perPerson)} на человека ({result.paxCount} гост.)
                </span>
              ) : (
                <span className="ml-2 text-sm font-normal text-[var(--adm-text-3)]">· укажите число гостей для цены на человека</span>
              )}
            </div>
          </div>
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-[var(--adm-text-3)] transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-[var(--adm-border)] px-4 py-4">
          {matrixState === 'error' && (
            <p className="rounded-lg border border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] px-3 py-2 text-sm text-[var(--adm-warn-text)]">
              Матрица ставок из Airtable недоступна — расчёт идёт по встроенным значениям по умолчанию.
            </p>
          )}

          {/* ── Вводные тура: гости + override ставок ── */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm text-[var(--adm-text-2)]">Гостей</span>
              <input
                value={paxValue === null ? '' : String(paxValue)}
                onChange={(event) =>
                  updatePricing((draft) => {
                    const amount = parseAmountInput(event.target.value)
                    draft.paxCount = amount !== null && amount >= 1 ? Math.round(amount) : null
                  })
                }
                placeholder="—"
                inputMode="numeric"
                className={adminInputClass}
              />
              <span className="block text-xs text-[var(--adm-text-3)]">Для цены на человека; позже подтянем из анкеты клиента.</span>
            </label>

            {PRICING_RATE_KEYS.map((key) => {
              const override = pricing?.rates[key]
              return (
                <label key={key} className="space-y-2">
                  <span className="text-sm text-[var(--adm-text-2)]">{matrix[key].label}, $/{matrix[key].unit}</span>
                  <input
                    value={typeof override === 'number' ? String(override) : ''}
                    onChange={(event) => handleRateOverride(key, event.target.value)}
                    placeholder={String(matrix[key].amount)}
                    inputMode="numeric"
                    className={adminInputClass}
                  />
                  <span className="block text-xs text-[var(--adm-text-3)]">
                    Пусто — базовая ставка {formatUsd(matrix[key].amount)}. Значение действует только в этом туре.
                  </span>
                </label>
              )
            })}
          </div>

          {/* ── Таблица по дням ── */}
          <div className="overflow-x-auto rounded-xl border border-[var(--adm-border)]">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--adm-hover)] text-left text-[var(--adm-text-3)]">
                <tr>
                  <th className="px-3 py-2.5 font-medium">День</th>
                  <th className="px-3 py-2.5 font-medium">Формат работы гида</th>
                  <th className="px-3 py-2.5 font-medium text-right">Работа гида</th>
                  <th className="px-3 py-2.5 font-medium">Ночёвка гида</th>
                  <th className="px-3 py-2.5 font-medium text-right">Проживание</th>
                </tr>
              </thead>
              <tbody>
                {result.dayRows.map((row) => (
                  <tr key={row.dayNumber} className="border-t border-[var(--adm-border)] text-[var(--adm-text-2)]">
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-[var(--adm-text)]">День {row.dayNumber}</span>
                      {row.dayTitle ? <span className="ml-1.5 text-xs text-[var(--adm-text-3)]">{row.dayTitle}</span> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={row.formatOverridden ? row.format : ''}
                        onChange={(event) => handleDayFormat(row.dayNumber, row.derivedFormat, event.target.value)}
                        className={cn(adminInputClass, 'h-8 py-0 text-sm')}
                      >
                        <option value="">Авто — {DAY_FORMAT_LABELS[row.derivedFormat]}</option>
                        {(Object.keys(DAY_FORMAT_LABELS) as TourDayPricingFormat[]).map((format) => (
                          <option key={format} value={format}>
                            {DAY_FORMAT_LABELS[format]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.amount > 0 ? formatUsd(row.amount) : '—'}</td>
                    <td className="px-3 py-2.5">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={row.nightCounted}
                          onChange={(event) => handleNightToggle(row.dayNumber, row.nightDerived, event.target.checked)}
                          className="size-3.5 accent-[var(--adm-accent)]"
                        />
                        <span className="text-xs text-[var(--adm-text-3)]">
                          {row.overnightCity || 'ночёвка не задана'}
                          {row.nightOverridden ? ' · вручную' : ''}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.nightAmount > 0 ? formatUsd(row.nightAmount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="-mt-3 text-xs text-[var(--adm-text-3)]">
            «Авто» выводит формат из программы дня: самостоятельный день — без гида; переезд на автомобиле, частный или
            заказной транспорт в программе — гид + частный транспорт; иначе — гид без транспорта. Ночёвка гида считается
            автоматически вне Токио, когда рядом есть рабочие дни гида.
          </p>

          {/* ── Ручные строки-допы ── */}
          <div className="space-y-2">
            <div className="text-sm text-[var(--adm-text-2)]">Дополнительные строки (билеты, лимузин и т.п.)</div>
            {(pricing?.extraLines ?? []).map((line, index) => (
              <div key={line.id} className="flex items-center gap-2">
                <input
                  value={line.label}
                  onChange={(event) =>
                    updatePricing((draft) => {
                      draft.extraLines[index] = { ...draft.extraLines[index], label: event.target.value }
                    })
                  }
                  placeholder="Название строки"
                  className={cn(adminInputClass, 'flex-1')}
                />
                <input
                  value={line.amount === null ? '' : String(line.amount)}
                  onChange={(event) =>
                    updatePricing((draft) => {
                      draft.extraLines[index] = { ...draft.extraLines[index], amount: parseAmountInput(event.target.value) }
                    })
                  }
                  placeholder="Сумма, $"
                  inputMode="numeric"
                  className={cn(adminInputClass, 'w-32')}
                />
                <button
                  type="button"
                  onClick={() =>
                    updatePricing((draft) => {
                      draft.extraLines.splice(index, 1)
                    })
                  }
                  aria-label="Удалить строку"
                  className="rounded-lg border border-[var(--adm-border)] p-2 text-[var(--adm-text-3)] transition hover:border-[var(--adm-danger-border)] hover:text-[var(--adm-danger-text)]"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                updatePricing((draft) => {
                  draft.extraLines.push({ id: `extra-${Date.now()}`, label: '', amount: null })
                })
              }
              className={cn(adminSecondaryButtonClass, 'gap-1.5')}
            >
              <Plus className="size-3.5" />
              Добавить строку
            </button>
          </div>

          {/* ── Финальный свод ── */}
          <div className="rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--adm-text-3)]">Финальная таблица</div>
            <div className="mt-2 space-y-1.5 text-sm text-[var(--adm-text-2)]">
              {result.summaryLines.map((line) => (
                <div key={line.key} className="flex items-baseline justify-between gap-3">
                  <span>
                    {line.label} — {line.quantity} {line.unit} × {formatUsd(line.rate)}
                  </span>
                  <span className="tabular-nums text-[var(--adm-text)]">{formatUsd(line.amount)}</span>
                </div>
              ))}
              {result.extraLines.map((line) => (
                <div key={line.id} className="flex items-baseline justify-between gap-3">
                  <span>{line.label}</span>
                  <span className="tabular-nums text-[var(--adm-text)]">{formatUsd(line.amount)}</span>
                </div>
              ))}
              {result.summaryLines.length === 0 && result.extraLines.length === 0 && (
                <div className="text-[var(--adm-text-3)]">Пока нечего считать — в программе нет дней с гидом.</div>
              )}
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t border-[var(--adm-border)] pt-3">
              <span className="text-sm font-semibold text-[var(--adm-text)]">Итого</span>
              <span className="text-base font-semibold tabular-nums text-[var(--adm-text)]">{formatUsd(result.total)}</span>
            </div>
            {result.perPerson !== null && (
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-sm text-[var(--adm-text-2)]">На человека ({result.paxCount} гост.)</span>
                <span className="text-sm font-semibold tabular-nums text-[var(--adm-text)]">{formatUsd(result.perPerson)}</span>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={pricing?.includeInPdf ?? true}
              onChange={(event) =>
                updatePricing((draft) => {
                  draft.includeInPdf = event.target.checked
                })
              }
              className="size-3.5 accent-[var(--adm-accent)]"
            />
            <span className="text-sm text-[var(--adm-text-2)]">
              Печатать страницу «Стоимость программы» в PDF — цена на человека с разбивкой
            </span>
          </label>

          {/* ── Матрица базовых ставок (общая для всех туров) ── */}
          <div className="rounded-xl border border-[var(--adm-border)]">
            <button
              type="button"
              onClick={() => setMatrixEditorOpen((value) => !value)}
              aria-expanded={matrixEditorOpen}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-[var(--adm-text-2)]"
            >
              <span>Базовые ставки (матрица — общая для всех туров)</span>
              <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', matrixEditorOpen && 'rotate-180')} />
            </button>
            {matrixEditorOpen && (
              <div className="space-y-3 border-t border-[var(--adm-border)] px-3 py-3">
                <div className="grid gap-3 md:grid-cols-3">
                  {PRICING_RATE_KEYS.map((key) => (
                    <label key={key} className="space-y-1.5">
                      <span className="text-xs text-[var(--adm-text-3)]">{matrix[key].label}, $/{matrix[key].unit}</span>
                      <input
                        value={matrixDraft?.[key] ?? String(matrix[key].amount)}
                        onChange={(event) =>
                          setMatrixDraft((prev) => ({
                            guide_day: prev?.guide_day ?? String(matrix.guide_day.amount),
                            guide_day_private_transport:
                              prev?.guide_day_private_transport ?? String(matrix.guide_day_private_transport.amount),
                            guide_night_outside_tokyo:
                              prev?.guide_night_outside_tokyo ?? String(matrix.guide_night_outside_tokyo.amount),
                            [key]: event.target.value,
                          }))
                        }
                        inputMode="numeric"
                        className={adminInputClass}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleMatrixSave()}
                    disabled={!matrixDraft || matrixSaveState === 'saving'}
                    className={cn(adminSecondaryButtonClass, 'disabled:opacity-40')}
                  >
                    {matrixSaveState === 'saving' ? 'Сохраняю…' : 'Сохранить матрицу'}
                  </button>
                  {matrixSaveState === 'saved' && !matrixDraft && <span className="text-xs text-[var(--adm-text-3)]">Сохранено в Airtable</span>}
                  {matrixSaveState === 'error' && (
                    <span className="text-xs text-[var(--adm-danger-text)]">Не удалось сохранить — попробуйте ещё раз</span>
                  )}
                </div>
                <p className="text-xs text-[var(--adm-text-3)]">
                  Меняет дефолтные ставки для всех туров без собственного override (таблица Pricing в Airtable). Сохраняется
                  сразу, отдельно от кнопки «Сохранить маршрут».
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
