'use client'

import type { ReactNode } from 'react'
import { StaticInfoCard } from '@/components/ui/info-card'

export interface PracticalInfoItem {
  label: string
  value: ReactNode
}

function isStringValue(value: ReactNode): value is string {
  return typeof value === 'string'
}

function getStructuredSegments(value: string) {
  return value
    .split(/\s*(?:\||;|·)\s*|\s*[\r\n]+\s*/u)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function shouldRenderAsBlock(value: ReactNode) {
  if (!isStringValue(value)) return true

  const segments = getStructuredSegments(value)
  if (segments.length > 1) return true

  return value.trim().length > 72
}

function renderStructuredValue(value: ReactNode) {
  if (!isStringValue(value)) return value

  const segments = getStructuredSegments(value)
  if (segments.length <= 1) return value

  return (
    <div className="space-y-1.5">
      {segments.map((segment, index) => (
        <p key={`${segment}-${index}`} className="text-[13px] leading-[1.6] text-[var(--text)] sm:text-[14px]">
          {segment}
        </p>
      ))}
    </div>
  )
}

function PracticalInfoTile({ item, compact = false }: { item: PracticalInfoItem; compact?: boolean }) {
  return (
    <StaticInfoCard
      muted
      rail="none"
      contentClassName={compact ? 'px-3 py-2.5 sm:px-3.5' : 'px-3.5 py-3 sm:px-4 sm:py-3.5'}
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {item.label}
      </p>
      <div
        className={[
          compact ? 'mt-1.5' : 'mt-2',
          'text-[13px] leading-[1.65] text-[var(--text)] whitespace-pre-line break-words sm:text-[14px]',
        ].join(' ')}
      >
        {renderStructuredValue(item.value)}
      </div>
    </StaticInfoCard>
  )
}

export function PracticalInfoList({
  items,
  variant = 'compact',
}: {
  items: PracticalInfoItem[]
  variant?: 'compact' | 'modal'
}) {
  const chipItems = variant === 'compact'
    ? items.filter((item) => !shouldRenderAsBlock(item.value))
    : []
  const blockItems = variant === 'compact'
    ? items.filter((item) => shouldRenderAsBlock(item.value))
    : items

  if (variant === 'modal') {
    return (
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {blockItems.map((item, index) => (
          <PracticalInfoTile key={`${item.label}-${index}`} item={item} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2 pt-1">
      {chipItems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chipItems.map((item, index) => (
            <StaticInfoCard
              key={`${item.label}-${index}`}
              muted
              rail="none"
              className="max-w-full rounded-full"
              contentClassName="inline-flex max-w-full items-start gap-2 px-3 py-1.5 text-[11px] leading-[1.4] text-[var(--text-muted)] sm:text-[12px]"
            >
              <span className="shrink-0 font-medium uppercase tracking-[0.08em] text-[var(--accent)]">
                {item.label}
              </span>
              <span className="min-w-0 whitespace-normal break-words">{item.value}</span>
            </StaticInfoCard>
          ))}
        </div>
      )}

      {blockItems.map((item, index) => (
        <PracticalInfoTile key={`${item.label}-${index}`} item={item} compact />
      ))}
    </div>
  )
}
