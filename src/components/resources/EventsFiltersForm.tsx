'use client'

import { useRef } from 'react'

const labelClassName = 'text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]'
const fieldClassName =
  'min-h-11 w-full border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--text)]'

type EventsFiltersFormProps = {
  activeCategory: string
  activeCity: string
  activeRegion: string
  activeDateFrom: string
  activeDateTo: string
  activeMonth?: string
  activeQuery?: string
  regions: string[]
  cities: string[]
}

export function EventsFiltersForm({
  activeCategory,
  activeCity,
  activeRegion,
  activeDateFrom,
  activeDateTo,
  activeMonth,
  activeQuery,
  regions,
  cities,
}: EventsFiltersFormProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const citySelectRef = useRef<HTMLSelectElement>(null)

  return (
    <form ref={formRef} action="/resources/events" method="get" className="space-y-4 rounded-[24px] border border-[var(--border)] bg-[var(--card)]/80 p-4 md:p-5">
      {activeCategory ? <input type="hidden" name="category" value={activeCategory} /> : null}
      {activeMonth ? <input type="hidden" name="month" value={activeMonth} /> : null}
      {activeQuery ? <input type="hidden" name="q" value={activeQuery} /> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-2">
          <span className={labelClassName}>Дата с</span>
          <input
            type="date"
            name="dateFrom"
            defaultValue={activeDateFrom}
            max={activeDateTo || undefined}
            onChange={() => formRef.current?.requestSubmit()}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2">
          <span className={labelClassName}>Дата по</span>
          <input
            type="date"
            name="dateTo"
            defaultValue={activeDateTo}
            min={activeDateFrom || undefined}
            onChange={() => formRef.current?.requestSubmit()}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2">
          <span className={labelClassName}>Регион</span>
          <select
            name="region"
            defaultValue={activeRegion}
            onChange={() => {
              if (citySelectRef.current) citySelectRef.current.value = ''
              formRef.current?.requestSubmit()
            }}
            className={fieldClassName}
          >
            <option value="">Все регионы</option>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className={labelClassName}>Город</span>
          <select
            ref={citySelectRef}
            name="city"
            defaultValue={activeCity}
            onChange={() => formRef.current?.requestSubmit()}
            className={fieldClassName}
          >
            <option value="">Все города</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>
      </div>
    </form>
  )
}
