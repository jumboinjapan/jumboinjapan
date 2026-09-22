'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MultiDayBuilderCityOption, MultiDayBuilderPoiOption } from '@/lib/multi-day-builder-data'
import { defaultPoiDestination, filterRoutePois, poiDestinations } from '@/lib/route-poi-search'
import { adminInputClass, adminSecondaryButtonClass } from './ui'

const PAGE_SIZE = 20
interface Catalog { pois: MultiDayBuilderPoiOption[]; cities: MultiDayBuilderCityOption[] }

export function RoutePoiPicker({ routeSlug, stopIds, disabled, onSelect }: {
  routeSlug: string
  stopIds: string[]
  disabled: boolean
  onSelect: (poi: MultiDayBuilderPoiOption) => Promise<void>
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    setCatalog(null)
    setError('')
    const timeout = window.setTimeout(() => controller.abort(), 30000)
    async function load() {
      try {
        const response = await fetch('/api/admin/route-stops/pois', { method: attempt > 0 ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw Error(response.status === 401 || response.status === 403
          ? 'Сессия завершилась. Обновите страницу и войдите в админку.'
          : 'Не удалось загрузить список POI. Повторите попытку.')
        const data = await response.json() as Catalog
        if (!Array.isArray(data.pois) || !Array.isArray(data.cities)) throw Error('Не удалось прочитать список POI. Повторите попытку.')
        if (alive) setCatalog(data)
      } catch (cause) {
        if (alive) setError(controller.signal.aborted ? 'Загрузка POI заняла слишком много времени. Повторите попытку.'
          : cause instanceof Error ? cause.message : 'Не удалось загрузить список POI. Повторите попытку.')
      } finally { window.clearTimeout(timeout) }
    }
    void load()
    return () => { alive = false; controller.abort(); window.clearTimeout(timeout) }
  }, [attempt])

  const destinations = useMemo(() => catalog ? poiDestinations(catalog.pois, catalog.cities) : [], [catalog])
  const destination = selection ?? (catalog ? defaultPoiDestination(routeSlug, stopIds, catalog.pois) : '')
  const results = useMemo(() => catalog ? filterRoutePois(catalog.pois, query, destination, catalog.cities) : [], [catalog, query, destination])
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const added = new Set(stopIds)

  return <section aria-label="Добавить место в программу" className="mt-5 space-y-3 border-t border-[var(--adm-border)] pt-4">
    <h3 className="text-sm font-semibold text-[var(--adm-text)]">Добавить место</h3>
    {error ? <div role="alert" className="space-y-2 text-sm text-[var(--adm-danger-text)]">
      <p>{error}</p>
      <button type="button" className={adminSecondaryButtonClass} onClick={() => setAttempt(value => value + 1)}>Повторить загрузку</button>
    </div> : !catalog ? <p role="status" className="text-sm text-[var(--adm-text-2)]">Загружаю места…</p> : <>
      <label className="block space-y-1 text-sm text-[var(--adm-text-2)]">
        <span>Направление</span>
        <select className={adminInputClass} value={destination} onChange={event => { setSelection(event.target.value); setPage(1) }}>
          <option value="">Все направления</option>
          {destinations.map(item => <option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm text-[var(--adm-text-2)]">
        <span>Поиск POI</span>
        <input type="search" className={adminInputClass} value={query} placeholder="Название, тип места или POI ID"
          onChange={event => { setQuery(event.target.value); setPage(1) }}/>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--adm-text-2)]">
        <p role="status">Найдено: {results.length}</p>
        <button type="button" className="min-h-9 underline underline-offset-4" onClick={() => setAttempt(value => value + 1)}>Обновить список</button>
      </div>
      {results.length === 0 ? <div className="space-y-2 text-sm text-[var(--adm-text-2)]">
        <p>{destination ? 'В этом направлении совпадений нет.' : 'Совпадений нет. Попробуйте часть названия или POI ID.'}</p>
        {destination && <button type="button" className={adminSecondaryButtonClass} onClick={() => { setSelection(''); setPage(1) }}>Искать во всех направлениях</button>}
      </div> : <ul className="max-h-80 overflow-y-auto divide-y divide-[var(--adm-border)]">
        {results.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(poi => <li key={poi.poiId}>
          <button type="button" disabled={disabled || added.has(poi.poiId)} onClick={() => void onSelect(poi)}
            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm text-[var(--adm-text)] hover:bg-[var(--adm-hover)] focus-visible:outline-2 focus-visible:outline-[var(--adm-accent-border)] disabled:cursor-default disabled:text-[var(--adm-text-2)]">
            <span className="min-w-0 break-words"><span className="block">{poi.nameRu || poi.nameEn || poi.poiId}</span>
              <span className="block text-xs text-[var(--adm-text-2)]">{[poi.siteCity, poi.categoryRu, poi.poiId].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="shrink-0 text-xs">{added.has(poi.poiId) ? 'В программе' : 'Добавить'}</span>
          </button>
        </li>)}
      </ul>}
      {pages > 1 && <nav aria-label="Страницы найденных POI" className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" className={adminSecondaryButtonClass} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Назад</button>
        <span>{currentPage} / {pages}</span>
        <button type="button" className={adminSecondaryButtonClass} disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Далее</button>
      </nav>}
    </>}
  </section>
}
