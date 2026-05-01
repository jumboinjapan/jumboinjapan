'use client'

import { useCallback, useEffect, type MouseEvent, type ReactNode } from 'react'
import { PracticalInfoList, type PracticalInfoItem } from '@/components/PracticalInfoList'
import { InfoCardHeader, StaticInfoCard } from '@/components/ui/info-card'
import type { SellingHighlight } from '@/lib/intercity-pois'

type RoutePointModalMetaItem = PracticalInfoItem

export interface RoutePointModalCopy {
  dialogLabel?: string
  closeLabel?: string
  descriptionLabel?: string
  practicalInfoLabel?: string
  sellingHighlightsLabel?: string
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
  copy?: RoutePointModalCopy
  sellingHighlights?: SellingHighlight[]
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
  copy,
  sellingHighlights,
}: RoutePointModalProps) {
  const labels = {
    dialogLabel: 'Точка маршрута',
    closeLabel: 'Закрыть',
    descriptionLabel: 'Описание',
    practicalInfoLabel: 'Практическая информация',
    sellingHighlightsLabel: 'Рядом и внутри',
    ...copy,
  }
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
                {labels.dialogLabel}
              </p>
              <span className="h-px w-16 bg-[var(--border)]" />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={labels.closeLabel}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--surface)] hover:text-[var(--accent)]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="overflow-y-auto px-5 py-4 sm:px-6 sm:py-5 md:px-8 md:py-6">
            <StaticInfoCard rail="accent" muted contentClassName="space-y-5 px-4 py-4 sm:px-5 sm:py-5 md:px-7 md:py-7">
              <div className="space-y-2.5">
                {(kicker || eyebrow) && <InfoCardHeader eyebrow={eyebrow} aside={kicker} />}

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
                <section className="space-y-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {labels.descriptionLabel}
                  </p>
                  <div className="w-full text-pretty font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)] whitespace-pre-line md:text-[16px]">
                    {description}
                  </div>
                </section>
              )}
            </StaticInfoCard>

            {visibleMeta.length > 0 && (
              <aside className="mt-4 space-y-4 border-t border-[var(--border)] bg-[var(--surface)] px-1 pt-4 sm:mt-5 sm:pt-5 md:px-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {labels.practicalInfoLabel}
                </p>

                <PracticalInfoList items={visibleMeta} variant="modal" />
              </aside>
            )}

            {sellingHighlights && sellingHighlights.length > 0 && (
              <aside className="mt-4 space-y-4 border-t border-[var(--border)] bg-[var(--surface)] px-1 pt-4 sm:mt-5 sm:pt-5 md:px-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {labels.sellingHighlightsLabel}
                </p>
                <div className="space-y-4">
                  {sellingHighlights.map((h, index) => (
                    <div key={index} className="space-y-1">
                      <p className="font-sans text-[15px] font-medium text-[var(--text)]">
                        {h.title}
                      </p>
                      <p className="font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
                        {h.body}
                      </p>
                    </div>
                  ))}
                </div>
              </aside>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
