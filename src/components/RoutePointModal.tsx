'use client'

import { useCallback, useEffect, type MouseEvent, type ReactNode } from 'react'

interface RoutePointModalMetaItem {
  label: string
  value: ReactNode
}

interface RoutePointModalProps {
  isOpen: boolean
  title: string
  eyebrow?: string | null
  kicker?: ReactNode
  description?: ReactNode
  meta?: RoutePointModalMetaItem[]
  onClose: () => void
  titleId: string
}

export function RoutePointModal({
  isOpen,
  title,
  eyebrow,
  kicker,
  description,
  meta = [],
  onClose,
  titleId,
}: RoutePointModalProps) {
  useEffect(() => {
    if (!isOpen) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleDialogClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }, [])

  if (!isOpen) return null

  const visibleMeta = meta.filter((item) => item.value != null)

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-[rgba(15,23,42,0.32)] backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={handleDialogClick}
          className="flex max-h-[min(88vh,920px)] w-full max-w-5xl flex-col overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)] shadow-[0_28px_90px_rgba(15,23,42,0.2)]"
        >
          <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
            <div className="flex items-center gap-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
                Точка маршрута
              </p>
              <span className="h-px w-16 bg-[var(--border)]" />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--surface)] hover:text-[var(--accent)]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="overflow-y-auto px-5 py-4 sm:px-6 sm:py-5 md:px-8 md:py-6">
            <div className="relative rounded-sm border border-[var(--border)] bg-[var(--bg)] px-4 py-4 sm:px-5 sm:py-5 md:px-7 md:py-7">
              <div aria-hidden="true" className="absolute left-0 top-0 h-full w-px bg-[var(--accent-soft)]" />

              <div className="grid gap-6 md:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.95fr)] md:gap-8">
                <div className="space-y-5 md:space-y-6">
                  <div className="space-y-3">
                    {(kicker || eyebrow) && (
                      <div className="flex items-center gap-3 pr-8">
                        {kicker}
                        {eyebrow && (
                          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
                            {eyebrow}
                          </p>
                        )}
                        <span className="h-px flex-1 bg-[var(--border)]" />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <h2
                        id={titleId}
                        className="text-pretty font-sans text-[26px] font-medium leading-[1.12] tracking-[-0.02em] text-[var(--text)] sm:text-[30px] md:text-[34px]"
                      >
                        {title}
                      </h2>
                    </div>
                  </div>

                  {description && (
                    <section className="space-y-3">
                      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        Описание
                      </p>
                      <div className="max-w-none text-pretty font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)] whitespace-pre-line md:text-[16px]">
                        {description}
                      </div>
                    </section>
                  )}
                </div>

                {visibleMeta.length > 0 && (
                  <aside className="h-fit rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 sm:px-4 md:sticky md:top-0 md:px-5 md:py-5">
                    <div className="space-y-4">
                      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        Практическая информация
                      </p>

                      {visibleMeta.map((item, index) => (
                        <div key={`${item.label}-${index}`} className="space-y-1.5 border-b border-[var(--border)] pb-4 last:border-b-0 last:pb-0">
                          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                            {item.label}
                          </p>
                          <div className="text-[13px] leading-[1.65] text-[var(--text)] sm:text-[14px]">
                            {item.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </aside>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
