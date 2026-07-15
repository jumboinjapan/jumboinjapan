'use client'

import { useEffect, useState } from 'react'
import { Bot, RefreshCw } from 'lucide-react'

/**
 * Подключение POI-бота одной кнопкой (2026-07-11).
 *
 * Владелец шлёт боту фото таблички/скан/пару строк — агент заводит черновик
 * POI. Чтобы бот начал получать сообщения, Telegram нужно один раз сообщить
 * адрес сервера. Раньше это был curl с токеном в терминале; теперь — кнопка:
 * сервер берёт токен и секрет из переменных окружения сам.
 *
 * Кнопка привязывает бота к ТОМУ адресу, где нажата: на превью-деплое — к
 * превью (можно безопасно тестировать), в проде — к боевому сайту.
 */
interface WebhookStatus {
  ok: boolean
  currentUrl: string
  expectedUrl: string
  pending: number
  lastError: string
  secretConfigured: boolean
  error?: string
}

export function TelegramBotSetup() {
  const [status, setStatus] = useState<WebhookStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function loadStatus() {
    try {
      const response = await fetch('/api/admin/telegram/setup', { cache: 'no-store' })
      const data = (await response.json()) as WebhookStatus
      setStatus(data)
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  async function handleConnect() {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/telegram/setup', { method: 'POST' })
      const data = (await response.json()) as { ok: boolean; url?: string; error?: string }
      setMessage(
        data.ok
          ? 'Бот подключён. Напишите ему в Telegram — пришлите фото таблички или пару строк о месте.'
          : `Не удалось подключить: ${data.error ?? 'неизвестная ошибка'}`,
      )
      await loadStatus()
    } catch (error) {
      setMessage(`Не удалось подключить: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const connectedHere = Boolean(status?.currentUrl && status.currentUrl === status.expectedUrl)

  return (
    <div className="mt-4 rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Bot className="size-4 text-[var(--adm-text-3)]" />
          <div>
            <div className="text-sm font-medium text-[var(--adm-text)]">POI-бот: приём новых точек из Telegram</div>
            <div className="text-xs text-[var(--adm-text-3)]">
              {connectedHere
                ? `Подключён${status && status.pending > 0 ? ` · в очереди: ${status.pending}` : ''}`
                : status?.currentUrl
                  ? 'Подключён к другому адресу — нажмите, чтобы привязать к этому'
                  : 'Не подключён'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadStatus}
            className="rounded-lg border border-[var(--adm-border)] bg-[var(--adm-hover)] p-2 text-[var(--adm-text-3)] transition hover:text-[var(--adm-text)]"
            aria-label="Обновить статус"
          >
            <RefreshCw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy}
            className="rounded-lg bg-[var(--adm-gold)] px-4 py-2 text-sm font-medium text-[var(--adm-on-gold)] transition hover:bg-[var(--adm-gold-hover)] disabled:opacity-50"
          >
            {busy ? 'Подключаю…' : connectedHere ? 'Переподключить' : 'Подключить бота'}
          </button>
        </div>
      </div>

      {status?.lastError ? (
        <p className="mt-2 text-xs text-[var(--adm-danger-text)]">Последняя ошибка Telegram: {status.lastError}</p>
      ) : null}
      {message ? <p className="mt-2 text-xs text-[var(--adm-text-2)]">{message}</p> : null}
    </div>
  )
}
