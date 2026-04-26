'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface City {
  id: string
  name: string
  nameEn: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  icon?: React.ReactNode
}

export function CityAutocomplete({ value, onChange, placeholder, className, icon }: Props) {
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState<City[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const ref = useRef<HTMLDivElement>(null)

  // sync external value
  useEffect(() => {
    setQuery(value)
  }, [value])

  // debounced search
  useEffect(() => {
    clearTimeout(timer.current)
    if (query.length < 1) {
      setResults([])
      setOpen(false)
      return
    }
    setLoading(true)
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/airtable/cities?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      setResults(data)
      setOpen(data.length > 0)
      setLoading(false)
    }, 250)
  }, [query])

  // close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      {icon}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            onChange(e.target.value)
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true)
          }}
          placeholder={placeholder}
          className={cn(
            'w-24 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white outline-none focus:border-sky-500/50 placeholder:text-slate-600',
            className
          )}
        />
        {open && (
          <ul className="absolute left-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-slate-900 shadow-xl">
            {results.map((city) => (
              <li
                key={city.id}
                onMouseDown={() => {
                  onChange(city.name)
                  setQuery(city.name)
                  setOpen(false)
                }}
                className="cursor-pointer px-3 py-2 text-xs text-white hover:bg-white/10"
              >
                <span className="font-medium">{city.name}</span>
                {city.nameEn && <span className="ml-1 text-slate-500">{city.nameEn}</span>}
              </li>
            ))}
          </ul>
        )}
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]">…</span>
        )}
      </div>
    </div>
  )
}
