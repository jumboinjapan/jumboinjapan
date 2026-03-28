'use client'

import { useEffect, useRef, useState } from 'react'
import type { Poi } from '@/types/poi'
import { PoiCard } from './PoiCard'

interface PoiCarouselProps {
  pois: Poi[]
  descriptionOverrides?: Record<string, string>
}

export function PoiCarousel({ pois, descriptionOverrides = {} }: PoiCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isPaused, setIsPaused] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container || pois.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const mediaQuery = window.matchMedia('(min-width: 768px)')

    const getStep = () => {
      const firstCard = container.querySelector<HTMLElement>('[data-poi-card]')
      if (!firstCard) return 0

      const styles = window.getComputedStyle(container)
      const gap = Number.parseFloat(styles.columnGap || styles.gap || '0')
      return firstCard.offsetWidth + gap
    }

    const tick = () => {
      if (isPaused || !mediaQuery.matches) return

      const step = getStep()
      if (!step) return

      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth)
      const nextScrollLeft = container.scrollLeft + step
      const targetLeft = nextScrollLeft >= maxScrollLeft - step * 0.35 ? 0 : nextScrollLeft

      container.scrollTo({
        left: targetLeft,
        behavior: 'smooth',
      })
    }

    const interval = window.setInterval(tick, 4500)

    return () => {
      window.clearInterval(interval)
    }
  }, [isPaused, pois.length])

  return (
    <div
      className="-mx-4 overflow-x-auto px-4 pb-3 md:mx-0 md:px-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      ref={containerRef}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
    >
      <div className="flex snap-x snap-mandatory gap-4 pr-4 md:gap-5 md:pr-0 md:snap-proximity">
        {pois.map((poi) => (
          <div
            key={poi.id}
            data-poi-card
            className="flex w-[82vw] min-w-0 shrink-0 snap-start md:w-[320px] lg:w-[340px]"
          >
            <PoiCard
              poi={poi}
              compact
              descriptionOverride={descriptionOverrides[poi.name_ru]}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
