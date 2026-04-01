import type { ReactNode } from 'react'
import clsx from 'clsx'

interface InfoCardFrameProps {
  children: ReactNode
  className?: string
  contentClassName?: string
  selected?: boolean
  interactive?: boolean
  muted?: boolean
  rail?: 'default' | 'accent' | 'none'
}

interface InteractiveInfoCardProps extends InfoCardFrameProps {
  onClick: () => void
  controls?: string
  expanded?: boolean
}

export function StaticInfoCard({
  children,
  className,
  contentClassName,
  muted = false,
  rail = 'default',
}: InfoCardFrameProps) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-sm border border-[var(--border)]',
        muted ? 'bg-[var(--bg)]' : 'bg-[var(--surface)]',
        className,
      )}
    >
      {rail !== 'none' && (
        <div
          aria-hidden="true"
          className={clsx(
            'absolute left-0 top-0 h-full w-px',
            rail === 'accent' ? 'bg-[var(--accent-soft)]' : 'bg-[var(--border)]',
          )}
        />
      )}
      <div className={contentClassName}>{children}</div>
    </div>
  )
}

export function InteractiveInfoCard({
  children,
  className,
  contentClassName,
  onClick,
  controls,
  expanded,
  selected = false,
  muted = false,
  rail = 'default',
}: InteractiveInfoCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-controls={controls}
      className={clsx(
        'group relative overflow-hidden rounded-sm border border-[var(--border)] text-left transition-all duration-200',
        muted ? 'bg-[var(--bg)]' : 'bg-[var(--surface)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-warm)]',
        'active:scale-[0.99] hover:-translate-y-0.5 hover:border-[var(--accent-soft)] hover:bg-[var(--bg)]',
        selected && 'border-[var(--accent-soft)] bg-[var(--bg)]',
        className,
      )}
    >
      {rail !== 'none' && (
        <div
          aria-hidden="true"
          className={clsx(
            'absolute left-0 top-0 h-full w-px transition-colors duration-200',
            rail === 'accent' ? 'bg-[var(--accent-soft)]' : 'bg-[var(--border)] group-hover:bg-[var(--accent-soft)]',
          )}
        />
      )}
      <div className={contentClassName}>{children}</div>
    </button>
  )
}

export function InfoCardHeader({ eyebrow, aside }: { eyebrow?: ReactNode; aside?: ReactNode }) {
  if (!eyebrow && !aside) return null

  return (
    <div className="flex items-center gap-3">
      {eyebrow ? (
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
          {eyebrow}
        </p>
      ) : null}
      {aside}
      <span className="h-px flex-1 bg-[var(--border)]" />
    </div>
  )
}

export function InfoCardTitleBlock({
  title,
  description,
  titleClassName,
  descriptionClassName,
}: {
  title: ReactNode
  description?: ReactNode
  titleClassName?: string
  descriptionClassName?: string
}) {
  return (
    <div className="space-y-1.5">
      <p
        className={clsx(
          'max-w-full text-pretty font-sans text-[17px] font-medium leading-[1.22] tracking-[-0.015em] text-[var(--text)] sm:text-[19px]',
          titleClassName,
        )}
      >
        {title}
      </p>
      {description ? (
        <p
          className={clsx(
            'max-w-full text-pretty font-sans text-[14px] leading-[1.58] text-[var(--text-muted)] sm:text-[15px]',
            descriptionClassName,
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  )
}

export function InfoCardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2', className)}>{children}</div>
}
