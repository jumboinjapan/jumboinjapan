'use client'

import { useMemo, useState } from 'react'

import { HotelCard } from '@/components/sections/HotelCard'
import type { Hotel } from '@/lib/hotels-data'

const regionOptions = [
  { value: 'all', label: 'Все регионы' },
  { value: 'tokyo', label: 'Токио' },
  { value: 'kyoto', label: 'Киото' },
  { value: 'hakone', label: 'Хаконэ' },
  { value: 'fuji', label: 'Фудзи' },
  { value: 'yakushima', label: 'Якусима' },
] as const

const filterOptions = [
  { value: 'all', label: 'Все' },
  { value: 'luxury-center', label: '5★ Центр' },
  { value: 'luxury-other', label: '5★ Другие' },
  { value: 'premium', label: 'Премиум' },
  { value: 'economy-premium', label: 'Эконом' },
] as const

const tierLabels: Record<string, string> = {
  'luxury-center': '5★ Центр',
  'luxury-other': '5★ Другие районы',
  premium: 'Премиум',
  'economy-premium': 'Эконом Премиум',
}

const regionLabels: Record<string, string> = {
  tokyo: 'Токио',
  kyoto: 'Киото',
  hakone: 'Хаконэ',
  fuji: 'Фудзи',
  yakushima: 'Якусима',
}

export function HotelsExplorer({ hotels }: { hotels: Hotel[] }) {
  const [activeRegion, setActiveRegion] = useState<(typeof regionOptions)[number]['value']>('all')
  const [activeFilter, setActiveFilter] = useState<(typeof filterOptions)[number]['value']>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredHotels = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()

    return hotels.filter((hotel) => {
      const matchesRegion = activeRegion === 'all' || hotel.region === activeRegion
      const matchesTier = activeFilter === 'all' || hotel.tier === activeFilter
      const matchesSearch = hotel.name.toLowerCase().includes(normalizedQuery)

      return matchesRegion && matchesTier && matchesSearch
    })
  }, [activeFilter, activeRegion, hotels, searchQuery])

  return (
    <>
      <div className="space-y-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Поиск по названию отеля"
          className="h-11 w-full border border-[var(--text-muted)] bg-transparent px-4 text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--text)] focus:outline-none"
        />

        <div className="overflow-x-auto">
          <div className="flex min-w-max flex-nowrap gap-2 pb-1">
            {regionOptions.map((option) => {
              const isActive = option.value === activeRegion

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setActiveRegion(option.value)
                    setActiveFilter('all')
                    setSearchQuery('')
                  }}
                  className={`inline-flex min-h-11 shrink-0 items-center px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-[var(--text)] text-[var(--bg)]'
                      : 'border border-[var(--text)] text-[var(--text)] hover:bg-[var(--text)] hover:text-[var(--bg)]'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="flex min-w-max flex-nowrap gap-2 pb-1">
            {filterOptions.map((option) => {
              const isActive = option.value === activeFilter

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setActiveFilter(option.value)}
                  className={`inline-flex min-h-11 shrink-0 items-center px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-[var(--text)] text-[var(--bg)]'
                      : 'border border-[var(--text)] text-[var(--text)] hover:bg-[var(--text)] hover:text-[var(--bg)]'
                  }`}
                >
                  {option.label}
                </button>
              )}
            )}
          </div>
        </div>

        <p className="text-sm text-[var(--text-muted)]">
          Показано: {filteredHotels.length} из {hotels.length} отелей
        </p>
      </div>

      {filteredHotels.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredHotels.map((hotel) => (
            <HotelCard
              key={hotel.name}
              hotel={hotel}
              tierLabel={tierLabels[hotel.tier] ?? hotel.tier}
              regionLabel={regionLabels[hotel.region] ?? hotel.region}
            />
          ))}
        </div>
      ) : (
        <div className="border border-[var(--text-muted)] p-6 text-[var(--text-muted)]">
          По вашему запросу отели не найдены. Попробуйте изменить фильтр или текст поиска.
        </div>
      )}
    </>
  )
}
