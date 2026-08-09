'use client'

import { useEffect, useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Сброс кэша публичного сайта.
 *
 * Кнопка общая для всего сайта — она сбрасывает routes, pois, resources и
 * journal разом. Раньше она стояла в шапке одного экрана («Описание маршрутов»),
 * из-за чего читалась как «обновить этот маршрут» и была недоступна оттуда,
 * где чаще всего нужна: после правок прямо в Airtable.
 *
 * Сохранение через панель сбрасывает кэш само — эта кнопка нужна для правок
 * в обход панели.
 */
export function RevalidateSiteButton() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  useEffect(() => {
    if (state !== 'done' && state !== 'error') return
    const timeout = window.setTimeout(() => setState('idle'), 2500)
    return () => window.clearTimeout(timeout)
  }, [state])

  async function run() {
    if (state === 'busy') return
    setState('busy')
    try {
      const response = await fetch('/api/admin/revalidate', { method: 'POST' })
      setState(response.ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  const title =
    state === 'done'
      ? 'Кэш сброшен — правки видны на сайте'
      : state === 'error'
        ? 'Не удалось сбросить кэш'
        : 'Обновить кэш сайта — для правок, внесённых прямо в Airtable'

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={state === 'busy'}
      aria-label="Обновить кэш сайта"
      title={title}
      className={cn(
        'flex size-9 items-center justify-center rounded-full border transition-all active:scale-95',
        state === 'done'
          ? 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]'
          : state === 'error'
            ? 'border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]'
            : 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-2)] hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)]',
      )}
    >
      {state === 'done' ? (
        <Check className="size-4" />
      ) : (
        <RefreshCw className={cn('size-4', state === 'busy' && 'animate-spin')} />
      )}
    </button>
  )
}
