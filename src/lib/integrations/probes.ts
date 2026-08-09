/**
 * Живые проверки провайдеров: жив ли ключ, что отвечает сервис, какие модели
 * доступны. Всё исполняется ТОЛЬКО на сервере — ключи в браузер не уходят.
 *
 * Три правила, общие для всех проб:
 *
 * 1. Таймаут обязателен. Зависший провайдер не должен вешать всю страницу
 *    дэшборда: через PROBE_TIMEOUT_MS проба возвращает честную ошибку.
 * 2. Секрет не должен утечь в текст ошибки. Часть API (Telegram) принимает
 *    токен прямо в URL, и этот URL попадает в сообщения об ошибках сети.
 *    Поэтому любой текст перед возвратом прогоняется через redact().
 * 3. Ошибка описывается по-русски и по делу: «401 — ключ отклонён» полезнее,
 *    чем стек-трейс, потому что читает это владелец, а не разработчик.
 */

import type { HealthProbeResult, IntegrationModel } from './types'

/**
 * Таймаут одной попытки. Функция проверки живёт 30 секунд (`maxDuration`
 * в health/route.ts), так что две попытки по 10 укладываются с запасом.
 *
 * Экспортируется намеренно: health.ts печатает это число владельцу, и
 * зашитая там строка «не ответил за 8 секунд» разъезжалась с константой
 * при первой же правке.
 */
export const PROBE_TIMEOUT_MS = 10_000
/** Сколько моделей показываем: у шлюзов их сотни, весь список бесполезен. */
const MODEL_LIMIT = 60

/** Вырезает значения секретов из любого текста, уходящего наружу. */
function redact(text: string, secrets: string[]): string {
  let result = text
  for (const secret of secrets) {
    if (secret && secret.length >= 8) result = result.split(secret).join('«секрет скрыт»')
  }
  return result
}

interface ProbeResponse {
  ok: boolean
  status: number
  json: unknown
  text: string
}

async function attempt(url: string, init: RequestInit): Promise<ProbeResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
    const text = await response.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return { ok: response.ok, status: response.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Одна повторная попытка на таймаут — и только на таймаут.
 *
 * Провайдер, задумавшийся на секунду дольше обычного, красил карточку
 * в ошибку, и владелец шёл проверять ключ, с которым всё в порядке.
 * Ложная тревога дороже лишних десяти секунд: после неё перестают верить
 * и настоящей. Второй таймаут подряд — уже показание, его и показываем.
 *
 * Отказ с кодом (401, 403, 429) не повторяем: ответ уже получен, и
 * повтор ничего не изменит, только потратит лимит провайдера.
 */
async function request(url: string, init: RequestInit = {}): Promise<ProbeResponse> {
  try {
    return await attempt(url, init)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return attempt(url, init)
    throw error
  }
}

/** Единая расшифровка кодов ответа — владелец видит причину, а не номер. */
function explainStatus(status: number, body: string): string {
  if (status === 401) return '401 — ключ отклонён (неверный или отозван)'
  if (status === 403) return '403 — ключ принят, но доступ к этому методу запрещён'
  if (status === 404) return '404 — метод не найден (проверьте адрес или версию API)'
  if (status === 429) return '429 — превышен лимит запросов'
  if (status >= 500) return `${status} — сбой на стороне провайдера`
  const snippet = body.trim().slice(0, 160)
  return snippet ? `${status} — ${snippet}` : `Код ответа ${status}`
}

function toModels(ids: Array<{ id: string; label?: string }>): IntegrationModel[] {
  return ids
    .filter((entry) => entry.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MODEL_LIMIT)
}

function fail(detail: string, secrets: string[]): HealthProbeResult {
  return { status: 'error', detail: redact(detail, secrets) }
}

// ─── Провайдеры моделей ──────────────────────────────────────────────────────

/** Общая форма ответа OpenAI-совместимых API: { data: [{ id }] }. */
async function probeOpenAiCompatible(
  url: string,
  apiKey: string,
  serviceName: string,
): Promise<HealthProbeResult> {
  const response = await request(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!response.ok) return fail(explainStatus(response.status, response.text), [apiKey])

  const data = (response.json as { data?: Array<{ id?: string }> } | null)?.data ?? []
  const models = toModels(data.map((entry) => ({ id: String(entry.id ?? '') })))
  return { status: 'ok', detail: `${serviceName} отвечает, моделей доступно: ${data.length}`, models }
}

export async function probeOpenAi(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const apiKey = credentials.apiKey ?? ''
  if (!apiKey) return fail('Ключ не задан', [])
  return probeOpenAiCompatible('https://api.openai.com/v1/models', apiKey, 'OpenAI')
}

export async function probeMistral(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const apiKey = credentials.apiKey ?? ''
  if (!apiKey) return fail('Ключ не задан', [])
  return probeOpenAiCompatible('https://api.mistral.ai/v1/models', apiKey, 'Mistral')
}

export async function probeGemini(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const apiKey = credentials.apiKey ?? ''
  if (!apiKey) return fail('Ключ не задан', [])

  // Ключ идёт заголовком, а не параметром ?key= — иначе он попал бы в текст
  // сетевых ошибок и в логи фронтэнда провайдера.
  const response = await request('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: { 'x-goog-api-key': apiKey },
  })
  if (!response.ok) return fail(explainStatus(response.status, response.text), [apiKey])

  const raw = (response.json as { models?: Array<{ name?: string; displayName?: string }> } | null)?.models ?? []
  const models = toModels(
    raw.map((entry) => ({
      id: String(entry.name ?? '').replace(/^models\//, ''),
      label: entry.displayName,
    })),
  )
  return { status: 'ok', detail: `Gemini отвечает, моделей доступно: ${raw.length}`, models }
}

export async function probeAnthropic(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const apiKey = credentials.apiKey ?? ''
  if (!apiKey) return fail('Ключ не задан', [])

  const response = await request('https://api.anthropic.com/v1/models?limit=100', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  })
  if (!response.ok) return fail(explainStatus(response.status, response.text), [apiKey])

  const raw = (response.json as { data?: Array<{ id?: string; display_name?: string }> } | null)?.data ?? []
  const models = toModels(raw.map((entry) => ({ id: String(entry.id ?? ''), label: entry.display_name })))
  return { status: 'ok', detail: `Anthropic отвечает, моделей доступно: ${raw.length}`, models }
}

export async function probeOpenRouter(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const apiKey = credentials.apiKey ?? ''
  if (!apiKey) return fail('Ключ не задан', [])

  // /key проверяет именно ключ и попутно отдаёт остаток кредитов —
  // /models у OpenRouter публичный и ключ бы не проверил.
  const keyResponse = await request('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!keyResponse.ok) return fail(explainStatus(keyResponse.status, keyResponse.text), [apiKey])

  const info = (keyResponse.json as { data?: { usage?: number; limit?: number | null } } | null)?.data
  const limit = info?.limit
  const usage = info?.usage
  const budget =
    typeof limit === 'number'
      ? `, израсходовано ${(usage ?? 0).toFixed(2)} из ${limit.toFixed(2)} $`
      : typeof usage === 'number'
        ? `, израсходовано ${usage.toFixed(2)} $ (лимит не задан)`
        : ''

  const modelsResponse = await request('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const raw = (modelsResponse.json as { data?: Array<{ id?: string; name?: string }> } | null)?.data ?? []
  const models = toModels(raw.map((entry) => ({ id: String(entry.id ?? ''), label: entry.name })))

  return { status: 'ok', detail: `Ключ действителен${budget}. Моделей в каталоге: ${raw.length}`, models }
}

// ─── Базовые сервисы ─────────────────────────────────────────────────────────

export async function probeAirtable(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const token = credentials.token ?? ''
  const baseId = credentials.baseId ?? ''
  if (!token || !baseId) return fail('Токен или идентификатор базы не заданы', [])

  const response = await request(`https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return fail(explainStatus(response.status, response.text), [token])

  const tables = (response.json as { tables?: Array<{ name?: string }> } | null)?.tables ?? []
  return {
    status: 'ok',
    detail: `База доступна, таблиц: ${tables.length}`,
    models: toModels(tables.map((table) => ({ id: String(table.name ?? '') }))),
  }
}

async function probeTelegramBot(token: string, expectWebhook: boolean): Promise<HealthProbeResult> {
  if (!token) return fail('Токен бота не задан', [])

  const response = await request(`https://api.telegram.org/bot${token}/getMe`)
  if (!response.ok) return fail(explainStatus(response.status, response.text), [token])

  const me = (response.json as { result?: { username?: string } } | null)?.result
  let detail = `Бот @${me?.username ?? 'без имени'} отвечает`

  if (expectWebhook) {
    const hook = await request(`https://api.telegram.org/bot${token}/getWebhookInfo`)
    const info = (hook.json as {
      result?: { url?: string; pending_update_count?: number; last_error_message?: string }
    } | null)?.result

    if (!info?.url) {
      detail += '. Вебхук не привязан — приём сообщений выключен'
      return { status: 'error', detail: redact(detail, [token]) }
    }
    detail += `. Вебхук: ${info.url}`
    if (info.pending_update_count) detail += `, в очереди ${info.pending_update_count}`
    if (info.last_error_message) detail += `, последняя ошибка: ${info.last_error_message}`
  }

  return { status: 'ok', detail: redact(detail, [token]) }
}

export async function probeTelegramNotify(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const result = await probeTelegramBot(credentials.botToken ?? '', false)
  if (result.status === 'ok' && !credentials.ownerChatId) {
    return { status: 'error', detail: `${result.detail}, но чат владельца не задан — уведомления никуда не уйдут` }
  }
  return result
}

export async function probeTelegramPoi(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const result = await probeTelegramBot(credentials.botToken ?? '', true)
  if (result.status === 'ok' && !credentials.webhookSecret) {
    return { status: 'error', detail: `${result.detail}, но секрет вебхука не задан — приём не защищён` }
  }
  return result
}

export async function probeGoogleOAuth(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const missing = [
    !credentials.clientId && 'GOOGLE_CLIENT_ID',
    !credentials.clientSecret && 'GOOGLE_CLIENT_SECRET',
    !credentials.authSecret && 'ADMIN_AUTH_SECRET',
    !credentials.allowedEmails && 'ADMIN_ALLOWED_EMAILS',
  ].filter(Boolean) as string[]

  if (missing.length > 0) return fail(`Не заданы переменные: ${missing.join(', ')}`, [])

  // Проверяем доступность самого Google, а не пару client_id/secret: обмен
  // кода на токен без реального входа пользователя выполнить нельзя.
  const response = await request('https://accounts.google.com/.well-known/openid-configuration')
  if (!response.ok) return fail(`Google не отвечает: ${explainStatus(response.status, response.text)}`, [])

  const admins = credentials.allowedEmails.split(',').filter((email) => email.trim()).length
  return { status: 'ok', detail: `Настроено полностью, вход разрешён ${admins} адресу(ам)` }
}

export async function probeRecaptcha(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const secret = credentials.secretKey ?? ''
  if (!secret) return fail('Секретный ключ не задан', [])

  // siteverify с заведомо негодным токеном — законный способ проверить именно
  // ключ: Google отвечает invalid-input-response, если ключ верен, и
  // invalid-input-secret, если нет.
  const response = await request('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: 'health-check' }).toString(),
  })
  if (!response.ok) return fail(explainStatus(response.status, response.text), [secret])

  const codes = (response.json as { 'error-codes'?: string[] } | null)?.['error-codes'] ?? []
  if (codes.includes('invalid-input-secret')) return fail('Google отклонил секретный ключ', [secret])
  if (!credentials.siteKey) {
    return { status: 'error', detail: 'Секретный ключ принят, но публичный ключ сайта не задан' }
  }
  return { status: 'ok', detail: 'Секретный ключ принят Google' }
}

export async function probeGooglePlaces(credentials: Record<string, string>): Promise<HealthProbeResult> {
  const apiKey = credentials.apiKey ?? ''
  if (!apiKey) return fail('Ключ не задан', [])

  // Маска полей — только `places.id`. Это не экономия ради экономии: у Places
  // цена запроса зависит от того, какие поля запрошены, и запрос одного лишь
  // идентификатора попадает в бесплатный тариф. Проверка здоровья не должна
  // стоить денег — иначе её перестанут нажимать.
  const response = await request('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id',
    },
    body: JSON.stringify({ textQuery: 'Tokyo Station', languageCode: 'en', maxResultCount: 1 }),
  })

  if (!response.ok) {
    // Google различает три разные беды одним кодом 403, и владельцу важно,
    // какая именно: включить API, снять ограничение или подключить биллинг —
    // это три разных действия в трёх разных местах консоли.
    const message = String(
      (response.json as { error?: { message?: string } } | null)?.error?.message ?? response.text,
    )
    if (/API key not valid|API_KEY_INVALID/i.test(message)) {
      return fail('Ключ отклонён — Google его не признаёт', [apiKey])
    }
    if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(message)) {
      return fail('Ключ верен, но Places API (New) не включён в проекте', [apiKey])
    }
    if (/API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED|referer|blocked/i.test(message)) {
      return fail('Ключ верен, но ограничения по адресу не пускают сервер сайта', [apiKey])
    }
    if (/billing/i.test(message)) {
      return fail('Ключ верен, но к проекту не подключён биллинг', [apiKey])
    }
    return fail(explainStatus(response.status, message), [apiKey])
  }

  const places = (response.json as { places?: Array<{ id?: string }> } | null)?.places ?? []
  if (!places.length) {
    return { status: 'error', detail: 'Запрос прошёл, но Google не вернул ни одного места — проверьте ограничения ключа' }
  }
  return { status: 'ok', detail: 'Ключ действителен, Places API (New) отвечает' }
}
