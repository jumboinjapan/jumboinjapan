'use client'

import { Check, Link2 } from 'lucide-react'
import { useState } from 'react'

import { adminSecondaryButtonClass } from './ui'
import { cn } from '@/lib/utils'

/**
 * Кнопка «скопировать ссылку» для админ-поверхностей.
 * `compact` — иконка для строк списков (клик не проваливается в строку).
 */
export function CopyLinkButton({
  text,
  label,
  copiedLabel = 'Скопировано ✓',
  compact = false,
  title,
}: {
  text: string
  label?: string
  copiedLabel?: string
  compact?: boolean
  title?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Скопируйте ссылку вручную:', text)
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={copy}
        title={title ?? 'Скопировать ссылку на опросник'}
        aria-label={title ?? 'Скопировать ссылку на опросник'}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-full border transition',
          copied
            ? 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]'
            : 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-3)] hover:border-[var(--adm-border-strong)] hover:text-[var(--adm-text)]',
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
      </button>
    )
  }

  return (
    <button type="button" onClick={copy} title={title} className={adminSecondaryButtonClass}>
      {copied ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
      {copied ? copiedLabel : label}
    </button>
  )
}
