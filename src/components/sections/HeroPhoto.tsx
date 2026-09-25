'use client'

import Image from 'next/image'
import { useEffect, useRef } from 'react'
import styles from './HeroPhoto.module.css'

/** The caption stays in the parent figure; only the image moves. */
export function HeroPhoto({ src, alt, objectPosition = 'center' }: { src: string; alt: string; objectPosition?: string }) {
  const frame = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Supported browsers use a CSS timeline attached to the stationary frame.
    if (CSS.supports('animation-timeline: view()')) return
    const element = frame.current
    const movingLayer = layer.current
    if (!element || !movingLayer) return

    const desktop = window.matchMedia('(min-width: 768px)')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = false
    let raf = 0
    let lastOffset: number | undefined
    const eligible = () => desktop.matches && !reduceMotion.matches && !document.hidden
    const stop = () => { cancelAnimationFrame(raf); raf = 0 }
    const tick = () => {
      raf = 0
      if (!visible || !eligible()) return
      const rect = element.getBoundingClientRect()
      const progress = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / (window.innerHeight + rect.height)))
      const offset = -4 + progress * 10
      if (offset !== lastOffset) {
        movingLayer.style.transform = `translateY(${offset}%)`
        lastOffset = offset
      }
      // One loop while visible, no scroll listeners or React state updates.
      raf = requestAnimationFrame(tick)
    }
    const sync = () => {
      stop()
      if (!eligible()) {
        movingLayer.style.removeProperty('transform')
        lastOffset = undefined
      } else if (visible) raf = requestAnimationFrame(tick)
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() })
    observer.observe(element)
    desktop.addEventListener('change', sync)
    reduceMotion.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      stop()
      observer.disconnect()
      desktop.removeEventListener('change', sync)
      reduceMotion.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
      movingLayer.style.removeProperty('transform')
    }
  }, [])

  return <div ref={frame} className={styles.frame} data-hero-photo>
    <div ref={layer} className={styles.layer}>
      <Image src={src} alt={alt} fill priority quality={90} style={{ objectPosition }} sizes="(max-width: 899px) calc(100vw - 40px), (max-width: 1199px) 46vw, 528px" className={styles.image} />
    </div>
  </div>
}
