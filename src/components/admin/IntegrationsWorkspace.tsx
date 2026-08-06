'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'

import { AdminShell } from './AdminShell'
import {
  adminDangerButtonClass,
  adminInputClass,
  adminInsetClass,
  adminPanelClass,
  adminPrimaryButtonClass,
  adminSecondaryButtonClass,
  SectionTitle,
  StatusChip,
  type ChipTone,
} from './ui'
import { cn } from '@/lib/utils'
import type { HealthResult, IntegrationCategory, IntegrationStatus, VaultState } from '@/lib/integrations/types'

/**
 * Дэшборд внешних API.
 *
 * Что здесь важно с точки зрения безопасности — и почему так:
 *
 * 1. Секретов в этом компоненте нет и быть не может. Сервер отдаёт только
 *    маски (sk-proj-…4f2a). Поле ввода секрета всегда пустое: пустой ввод
 *    означает «оставить как есть», а не «стереть».
 * 2. Провайдеры с envOnly формы не имеют вовсе — им показывается список
 *    переменных окружения. Ключи базовой обвязки правятся только в Vercel.
 * 3. Проверки идут одним POST на все карточки, а не запросом на карточку:
 *    иначе открытие страницы жгло бы лимиты провайдеров десятком запросов.
 */

const CATEGORY_TITLES: Record<IntegrationCategory, string> = {
  llm: 'Модели',
  core: 'Базовые сервисы',
  magicbox: 'Magic Box',
}

const CATEGORY_NOTES: Record<IntegrationCategory, string> = {
  llm: 'Ключи вводятся здесь и хранятся зашифрованными. Переменная окружения, если она задана, имеет приоритет.',
  core: 'Обвязка, без которой сайт не работает. Ключи живут только в переменных окружения Vercel — дэшборд их показывает, но не меняет.',
  magicbox: 'Песочница для новых API. Скажите в чате, какой сервис подключить, — здесь появится готовый блок с полями входа.',
}

const CATEGORY_ORDER: IntegrationCategory[] = ['llm', 'core', 'magicbox']

interface ListResponse {
  ok: boolean
  providers?: IntegrationStatus[]
  vault?: VaultState
  error?: string
}

interface HealthResponse {
  ok: boolean
  results?: HealthResult[]
  error?: string
}

function healthTone(status: HealthResult['status'] | undefined): { tone: ChipTone; label: string } {
  switch (status) {
    case 'ok':
      return { tone: 'success', label: 'Работает' }
    case 'error':
      return { tone: 'danger', label: 'Ошибка' }
    case 'unconfigured':
      return { tone: 'neutral', label: 'Не настроен' }
    case 'disabled':
      return { tone: 'warning', label: 'Выключен' }
    default:
      return { tone: 'neutral', label: 'Не проверялся' }
  }
}

function sourceLabel(source: string): string {
  if (source === 'env') return 'из окружения'
  if (source === 'vault') return 'из сейфа'
  return 'не задано'
}

export function IntegrationsWorkspace() {
  const [providers, setProviders] = useState<IntegrationStatus[]>([])
  const [vault, setVault] = useState<VaultState | null>(null)
  const [health, setHealth] = useState<Record<string, HealthResult>>({})
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const loadProviders = useCallback(async () => {
    const response = await fetch('/api/admin/integrations', { cache: 'no-store' })
    const data = (await response.json()) as ListResponse
    if (!data.ok || !data.providers) throw new Error(data.error ?? 'Список интеграций не пришёл')
    setProviders(data.providers)
    setVault(data.vault ?? null)
  }, [])

  const runHealth = useCallback(async (ids?: string[], force = false) => {
    setChecking(true)
    try {
      const response = await fetch('/api/admin/integrations/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, force }),
      })
      const data = (await response.json()) as HealthResponse
      if (!data.ok || !data.results) throw new Error(data.error ?? 'Проверка не выполнилась')
      setHealth((previous) => {
        const next = { ...previous }
        for (const result of data.results ?? []) next[result.id] = result
        return next
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await loadProviders()
        if (!cancelled) await runHealth()
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadProviders, runHealth])

  const grouped = useMemo(() => {
    const map = new Map<IntegrationCategory, IntegrationStatus[]>()
    for (const category of CATEGORY_ORDER) map.set(category, [])
    for (const provider of providers) map.get(provider.category)?.push(provider)
    return map
  }, [providers])

  const summary = useMemo(() => {
    const values = providers.map((provider) => health[provider.id]?.status)
    return {
      ok: values.filter((status) => status === 'ok').length,
      broken: values.filter((status) => status === 'error').length,
      idle: values.filter((status) => status === 'unconfigured' || status === 'disabled').length,
    }
  }, [providers, health])

  async function handleSaved(updated: IntegrationStatus) {
    setProviders((previous) => previous.map((provider) => (provider.id === updated.id ? updated : provider)))
    await runHealth([updated.id], true)
  }

  return (
    <AdminShell
      currentPath="/admin/integrations"
      title="Внешние API"
      subtitle="Подключение и состояние сервисов за периметром сайта: провайдеры моделей, базовая обвязка, песочница."
      actions={
        <button type="button" onClick={() => void runHealth(undefined, true)} disabled={checking} className={adminSecondaryButtonClass}>
          {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Проверить всё
        </button>
      }
    >
      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--adm-text-3)]">Загружаю состояние интеграций…</p>
      ) : (
        <div className="space-y-8 pt-4">
          {error && (
            <div className="rounded-2xl border border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] px-5 py-4 text-sm text-[var(--adm-danger-text)]">
              {error}
            </div>
          )}

          <VaultBanner vault={vault} />

          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--adm-text-3)]">
            <StatusChip tone="success">Работают: {summary.ok}</StatusChip>
            <StatusChip tone={summary.broken > 0 ? 'danger' : 'neutral'}>С ошибкой: {summary.broken}</StatusChip>
            <StatusChip tone="neutral">Не подключены: {summary.idle}</StatusChip>
          </div>

          {CATEGORY_ORDER.map((category) => {
            const items = grouped.get(category) ?? []
            if (items.length === 0) return null

            return (
              <section key={category}>
                <SectionTitle className="mb-1">{CATEGORY_TITLES[category]}</SectionTitle>
                <p className="mb-4 max-w-3xl text-xs leading-relaxed text-[var(--adm-text-3)]">{CATEGORY_NOTES[category]}</p>
                <div className="grid gap-4 xl:grid-cols-2">
                  {items.map((provider) => (
                    <IntegrationCard
                      key={provider.id}
                      provider={provider}
                      health={health[provider.id]}
                      vault={vault}
                      expanded={openId === provider.id}
                      onToggle={() => setOpenId(openId === provider.id ? null : provider.id)}
                      onCheck={() => void runHealth([provider.id], true)}
                      onSaved={handleSaved}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </AdminShell>
  )
}

function VaultBanner({ vault }: { vault: VaultState | null }) {
  if (!vault) return null

  const problems: string[] = []
  if (!vault.airtableConfigured) problems.push('не настроен доступ к Airtable (AIRTABLE_TOKEN / AIRTABLE_BASE_ID)')
  if (!vault.secretConfigured)
    problems.push('не задан мастер-ключ INTEGRATIONS_SECRET — без него ключи провайдеров сохранять некуда')
  if (vault.tableMissing) problems.push('таблица Integrations в базе Airtable недоступна')

  if (problems.length === 0) {
    return (
      <div className={cn(adminPanelClass, 'flex items-start gap-3 px-5 py-4')}>
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--adm-ok-text)]" />
        <p className="text-sm text-[var(--adm-text-2)]">
          Сейф работает. Ключи шифруются мастер-ключом из переменных окружения и хранятся в Airtable уже
          зашифрованными — выгрузка базы их не раскроет. Переменная окружения, если задана, всегда важнее сейфа.
        </p>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] px-5 py-4">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--adm-warn-text)]" />
      <div className="text-sm text-[var(--adm-warn-text)]">
        <p className="font-medium">Сейф не готов — ключи можно только смотреть, но не сохранять:</p>
        <ul className="mt-1.5 list-inside list-disc space-y-0.5">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

interface CardProps {
  provider: IntegrationStatus
  health?: HealthResult
  vault: VaultState | null
  expanded: boolean
  onToggle: () => void
  onCheck: () => void
  onSaved: (updated: IntegrationStatus) => Promise<void>
}

function IntegrationCard({ provider, health, vault, expanded, onToggle, onCheck, onSaved }: CardProps) {
  const { tone, label } = healthTone(health?.status)
  const models = health?.models ?? []
  const modelField = provider.fields.find((field) => field.isModelField)
  const activeModel = modelField?.value ?? ''

  return (
    <div className={cn(adminPanelClass, 'flex flex-col gap-3 px-5 py-4')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--adm-text)]">{provider.name}</h3>
            <StatusChip tone={tone}>{label}</StatusChip>
            {provider.envOnly && <StatusChip tone="info">только окружение</StatusChip>}
            {health?.latencyMs !== null && health?.latencyMs !== undefined && (
              <span className="text-xs text-[var(--adm-text-3)]">{health.latencyMs} мс</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--adm-text-3)]">{provider.summary}</p>
        </div>
        <button
          type="button"
          onClick={onCheck}
          className="shrink-0 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-hover)] p-2 text-[var(--adm-text-3)] transition hover:text-[var(--adm-text)]"
          aria-label={`Проверить ${provider.name}`}
          title="Проверить сейчас"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {health?.detail && (
        <p
          className={cn(
            'text-xs leading-relaxed',
            health.status === 'error' ? 'text-[var(--adm-danger-text)]' : 'text-[var(--adm-text-2)]',
          )}
        >
          {health.detail}
        </p>
      )}

      <div className={cn(adminInsetClass, 'px-3.5 py-3')}>
        <div className="space-y-1.5">
          {provider.fields.map((field) => (
            <div key={field.key} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-[var(--adm-text-3)]">{field.label}</span>
              <span className="truncate text-right text-[var(--adm-text-2)]">
                {field.secret
                  ? field.masked || '—'
                  : field.value || '—'}
                <span className="ml-2 text-[var(--adm-text-3)]">{sourceLabel(field.source)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {models.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs text-[var(--adm-text-3)]">
            Доступные модели: {models.length}
            {activeModel ? ` · по умолчанию ${activeModel}` : ''}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {models.slice(0, 8).map((model) => (
              <span
                key={model.id}
                title={model.label ?? model.id}
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]',
                  model.id === activeModel
                    ? 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]'
                    : 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-3)]',
                )}
              >
                {model.id}
              </span>
            ))}
            {models.length > 8 && <span className="text-[11px] text-[var(--adm-text-3)]">и ещё {models.length - 8}</span>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onToggle} className={adminSecondaryButtonClass}>
          <KeyRound className="size-3.5" />
          {expanded ? 'Свернуть' : provider.envOnly ? 'Показать переменные' : 'Настроить'}
        </button>
        {provider.consoleUrl && (
          <a
            href={provider.consoleUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--adm-text-3)] transition hover:text-[var(--adm-text)]"
          >
            <ExternalLink className="size-3" />
            Где взять ключ
          </a>
        )}
        {provider.docsUrl && (
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--adm-text-3)] transition hover:text-[var(--adm-text)]"
          >
            <ExternalLink className="size-3" />
            Документация
          </a>
        )}
        {provider.updatedAt && (
          <span className="ml-auto text-[11px] text-[var(--adm-text-3)]">
            изменено {new Date(provider.updatedAt).toLocaleDateString('ru-RU')}
            {provider.updatedBy ? ` · ${provider.updatedBy}` : ''}
          </span>
        )}
      </div>

      {expanded &&
        (provider.envOnly ? (
          <EnvOnlyPanel provider={provider} />
        ) : (
          <IntegrationForm provider={provider} models={models} vault={vault} onSaved={onSaved} />
        ))}
    </div>
  )
}

function EnvOnlyPanel({ provider }: { provider: IntegrationStatus }) {
  return (
    <div className={cn(adminInsetClass, 'space-y-3 px-4 py-4')}>
      <p className="text-xs leading-relaxed text-[var(--adm-text-2)]">
        Этот сервис настраивается только переменными окружения проекта в Vercel — дэшборд их не хранит и не меняет.
        После правки переменных нужен повторный деплой (Redeploy без кэша сборки).
      </p>
      <div className="space-y-1.5">
        {provider.fields.map((field) => (
          <div key={field.key} className="flex items-baseline justify-between gap-3 text-xs">
            <code className="font-mono text-[var(--adm-text)]">{field.envVar ?? field.key}</code>
            <span className={field.configured ? 'text-[var(--adm-ok-text)]' : 'text-[var(--adm-danger-text)]'}>
              {field.configured ? 'задана' : 'не задана'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface FormProps {
  provider: IntegrationStatus
  models: Array<{ id: string; label?: string }>
  vault: VaultState | null
  onSaved: (updated: IntegrationStatus) => Promise<void>
}

function IntegrationForm({ provider, models, vault, onSaved }: FormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of provider.fields) initial[field.key] = field.secret ? '' : (field.value ?? '')
    return initial
  })
  const [enabled, setEnabled] = useState(provider.enabled)
  const [notes, setNotes] = useState(provider.notes)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const vaultReady = Boolean(vault?.secretConfigured && vault?.airtableConfigured && !vault?.tableMissing)

  async function submit() {
    setBusy(true)
    setMessage('')
    try {
      // Поля, значение которых приходит из переменной окружения, в сейф не
      // отправляем вовсе. Иначе открытая настройка (модель, id базы) молча
      // скопировалась бы из окружения в Airtable, и после удаления переменной
      // сайт продолжил бы работать на её тени из сейфа.
      const payload: Record<string, string> = {}
      for (const field of provider.fields) {
        if (field.source === 'env') continue
        payload[field.key] = values[field.key] ?? ''
      }

      const response = await fetch(`/api/admin/integrations/${provider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: payload, enabled, notes }),
      })
      const data = (await response.json()) as { ok: boolean; provider?: IntegrationStatus; error?: string }
      if (!data.ok || !data.provider) throw new Error(data.error ?? 'Не удалось сохранить')

      // Секретные поля очищаем: их значение теперь в сейфе, а показывать
      // введённое дальше незачем.
      setValues((previous) => {
        const next = { ...previous }
        for (const field of provider.fields) if (field.secret) next[field.key] = ''
        return next
      })
      setMessage('Сохранено')
      await onSaved(data.provider)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function wipe() {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/integrations/${provider.id}`, { method: 'DELETE' })
      const data = (await response.json()) as { ok: boolean; provider?: IntegrationStatus; error?: string }
      if (!data.ok || !data.provider) throw new Error(data.error ?? 'Не удалось стереть')
      setValues((previous) => {
        const next = { ...previous }
        for (const field of provider.fields) next[field.key] = ''
        return next
      })
      setEnabled(false)
      setMessage('Учётные данные стёрты')
      await onSaved(data.provider)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn(adminInsetClass, 'space-y-4 px-4 py-4')}>
      {!vaultReady && (
        <p className="text-xs text-[var(--adm-warn-text)]">
          Сейф не готов — сохранение не сработает. Что именно не так, написано в рамке вверху страницы.
        </p>
      )}

      {provider.fields.map((field) => {
        const fromEnv = field.source === 'env'
        const listId = `${provider.id}-${field.key}-models`

        return (
          <div key={field.key} className="space-y-1.5">
            <label htmlFor={`${provider.id}-${field.key}`} className="flex flex-wrap items-center gap-2 text-xs text-[var(--adm-text-2)]">
              {field.label}
              {field.required && <span className="text-[var(--adm-text-3)]">обязательно</span>}
              {field.envVar && <code className="font-mono text-[11px] text-[var(--adm-text-3)]">{field.envVar}</code>}
            </label>

            <input
              id={`${provider.id}-${field.key}`}
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              disabled={fromEnv || busy}
              list={field.isModelField && models.length > 0 ? listId : undefined}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues((previous) => ({ ...previous, [field.key]: event.target.value }))}
              placeholder={
                fromEnv
                  ? 'задано переменной окружения'
                  : field.secret && field.masked
                    ? `сохранено ${field.masked} — введите новый ключ, чтобы заменить`
                    : (field.placeholder ?? '')
              }
              className={cn(adminInputClass, fromEnv && 'cursor-not-allowed opacity-60')}
            />

            {field.isModelField && models.length > 0 && (
              <datalist id={listId}>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label ?? model.id}
                  </option>
                ))}
              </datalist>
            )}

            {fromEnv ? (
              <p className="text-[11px] text-[var(--adm-text-3)]">
                Значение приходит из переменной окружения {field.envVar} и важнее сейфа. Чтобы править отсюда — уберите
                переменную в Vercel.
              </p>
            ) : (
              field.hint && <p className="text-[11px] text-[var(--adm-text-3)]">{field.hint}</p>
            )}
          </div>
        )
      })}

      <div className="space-y-1.5">
        <label htmlFor={`${provider.id}-notes`} className="text-xs text-[var(--adm-text-2)]">
          Заметка для себя
        </label>
        <textarea
          id={`${provider.id}-notes`}
          rows={2}
          value={notes}
          disabled={busy}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="На каком аккаунте заведён ключ, какой тариф, что проверить при сбое"
          className={adminInputClass}
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-[var(--adm-text-2)]">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} />
        Провайдер включён
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void submit()} disabled={busy || !vaultReady} className={adminPrimaryButtonClass}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Сохранить
        </button>
        <button type="button" onClick={() => void wipe()} disabled={busy} className={adminDangerButtonClass}>
          <Trash2 className="size-3.5" />
          Стереть ключи
        </button>
        {message && <span className="text-xs text-[var(--adm-text-2)]">{message}</span>}
      </div>
    </div>
  )
}
