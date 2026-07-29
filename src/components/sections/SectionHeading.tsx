import { typoDeep } from '@/lib/typography'

export function SectionHeading(props: { eyebrow: string; title: string; description?: string }) {
  const { eyebrow, title, description } = typoDeep(props)

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">{eyebrow}</p>
        <span aria-hidden="true" className="h-px w-14 bg-[var(--border)]" />
      </div>
      <div className="space-y-2">
        <h2 className="text-title text-[var(--text)] md:text-section">
          {title}
        </h2>
        {description ? (
          <p className="max-w-3xl font-sans text-body-sm font-light leading-[1.85] text-[var(--text-muted)] md:text-body">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}
