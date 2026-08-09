/**
 * РЕЕСТР ВНЕШНИХ API — единственное место, где описано подключение провайдера.
 *
 * Чтобы завести новый API, добавьте сюда один объект: дэшборд сам нарисует
 * карточку, форму входа, маскирование секретов, health-проверку и выбор
 * модели. Ни UI, ни роуты, ни сейф трогать не нужно. Полная процедура и
 * готовый шаблон — docs/integrations.md.
 *
 * Три раздела:
 *   llm      — провайдеры моделей. Ключи вводятся в админке и живут в сейфе.
 *   core     — базовая обвязка сайта. Ключи ТОЛЬКО в переменных окружения
 *              (`envOnly`), дэшборд их показывает, но не хранит и не меняет.
 *   magicbox — песочница: сюда чат добавляет новые API по просьбе владельца,
 *              пока они не обкатаны. Отличается только разделом в интерфейсе —
 *              механика та же, что у llm.
 */

import {
  probeAirtable,
  probeAnthropic,
  probeGemini,
  probeGoogleOAuth,
  probeGooglePlaces,
  probeMistral,
  probeOpenAi,
  probeOpenRouter,
  probeRecaptcha,
  probeTelegramNotify,
  probeTelegramPoi,
} from './probes'
import type { IntegrationDefinition } from './types'

export const INTEGRATIONS: IntegrationDefinition[] = [
  // ─── Модели ────────────────────────────────────────────────────────────────
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'llm',
    summary: 'Черновики описаний POI и текстов маршрутов. Единственный провайдер моделей, который сайт уже использует.',
    consoleUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    probe: probeOpenAi,
    fields: [
      {
        key: 'apiKey',
        label: 'API-ключ',
        secret: true,
        required: true,
        placeholder: 'sk-proj-…',
        envVar: 'OPENAI_API_KEY',
        hint: 'Переменная окружения OPENAI_API_KEY перекрывает значение из сейфа.',
      },
      {
        key: 'model',
        label: 'Модель по умолчанию',
        secret: false,
        required: false,
        placeholder: 'gpt-4.1-mini',
        envVar: 'OPENAI_MODEL',
        isModelField: true,
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'llm',
    summary: 'Второй провайдер моделей: длинный контекст и разбор изображений (таблички, сканы, меню).',
    consoleUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    probe: probeGemini,
    fields: [
      {
        key: 'apiKey',
        label: 'API-ключ',
        secret: true,
        required: true,
        placeholder: 'AIza…',
        envVar: 'GEMINI_API_KEY',
      },
      {
        key: 'model',
        label: 'Модель по умолчанию',
        secret: false,
        required: false,
        placeholder: 'gemini-2.5-flash',
        isModelField: true,
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'llm',
    summary: 'Модели Claude напрямую из кода сайта — редакторские задачи, где важна точность формулировок.',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    docsUrl: 'https://docs.claude.com/en/api',
    probe: probeAnthropic,
    fields: [
      {
        key: 'apiKey',
        label: 'API-ключ',
        secret: true,
        required: true,
        placeholder: 'sk-ant-…',
        envVar: 'ANTHROPIC_API_KEY',
      },
      {
        key: 'model',
        label: 'Модель по умолчанию',
        secret: false,
        required: false,
        placeholder: 'claude-sonnet-4-5',
        isModelField: true,
      },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    category: 'llm',
    summary: 'Европейский провайдер: дешёвые модели для массовых задач и OCR документов.',
    consoleUrl: 'https://console.mistral.ai/api-keys',
    docsUrl: 'https://docs.mistral.ai/api/',
    probe: probeMistral,
    fields: [
      {
        key: 'apiKey',
        label: 'API-ключ',
        secret: true,
        required: true,
        envVar: 'MISTRAL_API_KEY',
      },
      {
        key: 'model',
        label: 'Модель по умолчанию',
        secret: false,
        required: false,
        placeholder: 'mistral-large-latest',
        isModelField: true,
      },
    ],
  },

  // ─── Базовые сервисы (только переменные окружения) ─────────────────────────
  {
    id: 'airtable',
    name: 'Airtable',
    category: 'core',
    summary: 'Хранилище всего содержимого сайта: точки, маршруты, клиенты, ресурсы. Отказ здесь останавливает сборку.',
    envOnly: true,
    consoleUrl: 'https://airtable.com/create/tokens',
    probe: probeAirtable,
    fields: [
      { key: 'token', label: 'Персональный токен', secret: true, required: true, envVar: 'AIRTABLE_TOKEN' },
      { key: 'baseId', label: 'Идентификатор базы', secret: false, required: true, envVar: 'AIRTABLE_BASE_ID' },
    ],
  },
  {
    id: 'telegram-notify',
    name: 'Telegram — уведомления',
    category: 'core',
    summary: 'Бот, который присылает владельцу заявки с сайта и заполненные анкеты.',
    envOnly: true,
    consoleUrl: 'https://t.me/BotFather',
    probe: probeTelegramNotify,
    fields: [
      { key: 'botToken', label: 'Токен бота', secret: true, required: true, envVar: 'TELEGRAM_BOT_TOKEN' },
      { key: 'ownerChatId', label: 'Chat ID владельца', secret: false, required: true, envVar: 'TELEGRAM_OWNER_CHAT_ID' },
    ],
  },
  {
    id: 'telegram-poi',
    name: 'Telegram — приём точек',
    category: 'core',
    summary: 'Бот, которому владелец шлёт фото таблички или пару строк, а агент заводит черновик POI. Проверяется и привязка вебхука.',
    envOnly: true,
    consoleUrl: 'https://t.me/BotFather',
    probe: probeTelegramPoi,
    fields: [
      { key: 'botToken', label: 'Токен POI-бота', secret: true, required: true, envVar: 'TELEGRAM_POI_BOT_TOKEN' },
      { key: 'webhookSecret', label: 'Секрет вебхука', secret: true, required: true, envVar: 'TELEGRAM_WEBHOOK_SECRET' },
    ],
  },
  {
    id: 'google-oauth',
    name: 'Google — вход в админку',
    category: 'core',
    summary: 'Авторизация владельца. Читается на edge раньше всего остального, поэтому только переменные окружения.',
    envOnly: true,
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    probe: probeGoogleOAuth,
    fields: [
      { key: 'clientId', label: 'Client ID', secret: false, required: true, envVar: 'GOOGLE_CLIENT_ID' },
      { key: 'clientSecret', label: 'Client Secret', secret: true, required: true, envVar: 'GOOGLE_CLIENT_SECRET' },
      { key: 'authSecret', label: 'Секрет подписи сессии', secret: true, required: true, envVar: 'ADMIN_AUTH_SECRET' },
      {
        key: 'allowedEmails',
        label: 'Кому разрешён вход',
        secret: false,
        required: true,
        envVar: 'ADMIN_ALLOWED_EMAILS',
        hint: 'Адреса через запятую.',
      },
    ],
  },
  {
    id: 'recaptcha',
    name: 'reCAPTCHA',
    category: 'core',
    summary: 'Защита формы обратной связи от ботов.',
    envOnly: true,
    consoleUrl: 'https://www.google.com/recaptcha/admin',
    probe: probeRecaptcha,
    fields: [
      { key: 'secretKey', label: 'Секретный ключ', secret: true, required: true, envVar: 'RECAPTCHA_SECRET_KEY' },
      {
        key: 'siteKey',
        label: 'Публичный ключ сайта',
        secret: false,
        required: true,
        envVar: 'NEXT_PUBLIC_RECAPTCHA_SITE_KEY',
      },
    ],
  },

  // ─── Magic Box ─────────────────────────────────────────────────────────────
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'magicbox',
    summary:
      'Шлюз к сотням моделей по одному ключу — Claude, Llama, Qwen, DeepSeek, Grok. Заодно показывает остаток кредитов. Образец для клонирования новых блоков.',
    consoleUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/docs',
    probe: probeOpenRouter,
    fields: [
      {
        key: 'apiKey',
        label: 'API-ключ',
        secret: true,
        required: true,
        placeholder: 'sk-or-v1-…',
        envVar: 'OPENROUTER_API_KEY',
      },
      {
        key: 'model',
        label: 'Модель по умолчанию',
        secret: false,
        required: false,
        placeholder: 'anthropic/claude-sonnet-4.5',
        isModelField: true,
      },
    ],
  },
  {
    id: 'google-places',
    name: 'Google Places',
    category: 'magicbox',
    summary:
      'Координаты и адреса объектов там, где Wikidata молчит: частные музеи, магазины, смотровые площадки — всё, у чего нет энциклопедической статьи. Нужен для засыпки координат POI.',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    docsUrl: 'https://developers.google.com/maps/documentation/places/web-service/text-search',
    probe: probeGooglePlaces,
    fields: [
      {
        key: 'apiKey',
        label: 'API-ключ',
        secret: true,
        required: true,
        placeholder: 'AIza…',
        envVar: 'GOOGLE_PLACES_API_KEY',
        hint: 'В консоли Google ограничьте ключ одним Places API (New) и поставьте дневную квоту. Ключи Maps Platform по устройству видны в браузере, поэтому защищают их не секретностью, а ограничениями.',
      },
    ],
  },
]

export function findIntegration(id: string): IntegrationDefinition | undefined {
  return INTEGRATIONS.find((definition) => definition.id === id)
}
