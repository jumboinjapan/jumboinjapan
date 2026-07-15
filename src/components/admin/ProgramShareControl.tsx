'use client'

/**
 * Управление публичной «живой» ссылкой на программу (2026-07-16).
 *
 * Гость получает адрес jumboinjapan.com/p/<token> вместо PDF-вложения. На
 * странице нет ПД (кодовое имя вместо клиента), ссылка живёт до конца дня
 * отъезда и физически стирается после. Здесь владелец: включает/копирует
 * ссылку, правит кодовое имя, меняет ссылку (при утечке) и отключает (отмена).
 */

import { useEffect, useState } from 'react'

import { adminInputClass, adminPanelClass, adminPrimaryButtonClass, adminSecondaryButtonClass } from '@/components/admin/ui'
import { cn } from '@/lib/utils'

interface ShareState {
  enabled: boolean
  token: string
  url: string
  label: string
  resolvedCodename: string
  expiresAt: string | null
  expired: boolean
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'без срока (пока не заданы даты тура) — отключите вручную'
  const date = new Date(iso)
  return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })} (конец дня отъезда, по Японии)`
}

export function ProgramShareControl({ slug }: { slug: string }) {
  const [state, setState] = useState<ShareState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  function applyState(next: ShareState) {
    setState(next)
    setLabelDraft(next.label)
  }

  useEffect(() => {
    fetch(`/api/admin/print/share?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data: { state?: ShareState; error?: string }) => {
        if (data.state) applyState(data.state)
        else setToast({ type: 'err', msg: data.error || 'Не удалось загрузить' })
      })
      .catch(() => setToast({ type: 'err', msg: 'Не удалось загрузить' }))
      .finally(() => setLoading(false))
  }, [slug])

  async function act(action: 'enable' | 'rotate' | 'disable') {
    setBusy(true)
    setToast(null)
    try {
      const res = await fetch('/api/admin/print/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, action }),
      })
      const data = (await res.json()) as { ok?: boolean; state?: ShareState; error?: string }
      if (!res.ok || !data.ok || !data.state) throw new Error(data.error || 'Ошибка')
      applyState(data.state)
      setToast({
        type: 'ok',
        msg: action === 'enable' ? 'Ссылка включена' : action === 'rotate' ? 'Ссылка сменена — старая больше не работает' : 'Ссылка отключена',
      })
    } catch (error) {
      setToast({ type: 'err', msg: error instanceof Error ? error.message : 'Ошибка' })
    } finally {
      setBusy(false)
    }
  }

  async function saveLabel() {
    setBusy(true)
    setToast(null)
    try {
      const res = await fetch('/api/admin/print/share', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, label: labelDraft }),
      })
      const data = (await res.json()) as { ok?: boolean; state?: ShareState; error?: string }
      if (!res.ok || !data.ok || !data.state) throw new Error(data.error || 'Ошибка')
      applyState(data.state)
      setToast({ type: 'ok', msg: 'Кодовое имя сохранено' })
    } catch (error) {
      setToast({ type: 'err', msg: error instanceof Error ? error.message : 'Ошибка' })
    } finally {
      setBusy(false)
    }
  }

  async function copyUrl() {
    if (!state?.url) return
    try {
      await navigator.clipboard.writeText(state.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setToast({ type: 'err', msg: 'Не удалось скопировать — выделите ссылку вручную' })
    }
  }

  if (loading) return <p className="text-sm text-[var(--adm-text-3)]">Загрузка…</p>

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--adm-text)]">Ссылка на программу для гостя</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--adm-text-3)]">
          Живая страница на вашем домене вместо PDF-вложения: гость видит актуальную версию и может скачать PDF. На
          странице нет персональных данных — только кодовое имя. Маршрут: <span className="text-[var(--adm-text-2)]">{slug}</span>
        </p>
      </div>

      {toast && (
        <div
          className={cn(
            'rounded-lg border px-4 py-2.5 text-sm',
            toast.type === 'ok'
              ? 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]'
              : 'border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]',
          )}
        >
          {toast.msg}
        </div>
      )}

      {!state?.enabled ? (
        <div className={cn(adminPanelClass, 'p-5')}>
          <p className="text-sm text-[var(--adm-text-2)]">Ссылка выключена. Включите, чтобы получить адрес для отправки гостю.</p>
          <button type="button" onClick={() => act('enable')} disabled={busy} className={cn(adminPrimaryButtonClass, 'mt-4')}>
            Включить ссылку
          </button>
        </div>
      ) : (
        <>
          <div className={cn(adminPanelClass, 'p-5')}>
            <span className="mb-1.5 block text-xs text-[var(--adm-text-3)]">Публичный адрес</span>
            <div className="flex items-center gap-2">
              <input readOnly value={state.url} className={cn(adminInputClass, 'font-mono text-xs')} onFocus={(e) => e.target.select()} />
              <button type="button" onClick={copyUrl} className={cn(adminSecondaryButtonClass, 'shrink-0')}>
                {copied ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
            <p className="mt-3 text-xs text-[var(--adm-text-3)]">
              Срок: {formatExpiry(state.expiresAt)}
              {state.expired && <span className="text-[var(--adm-danger-text)]"> · срок вышел, ссылка не открывается</span>}
            </p>
          </div>

          <div className={cn(adminPanelClass, 'p-5')}>
            <span className="mb-1.5 block text-xs text-[var(--adm-text-3)]">Кодовое имя на странице</span>
            <div className="flex items-center gap-2">
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                placeholder={state.resolvedCodename}
                className={adminInputClass}
              />
              <button type="button" onClick={saveLabel} disabled={busy} className={cn(adminSecondaryButtonClass, 'shrink-0')}>
                Сохранить
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--adm-text-3)]">
              Пусто — подставляется из анкеты клиента (Group Name). Сейчас гость увидит: «{state.resolvedCodename}»
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => act('rotate')} disabled={busy} className={adminSecondaryButtonClass}>
              Сменить ссылку
            </button>
            <button
              type="button"
              onClick={() => act('disable')}
              disabled={busy}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] px-4 text-sm text-[var(--adm-danger-text)] transition"
            >
              Отключить (отмена поездки)
            </button>
            <a href={state.url} target="_blank" rel="noreferrer" className="text-sm text-[var(--adm-accent-text)] hover:underline">
              Открыть как гость ↗
            </a>
          </div>
        </>
      )}
    </div>
  )
}
