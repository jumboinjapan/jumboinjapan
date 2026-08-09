/**
 * Запуск health-проверок и защита от самострела.
 *
 * Дэшборд проверяет всех провайдеров сразу при открытии страницы. Без ограды
 * это означало бы: обновил вкладку десять раз — десять серий запросов ко всем
 * провайдерам, часть из которых считает такие обращения платными и все —
 * лимитируемыми. Поэтому здесь есть короткий кэш результата и минимальный
 * интервал между принудительными проверками одного провайдера.
 *
 * Кэш живёт в памяти инстанса. На Vercel инстансы недолговечны — это осознанно:
 * кэш нужен только чтобы погасить всплеск обновлений подряд, а не хранить
 * историю. Историю проверок мы намеренно не ведём: это был бы ещё один поток
 * записи в Airtable ради данных, которые устаревают за минуту.
 */

import { PROBE_TIMEOUT_MS } from './probes'
import { findIntegration, INTEGRATIONS } from './registry'
import type { HealthResult, IntegrationDefinition } from './types'
import { isEnabled, resolveCredentials } from './vault'

const CACHE_TTL_MS = 30_000
const MIN_FORCED_INTERVAL_MS = 3_000

const cache = new Map<string, { at: number; result: HealthResult }>()

function unconfigured(id: string, detail: string): HealthResult {
  return { id, status: 'unconfigured', detail, latencyMs: null, models: [], checkedAt: new Date().toISOString() }
}

async function runProbe(definition: IntegrationDefinition): Promise<HealthResult> {
  const checkedAt = new Date().toISOString()

  if (!(await isEnabled(definition))) {
    return { id: definition.id, status: 'disabled', detail: 'Выключен в дэшборде', latencyMs: null, models: [], checkedAt }
  }

  const credentials = await resolveCredentials(definition)
  const missing = definition.fields.filter((field) => field.required && !credentials[field.key])
  if (missing.length > 0) {
    return unconfigured(definition.id, `Не заполнено: ${missing.map((field) => field.label).join(', ')}`)
  }

  const startedAt = Date.now()
  try {
    const probe = await definition.probe(credentials)
    return {
      id: definition.id,
      status: probe.status,
      detail: probe.detail,
      latencyMs: Date.now() - startedAt,
      models: probe.models ?? [],
      checkedAt,
    }
  } catch (error) {
    // Сюда попадают сетевые сбои и таймауты. Текст ошибки провайдера уже
    // очищен от секретов внутри пробы; здесь остаётся только имя ошибки —
    // сообщение сетевого слоя может содержать полный URL с токеном.
    const name = error instanceof Error ? error.name : 'UnknownError'
    const seconds = Math.round(PROBE_TIMEOUT_MS / 1000)
    const detail =
      name === 'AbortError'
        ? `Провайдер не ответил за ${seconds} секунд — и за столько же на повторной попытке`
        : `Сбой запроса (${name})`
    return { id: definition.id, status: 'error', detail, latencyMs: Date.now() - startedAt, models: [], checkedAt }
  }
}

/**
 * Проверка одного провайдера.
 * force=true игнорирует кэш, но не чаще одного раза в MIN_FORCED_INTERVAL_MS.
 */
export async function checkIntegration(id: string, force = false): Promise<HealthResult | null> {
  const definition = findIntegration(id)
  if (!definition) return null

  const cached = cache.get(id)
  const age = cached ? Date.now() - cached.at : Infinity

  if (cached && (force ? age < MIN_FORCED_INTERVAL_MS : age < CACHE_TTL_MS)) {
    return cached.result
  }

  const result = await runProbe(definition)
  cache.set(id, { at: Date.now(), result })
  return result
}

/** Проверка всех провайдеров разом — параллельно, одним запросом от браузера. */
export async function checkAllIntegrations(ids?: string[], force = false): Promise<HealthResult[]> {
  const targets = ids?.length
    ? INTEGRATIONS.filter((definition) => ids.includes(definition.id))
    : INTEGRATIONS

  return Promise.all(targets.map((definition) => checkIntegration(definition.id, force))).then((results) =>
    results.filter((result): result is HealthResult => result !== null),
  )
}
