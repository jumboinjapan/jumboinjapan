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

export async function sendTelegramNotification(
  message: TelegramMessage,
  chatId: string = OWNER_CHAT_ID
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  if (!BOT_TOKEN) {
    console.warn('[telegram] BOT_TOKEN not configured, skipping notification')
    return { success: false, error: 'BOT_TOKEN not configured' }
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`

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
 * Convenience function for contact form notifications
 */
export async function notifyNewContact(data: {
  name: string
  contact: string
  travelDate?: string
  groupSize?: string
  interests?: string
  prospectId?: string
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

  return sendTelegramNotification({ text: lines.join('\n') })
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
