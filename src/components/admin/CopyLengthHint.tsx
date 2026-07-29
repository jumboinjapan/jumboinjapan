'use client'

import { checkCopyLength, type CopyRole } from '@/lib/copy-limits'
import { cn } from '@/lib/utils'

/**
 * Счётчик длины с предупреждением. Ставится рядом с полем ввода в админке.
 *
 * Показывает не просто число знаков, а отношение к пределу роли и — когда
 * предел перейдён — что именно сломается. Пределы и их обоснование живут в
 * src/lib/copy-limits.ts, здесь только вывод.
 *
 * Порог намеренно мягкий: «комфортно» предупреждает, но не мешает. Жёстко
 * подсвечивается только выход за предел, после которого блок ломается.
 */
export function CopyLengthHint({
  role,
  value,
  className,
}: {
  role: CopyRole
  value: string
  className?: string
}) {
  const check = checkCopyLength(role, value)

  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={check.message ?? `${check.label}: комфортно до ${check.ideal} знаков, предел ${check.max}`}
    >
      <span
        className={cn(
          'tabular-nums',
          check.status === 'over' && 'font-medium text-[var(--adm-danger,#b3261e)]',
          check.status === 'warn' && 'text-[var(--adm-warning,#8a6100)]',
        )}
      >
        {check.length}/{check.ideal}
      </span>
      {check.status !== 'ok' ? (
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-1.5 w-1.5 rounded-full',
            check.status === 'over' ? 'bg-[var(--adm-danger,#b3261e)]' : 'bg-[var(--adm-warning,#8a6100)]',
          )}
        />
      ) : null}
      <span className="sr-only">{check.message ?? 'длина в норме'}</span>
    </span>
  )
}

/**
 * Развёрнутое предупреждение под полем — для случаев, когда счётчика мало:
 * заголовок карточки или шапка раздела, где перелёт ломает сетку.
 */
export function CopyLengthNotice({ role, value }: { role: CopyRole; value: string }) {
  const check = checkCopyLength(role, value)
  if (!check.message) return null

  return (
    <p
      className={cn(
        'mt-1 text-xs leading-snug',
        check.status === 'over' ? 'text-[var(--adm-danger,#b3261e)]' : 'text-[var(--adm-text-3)]',
      )}
    >
      {check.message}
    </p>
  )
}
