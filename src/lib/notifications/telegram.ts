/**
 * Telegram notification helper
 * Uses jumbot (@Jumbo_in_japan_bot) for internal notifications
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID || '79726663'

interface TelegramMessage {
  text: string
  parseMode?: 'HTML' | 'Markdown'
  disableNotification?: boolean
}

interface TelegramResponse {
  ok: boolean
  result?: {
    message_id: number
  }
  description?: string
}

/**
 * Бот приёма POI — ОТДЕЛЬНЫЙ от бота уведомлений (решение владельца
 * 2026-07-11): у него свой токен TELEGRAM_POI_BOT_TOKEN. Chat ID владельца
 * общий: id пользователя в Telegram одинаков для всех ботов.
 */
export function getPoiBotToken(): string {
  return process.env.TELEGRAM_POI_BOT_TOKEN?.trim() ?? ''
}

export async function sendTelegramNotification(
  message: TelegramMessage,
  chatId: string = OWNER_CHAT_ID,
  botToken: string | undefined = BOT_TOKEN,
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  if (!botToken) {
    console.warn('[telegram] BOT_TOKEN not configured, skipping notification')
    return { success: false, error: 'BOT_TOKEN not configured' }
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message.text,
        parse_mode: message.parseMode || 'HTML',
        disable_notification: message.disableNotification ?? false,
      }),
    })

    const data = (await response.json()) as TelegramResponse

    if (!data.ok) {
      console.error('[telegram] API error:', data.description)
      return { success: false, error: data.description }
    }

    return { success: true, messageId: data.result?.message_id }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[telegram] Request failed:', errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Скачать файл, присланный в бот (фото таблички, скан буклета), и вернуть его
 * как data-URL для передачи в модель.
 *
 * Почему data-URL, а не прямая ссылка Telegram: в URL файла Telegram зашит
 * токен бота — отдавать его наружу (в OpenAI) нельзя.
 */
export async function getTelegramFileAsDataUrl(
  fileId: string,
  botToken: string | undefined = BOT_TOKEN,
): Promise<string | null> {
  if (!botToken) return null

  try {
    const infoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    })
    const info = (await infoResponse.json()) as { ok: boolean; result?: { file_path?: string } }
    const filePath = info.result?.file_path
    if (!info.ok || !filePath) return null

    const fileResponse = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)
    if (!fileResponse.ok) return null

    const buffer = Buffer.from(await fileResponse.arrayBuffer())
    const extension = filePath.split('.').pop()?.toLowerCase() ?? 'jpg'
    const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch (error) {
    console.error('[telegram] getFile failed:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Convenience function for contact form notifications
 */
export async function notifyNewContact(data: {
  name: string
  contact: string
  travelDate?: string
  groupSize?: string
  interests?: string
  prospectId?: string
  /** Персональная ссылка на опросник — гид может сразу переслать её клиенту. */
  factFindUrl?: string
}): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const lines = [
    `📬 <b>Новая заявка с сайта</b>`,
  ]

  if (data.prospectId) {
    lines.push(`<code>${data.prospectId}</code>`)
  }

  lines.push(
    ``,
    `<b>Имя:</b> ${escapeHtml(data.name)}`,
    `<b>Контакт:</b> ${escapeHtml(data.contact)}`,
  )

  if (data.travelDate) {
    lines.push(`<b>Даты:</b> ${escapeHtml(data.travelDate)}`)
  }

  if (data.groupSize) {
    lines.push(`<b>Группа:</b> ${escapeHtml(data.groupSize)}`)
  }

  if (data.interests) {
    lines.push(``, `<b>Интересы:</b>`, escapeHtml(data.interests))
  }

  if (data.factFindUrl) {
    lines.push(``, `<a href="${data.factFindUrl}">Анкета «Профиль туриста»</a> — можно сразу переслать клиенту`)
  }

  return sendTelegramNotification({ text: lines.join('\n') })
}

/**
 * Уведомление о заполненном опроснике «Профиль туриста».
 * `summary` — готовые строки сводки (даты, состав, опыт, формат),
 * `cardUrl` — ссылка на карточку клиента в админке.
 */
export async function notifyProfileSubmitted(data: {
  name: string
  prospectId?: string
  isNew: boolean
  summary: string[]
  cardUrl: string
}): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const lines = [
    data.isNew ? '🧭 <b>Новый профиль туриста (общая ссылка)</b>' : '🧭 <b>Профиль туриста заполнен</b>',
  ]

  if (data.prospectId) lines.push(`<code>${data.prospectId}</code>`)

  lines.push('', `<b>Имя:</b> ${escapeHtml(data.name)}`)
  for (const row of data.summary) {
    const separatorIndex = row.indexOf(': ')
    if (separatorIndex === -1) {
      lines.push(escapeHtml(row))
    } else {
      const label = row.slice(0, separatorIndex)
      const rest = row.slice(separatorIndex + 2)
      lines.push(`<b>${escapeHtml(label)}:</b> ${escapeHtml(rest)}`)
    }
  }

  lines.push('', `<a href="${data.cardUrl}">Открыть карточку клиента</a>`)

  return sendTelegramNotification({ text: lines.join('\n') })
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
