/**
 * Общие типы дэшборда внешних API (/admin/integrations).
 *
 * Реестр провайдеров декларативный: чтобы завести новый API, достаточно
 * добавить одно описание в registry.ts — UI, сохранение учётных данных,
 * health-проверка и маскирование секретов работают дальше сами.
 * Процедура целиком: docs/integrations.md
 */

export type IntegrationCategory = 'llm' | 'core' | 'magicbox'

/**
 * Одно поле формы подключения.
 *
 * secret=true  → значение шифруется, наружу уходит ТОЛЬКО маска (sk-…f3a2),
 *                поле в форме write-only: пустой ввод = «не менять».
 * secret=false → открытая настройка (модель, base id, список адресов).
 *                Хранится в поле Config открытым текстом и показывается целиком.
 */
export interface IntegrationField {
  key: string
  label: string
  secret: boolean
  required: boolean
  placeholder?: string
  hint?: string
  /** Переменная окружения, которая ПЕРЕКРЫВАЕТ значение из сейфа. */
  envVar?: string
  /** Поле хранит имя модели по умолчанию — UI предложит выбор из живого списка. */
  isModelField?: boolean
}

export interface IntegrationModel {
  id: string
  label?: string
}

/** Результат живой проверки — то, что провайдер ответил прямо сейчас. */
export interface HealthProbeResult {
  status: 'ok' | 'error'
  /** Человекочитаемая строка для владельца. Секретов содержать не может. */
  detail: string
  models?: IntegrationModel[]
}

export interface IntegrationDefinition {
  id: string
  name: string
  category: IntegrationCategory
  summary: string
  docsUrl?: string
  /** Куда идти владельцу за ключом. */
  consoleUrl?: string
  /**
   * true = ключи ЖИВУТ ТОЛЬКО в переменных окружения, сейф не используется.
   *
   * Так помечены базовые сервисы. Причины конкретные, не вкусовые:
   * Airtable — сам сейф лежит в Airtable, хранить его ключ там же нельзя;
   * Google OAuth — ADMIN_AUTH_SECRET читает middleware на edge, до всякого
   * доступа к Airtable; Telegram и reCAPTCHA — работают в публичных роутах,
   * где лишний поход в Airtable на каждый запрос это и задержка, и точка отказа.
   */
  envOnly?: boolean
  fields: IntegrationField[]
  probe: (credentials: Record<string, string>) => Promise<HealthProbeResult>
}

// ─── То, что уходит в браузер (секретов здесь нет и быть не может) ──────────

export type CredentialSource = 'env' | 'vault' | 'none'

export interface IntegrationFieldStatus {
  key: string
  label: string
  secret: boolean
  required: boolean
  placeholder?: string
  hint?: string
  envVar?: string
  isModelField?: boolean
  configured: boolean
  source: CredentialSource
  /** Маска для секретных полей (sk-…f3a2) — по ней владелец узнаёт «тот ли ключ». */
  masked: string
  /** Полное значение — только для несекретных полей. */
  value?: string
}

export interface IntegrationStatus {
  id: string
  name: string
  category: IntegrationCategory
  summary: string
  docsUrl?: string
  consoleUrl?: string
  envOnly: boolean
  fields: IntegrationFieldStatus[]
  /** Все обязательные поля заполнены. */
  ready: boolean
  enabled: boolean
  notes: string
  updatedAt: string
  updatedBy: string
}

export interface HealthResult {
  id: string
  status: 'ok' | 'error' | 'unconfigured' | 'disabled'
  detail: string
  latencyMs: number | null
  models: IntegrationModel[]
  checkedAt: string
}

export interface VaultState {
  /** Мастер-ключ задан — сейф может шифровать и расшифровывать. */
  secretConfigured: boolean
  /** Таблица Integrations в Airtable недоступна (не создана или нет прав). */
  tableMissing: boolean
  /** Airtable-доступ вообще настроен. */
  airtableConfigured: boolean
}
