import { after, NextRequest, NextResponse } from 'next/server'

import { getPoiBotToken, getTelegramFileAsDataUrl, sendTelegramNotification } from '@/lib/notifications/telegram'
import { intakePoi } from '@/lib/poi-intake'
import { buildReport, escapeHtml } from '@/lib/poi-intake-report'
import { decideOwnerAccess } from '@/lib/telegram-owner-gate'

/**
 * Приём входящих сообщений бота приёма POI (2026-07-11).
 *
 * Бот ОТДЕЛЬНЫЙ от бота уведомлений: свой токен TELEGRAM_POI_BOT_TOKEN.
 *
 * Сценарий: владелец в поле шлёт боту фото таблички / скан буклета / пару
 * строк текста → агент исследует место, создаёт ЧЕРНОВИК POI в Airtable →
 * присылает отчёт в тот же чат.
 *
 * Безопасность (эндпоинт публичный — его дёргает Telegram):
 * 1. Секрет вебхука. Telegram шлёт заголовок X-Telegram-Bot-Api-Secret-Token
 *    со значением, заданным при setWebhook. Без совпадения — 401.
 * 2. Белый список чатов: обрабатываются только сообщения владельца
 *    (TELEGRAM_OWNER_CHAT_ID). Чужие — молча игнорируются. Переменная
 *    ОБЯЗАТЕЛЬНА: без неё эндпоинт не обрабатывает ничего (см.
 *    `src/lib/telegram-owner-gate.ts` и `tests/telegram-owner-gate.mjs`).
 *    Секрет из пункта 1 сюда не помогает: Telegram подставляет его сам,
 *    поэтому сообщение любого нашедшего бота приходит с валидным заголовком.
 *
 * Тайминг: Telegram ждёт ответ за секунды и ретраит, если его нет, поэтому
 * отвечаем 200 сразу, а исследование (веб-поиск + модель + Airtable, до
 * минуты) выполняем в after() — уже после ответа.
 */

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? ''
const OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID?.trim() ?? ''

interface TelegramPhotoSize {
  file_id: string
  file_size?: number
  width?: number
  height?: number
}

interface TelegramUpdate {
  message?: {
    chat?: { id?: number }
    text?: string
    caption?: string
    photo?: TelegramPhotoSize[]
    document?: { file_id: string; mime_type?: string }
  }
}


export async function POST(request: NextRequest) {
  // 1. Секрет вебхука
  if (!WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    console.error('[telegram-webhook] rejected: bad or missing secret token')
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const update = (await request.json().catch(() => ({}))) as TelegramUpdate
  const message = update.message
  const chatId = message?.chat?.id ? String(message.chat.id) : ''

  // 2. Только владелец. Ответ 200, чтобы Telegram не ретраил чужие сообщения.
  //    Незаданный TELEGRAM_OWNER_CHAT_ID закрывает эндпоинт, а не открывает
  //    его: правило и матрица решений — в decideOwnerAccess.
  const access = decideOwnerAccess(chatId, OWNER_CHAT_ID)
  if (!access.allowed) {
    if (access.reason === 'owner-not-configured') {
      console.error('[telegram-webhook] rejected: TELEGRAM_OWNER_CHAT_ID is not set')
    }
    return NextResponse.json({ ok: true })
  }

  const botToken = getPoiBotToken()
  const note = (message?.text ?? message?.caption ?? '').trim()
  // Telegram присылает фото в нескольких размерах — берём самый крупный
  const photo = message?.photo?.length ? message.photo[message.photo.length - 1] : null
  const imageDocument = message?.document?.mime_type?.startsWith('image/') ? message.document : null
  const pdfDocument = message?.document?.mime_type === 'application/pdf' ? message.document : null
  const imageFileIds = [photo?.file_id, imageDocument?.file_id].filter((id): id is string => Boolean(id))
  const pdfFileIds = [pdfDocument?.file_id].filter((id): id is string => Boolean(id))
  const fileIds = [...imageFileIds, ...pdfFileIds]

  if (!note && fileIds.length === 0) {
    await sendTelegramNotification(
      { text: 'Пришлите фото таблички/буклета или пару строк о месте — заведу черновик POI.' },
      chatId,
      botToken,
    )
    return NextResponse.json({ ok: true })
  }

  await sendTelegramNotification({ text: '🔎 Принял. Исследую место и собираю факты…' }, chatId, botToken)

  // 3. Тяжёлая работа — после ответа Telegram
  after(async () => {
    try {
      const imageDataUrls: string[] = []
      for (const fileId of imageFileIds) {
        const dataUrl = await getTelegramFileAsDataUrl(fileId, botToken)
        if (dataUrl) imageDataUrls.push(dataUrl)
      }
      const pdfDataUrls: string[] = []
      for (const fileId of pdfFileIds) {
        const dataUrl = await getTelegramFileAsDataUrl(fileId, botToken)
        if (dataUrl) pdfDataUrls.push(dataUrl)
      }

      const report = await intakePoi({ note, imageDataUrls, pdfDataUrls })
      await sendTelegramNotification({ text: buildReport(report) }, chatId, botToken)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error('[telegram-webhook] POI intake failed:', reason)
      await sendTelegramNotification({ text: `⚠️ Не удалось завести POI: ${escapeHtml(reason)}` }, chatId, botToken)
    }
  })

  return NextResponse.json({ ok: true })
}
