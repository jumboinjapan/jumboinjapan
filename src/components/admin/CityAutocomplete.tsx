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

  // Поиск запускается ТОЛЬКО из onChange инпута (реальный ввод пользователем),
  // не из эффекта синхронизации query<-value выше. Раньше поиск жил в
  // отдельном useEffect, слушающем [query] — он срабатывал и когда query
  // менялся программно (маунт компонента, смена value снаружи при выборе
  // города в другом поле и т.п.), из-за чего подсказка с текущим городом
  // сама выскакивала под полем без единого нажатия клавиши — выглядело как
  // «зависшая» плашка, дублирующая то, что и так написано в поле.
  const runSearch = (nextQuery: string) => {
    clearTimeout(timer.current)
    if (nextQuery.length < 1) {
      setResults([])
      setOpen(false)
      return
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/airtable/cities?q=${encodeURIComponent(nextQuery)}`)
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
  }

  useEffect(() => () => clearTimeout(timer.current), [])

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

  // Дропдаун — position: fixed, координаты считаются один раз в момент
  // открытия. При скролле страницы (а карточки дней — длинная страница)
  // инпут уезжает вместе с контентом, а зависший дропдаун остаётся на
  // месте — выглядит как «прилипшие» плашки поверх других дней. Закрываем
  // при любом скролле — самый надёжный вариант, без пересчёта позиции на
  // каждый кадр.
  useEffect(() => {
    if (!open) return
    const handleScroll = () => setOpen(false)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', handleScroll, { capture: true })
  }, [open])

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
          const next = e.target.value
          setQuery(next)
          onChange(next)
          runSearch(next)
        }}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          'w-24 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-hover)] px-2 py-1.5 text-xs text-[var(--adm-text)] outline-none focus:border-[var(--adm-accent-border)] placeholder:text-[var(--adm-text-3)]',
          className
        )}
      />
      {open && results.length > 0 && (
        <ul
          style={dropdownStyle}
          className="overflow-hidden rounded-lg border border-[var(--adm-border)] bg-[var(--adm-popover)] shadow-2xl"
        >
          {results.map((city) => (
            <li
              key={city.id}
              onPointerDown={(e) => {
                e.preventDefault()
                selectCity(city)
              }}
              className="cursor-pointer px-3 py-2.5 text-sm text-[var(--adm-text)] active:bg-[var(--adm-active)] hover:bg-[var(--adm-active)]"
            >
              <span className="font-medium">{city.name}</span>
              {city.nameEn && (
                <span className="ml-1.5 text-xs text-[var(--adm-text-3)]">{city.nameEn}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
