type PreviewVariantFlagProps = {
  label?: string
}

export function PreviewVariantFlag({ label = 'Vercel Preview · не live' }: PreviewVariantFlagProps) {
  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:px-6">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{label}</p>
        <p className="text-[12px] font-light text-[var(--text-muted)]">Временная ветка для проверки структуры. Не production.</p>
      </div>
    </div>
  )
}
