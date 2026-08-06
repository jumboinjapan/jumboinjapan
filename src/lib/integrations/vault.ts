/**
 * Сейф учётных данных внешних API.
 *
 * Где что лежит:
 *   секреты (ключи, токены)  → Airtable, таблица Integrations, поле Secrets,
 *                              зашифрованные мастер-ключом из окружения;
 *   открытые настройки       → та же строка, поле Config, обычный JSON;
 *   базовые сервисы          → только переменные окружения (`envOnly`).
 *
 * ПРИОРИТЕТ: переменная окружения ВСЕГДА перекрывает сейф. Это гарантирует,
 * что существующие ключи (OPENAI_API_KEY, AIRTABLE_TOKEN и прочие) продолжают
 * работать ровно как раньше, а дэшборд их только показывает. Обратный порядок
 * означал бы, что запись в админке молча меняет поведение прода — недопустимо.
 *
 * Наружу из этого модуля секреты не уходят: браузеру отдаётся только
 * `describeIntegration()` с масками. Расшифрованные значения доступны лишь
 * серверному коду через `resolveCredentials()`.
 */

import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { INTEGRATIONS_TABLE_NAME } from '@/lib/airtable-schema'
import { decryptSecrets, encryptSecrets, isVaultSecretConfigured, maskSecret } from './crypto'
import type {
  IntegrationDefinition,
  IntegrationFieldStatus,
  IntegrationStatus,
  VaultState,
} from './types'

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface VaultEntry {
  recordId: string
  secrets: Record<string, string>
  config: Record<string, string>
  enabled: boolean
  notes: string
  updatedAt: string
  updatedBy: string
}

function getCredentials() {
  return {
    token: process.env.AIRTABLE_TOKEN?.trim() ?? '',
    baseId: process.env.AIRTABLE_BASE_ID?.trim() ?? '',
  }
}

function buildUrl(baseId: string, recordId?: string) {
  const base = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(INTEGRATIONS_TABLE_NAME)}`
  return recordId ? `${base}/${recordId}` : base
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseConfig(raw: string): Record<string, string> {
  if (!raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') result[key] = value
    }
    return result
  } catch {
    console.error('[integrations] Config не разобрался как JSON — считаем пустым')
    return {}
  }
}

// ─── Чтение ──────────────────────────────────────────────────────────────────

/**
 * Таблица Integrations могла быть не создана (свежий клон, другая база).
 * Это не ошибка приложения: дэшборд обязан открыться и объяснить, что делать,
 * поэтому состояние запоминается и отдаётся в UI, а не бросается исключением.
 */
let tableMissing = false

/**
 * Кэш на один инстанс. Живёт секунды: health-проверка всех провайдеров сразу
 * иначе делала бы отдельный поход в Airtable на каждого, упираясь в лимит 5 rps.
 */
const CACHE_TTL_MS = 15_000
let cache: { at: number; entries: Map<string, VaultEntry> } | null = null

async function loadAll(): Promise<Map<string, VaultEntry>> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.entries

  const entries = new Map<string, VaultEntry>()
  const { token, baseId } = getCredentials()
  if (!token || !baseId) return entries

  const response = await fetchAirtableWithRetry(`${buildUrl(baseId)}?pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  if (response.status === 404 || response.status === 403) {
    tableMissing = true
    console.error(`[integrations] таблица ${INTEGRATIONS_TABLE_NAME} недоступна: ${response.status}`)
    return entries
  }
  if (!response.ok) {
    throw new Error(`Airtable read failed for ${INTEGRATIONS_TABLE_NAME}: ${response.status}`)
  }

  tableMissing = false
  const data = (await response.json()) as { records?: AirtableRecord[] }

  for (const record of data.records ?? []) {
    const providerId = str(record.fields['Provider ID']).trim()
    if (!providerId) continue
    entries.set(providerId, {
      recordId: record.id,
      secrets: await decryptSecrets(providerId, str(record.fields['Secrets'])),
      config: parseConfig(str(record.fields['Config'])),
      // Airtable опускает снятый checkbox — отсутствие поля у существующей
      // строки означает «выключено».
      enabled: record.fields['Enabled'] === true,
      notes: str(record.fields['Notes']),
      updatedAt: str(record.fields['Updated At']),
      updatedBy: str(record.fields['Updated By']),
    })
  }

  cache = { at: now, entries }
  return entries
}

export function invalidateVaultCache() {
  cache = null
}

export function getVaultState(): VaultState {
  const { token, baseId } = getCredentials()
  return {
    secretConfigured: isVaultSecretConfigured(),
    tableMissing,
    airtableConfigured: Boolean(token && baseId),
  }
}

// ─── Разрешение значений (env выигрывает у сейфа) ────────────────────────────

function envValue(name: string | undefined): string {
  if (!name) return ''
  return process.env[name]?.trim() ?? ''
}

/**
 * Реальные значения для серверного вызова провайдера. Секреты в открытом виде —
 * результат нельзя отдавать в браузер и нельзя писать в логи.
 */
export async function resolveCredentials(definition: IntegrationDefinition): Promise<Record<string, string>> {
  const entry = definition.envOnly ? undefined : (await loadAll()).get(definition.id)
  const resolved: Record<string, string> = {}

  for (const field of definition.fields) {
    const fromEnv = envValue(field.envVar)
    if (fromEnv) {
      resolved[field.key] = fromEnv
      continue
    }
    const stored = field.secret ? entry?.secrets[field.key] : entry?.config[field.key]
    if (stored) resolved[field.key] = stored
  }

  return resolved
}

/** Провайдер выключен владельцем в дэшборде. Для env-only всегда включён. */
export async function isEnabled(definition: IntegrationDefinition): Promise<boolean> {
  if (definition.envOnly) return true
  const entry = (await loadAll()).get(definition.id)
  // Нет строки — провайдер ещё не настраивали: считаем включённым, чтобы
  // сохранение ключа сразу заработало без второго действия.
  return entry ? entry.enabled : true
}

// ─── Безопасное описание для интерфейса ──────────────────────────────────────

export async function describeIntegration(definition: IntegrationDefinition): Promise<IntegrationStatus> {
  const entry = definition.envOnly ? undefined : (await loadAll()).get(definition.id)

  const fields: IntegrationFieldStatus[] = definition.fields.map((field) => {
    const fromEnv = envValue(field.envVar)
    const stored = field.secret ? entry?.secrets[field.key] : entry?.config[field.key]
    const value = fromEnv || stored || ''
    const source = fromEnv ? 'env' : stored ? 'vault' : 'none'

    return {
      key: field.key,
      label: field.label,
      secret: field.secret,
      required: field.required,
      placeholder: field.placeholder,
      hint: field.hint,
      envVar: field.envVar,
      isModelField: field.isModelField,
      configured: Boolean(value),
      source,
      masked: field.secret ? maskSecret(value) : '',
      // Открытые настройки показываем целиком — иначе владелец не увидит,
      // какая модель или база сейчас выбрана.
      value: field.secret ? undefined : value,
    }
  })

  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    summary: definition.summary,
    docsUrl: definition.docsUrl,
    consoleUrl: definition.consoleUrl,
    envOnly: Boolean(definition.envOnly),
    fields,
    ready: fields.every((field) => !field.required || field.configured),
    enabled: definition.envOnly ? true : entry ? entry.enabled : true,
    notes: entry?.notes ?? '',
    updatedAt: entry?.updatedAt ?? '',
    updatedBy: entry?.updatedBy ?? '',
  }
}

// ─── Запись ──────────────────────────────────────────────────────────────────

export interface SaveIntegrationInput {
  definition: IntegrationDefinition
  /**
   * Значения полей из формы.
   *   строка непустая → записать;
   *   '' или поля нет → НЕ трогать (владелец не вводил новый секрет);
   *   null            → удалить значение.
   */
  values: Record<string, string | null>
  enabled?: boolean
  notes?: string
  updatedBy: string
}

export async function saveIntegration(input: SaveIntegrationInput): Promise<void> {
  const { definition, values, enabled, notes, updatedBy } = input

  if (definition.envOnly) {
    throw new Error(`Провайдер ${definition.id} настраивается только переменными окружения`)
  }
  if (!isVaultSecretConfigured()) {
    throw new Error('INTEGRATIONS_SECRET не задан — сохранять ключи некуда')
  }

  const { token, baseId } = getCredentials()
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN и AIRTABLE_BASE_ID обязательны для сейфа интеграций')
  }

  // Читаем базу заново, а не из кэша: сохранение — частичное (мы сливаем
  // введённое с уже лежащим), и запись поверх пятнадцатисекундного кэша
  // воскресила бы значения, стёртые из другой вкладки или другого инстанса.
  invalidateVaultCache()
  const entries = await loadAll()
  const existing = entries.get(definition.id)

  const secrets: Record<string, string> = { ...(existing?.secrets ?? {}) }
  const config: Record<string, string> = { ...(existing?.config ?? {}) }

  for (const field of definition.fields) {
    if (!(field.key in values)) continue
    const value = values[field.key]
    const target = field.secret ? secrets : config

    if (value === null) {
      delete target[field.key]
      continue
    }
    const trimmed = value.trim()
    // Пустая строка в секретном поле = «оставить как есть»: форма не может
    // показать текущий секрет, поэтому пустой ввод не должен его стирать.
    // Для открытых полей пустая строка — законное «очистить».
    if (!trimmed && field.secret) continue
    if (!trimmed) {
      delete target[field.key]
      continue
    }
    target[field.key] = trimmed
  }

  const fields: Record<string, unknown> = {
    'Provider ID': definition.id,
    Secrets: Object.keys(secrets).length > 0 ? await encryptSecrets(definition.id, secrets) : '',
    Config: Object.keys(config).length > 0 ? JSON.stringify(config, null, 2) : '',
    'Updated At': new Date().toISOString(),
    'Updated By': updatedBy,
  }
  if (typeof enabled === 'boolean') fields['Enabled'] = enabled
  else if (!existing) fields['Enabled'] = true
  if (typeof notes === 'string') fields['Notes'] = notes

  const response = existing
    ? await fetchAirtableWithRetry(buildUrl(baseId, existing.recordId), {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
    : await fetchAirtableWithRetry(buildUrl(baseId), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields }] }),
      })

  if (!response.ok) {
    // Тело ответа Airtable не логируем целиком: в PATCH уходил шифротекст.
    throw new Error(`Airtable write failed for ${INTEGRATIONS_TABLE_NAME}: ${response.status}`)
  }

  invalidateVaultCache()
}

/** Полное отключение провайдера: стереть все учётные данные и снять галку. */
export async function clearIntegration(definition: IntegrationDefinition, updatedBy: string): Promise<void> {
  if (definition.envOnly) {
    throw new Error(`Провайдер ${definition.id} настраивается только переменными окружения`)
  }

  const { token, baseId } = getCredentials()
  if (!token || !baseId) throw new Error('AIRTABLE_TOKEN и AIRTABLE_BASE_ID обязательны для сейфа интеграций')

  invalidateVaultCache()
  const existing = (await loadAll()).get(definition.id)
  if (!existing) return

  const response = await fetchAirtableWithRetry(buildUrl(baseId, existing.recordId), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        Secrets: '',
        Config: '',
        Enabled: false,
        'Updated At': new Date().toISOString(),
        'Updated By': updatedBy,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Airtable clear failed for ${INTEGRATIONS_TABLE_NAME}: ${response.status}`)
  }

  invalidateVaultCache()
}
