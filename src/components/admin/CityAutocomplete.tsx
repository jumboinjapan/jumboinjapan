'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface City { id: string; name: string; nameEn: string }

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
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setQuery(value)
  }, [value])

  const computeDropdownStyle = () => {
    if (!inputRef.current) return {}
    const rect = inputRef.current.getBoundingClientRect()
    const vv = window.visualViewport
    const offsetTop = vv ? vv.offsetTop : 0
    const offsetLeft = vv ? vv.offsetLeft : 0
    return {
      position: 'fixed' as const,
      top: rect.bottom + offsetTop + 4,
      left: rect.left + offsetLeft,
      minWidth: Math.max(rect.width, 180),
      zIndex: 9999,
    }
  }

  useEffect(() => {
    clearTimeout(timer.current)
    if (query.length < 1) {
      setResults([])
      setOpen(false)
      return
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/airtable/cities?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        if (data.length > 0) {
          setDropdownStyle(computeDropdownStyle())
          setResults(data)
          setOpen(true)
        } else {
          setResults([])
          setOpen(false)
        }
      } catch {
        setResults([])
        setOpen(false)
      }
    }, 300)
  }, [query])

  // close on outside pointer
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  const selectCity = (city: City) => {
    onChange(city.name)
    setQuery(city.name)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="flex items-center gap-1.5">
      {icon}
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange(e.target.value)
        }}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          'w-24 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white outline-none focus:border-sky-500/50 placeholder:text-slate-600',
          className
        )}
      />
      {open && results.length > 0 && (
        <ul
          style={dropdownStyle}
          className="overflow-hidden rounded-lg border border-white/10 bg-slate-900 shadow-2xl"
        >
          {results.map((city) => (
            <li
              key={city.id}
              onPointerDown={(e) => {
                e.preventDefault()
                selectCity(city)
              }}
              className="cursor-pointer px-3 py-2.5 text-sm text-white active:bg-white/20 hover:bg-white/10"
            >
              <span className="font-medium">{city.name}</span>
              {city.nameEn && (
                <span className="ml-1.5 text-xs text-slate-400">{city.nameEn}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
