import { after, NextRequest, NextResponse } from 'next/server'

import { getPoiBotToken, getTelegramFileAsDataUrl, sendTelegramNotification } from '@/lib/notifications/telegram'
import { intakePoi, type PoiIntakeReport } from '@/lib/poi-intake'
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildReport(report: PoiIntakeReport): string {
  const { research } = report

  // Приём мог не состояться: гейт нашёл дубль или запись не прошла канон.
  // Раньше такой ветки не было — intakePoi всегда возвращал created: true.
  if (!report.created) {
    const head =
      report.outcome === 'blocked_duplicate'
        ? `♻️ <b>Уже есть в базе</b> — <code>${report.poiId}</code>`
        : report.outcome === 'already_ingested'
          ? `♻️ <b>Эта запись источника уже принята</b> — <code>${report.poiId}</code>`
          : '🚫 <b>Не завёл: запись не прошла канон</b>'
    const tail: string[] = [head, '', escapeHtml(report.explanation)]
    if (research?.nameRu) tail.push('', `Присланное место: <b>${escapeHtml(research.nameRu)}</b>`)
    const errors = report.canonIssues.filter((i) => i.level === 'error')
    if (errors.length) tail.push('', ...errors.map((i) => `• ${escapeHtml(i.message)}`))
    if (report.recordId) {
      tail.push('', `<a href="${report.airtableUrl}">Открыть существующую запись</a>`)
    }
    tail.push('', 'Если это всё-таки другое место — скажите, и я заведу его принудительно.')
    return tail.join('\n')
  }

  const lines: string[] = [
    `✅ <b>Создан черновик POI</b> — <code>${report.poiId}</code>`,
    '',
    `<b>${escapeHtml(research.nameRu)}</b>${research.nameEn ? ` · ${escapeHtml(research.nameEn)}` : ''}`,
  ]

  const facts: string[] = []
  if (research.siteCity) facts.push(`Город: ${escapeHtml(research.siteCity)}`)
  if (research.prefectureRu) facts.push(`Префектура: ${escapeHtml(research.prefectureRu)}`)
  if (research.categoriesRu.length) facts.push(`Категория: ${escapeHtml(research.categoriesRu.join(', '))}`)
  if (research.workingHours) facts.push(`Часы: ${escapeHtml(research.workingHours)}`)
  if (research.ticketsNote) facts.push(`Билеты: ${escapeHtml(research.ticketsNote)}`)
  if (research.website) facts.push(`Сайт: ${escapeHtml(research.website)}`)
  if (facts.length) lines.push('', ...facts)

  if (research.descriptionRu) {
    lines.push('', '<b>Описание (черновик):</b>', escapeHtml(research.descriptionRu))
  }

  if (report.parent) {
    lines.push(
      '',
      report.parentCreatedAsStub
        ? `🔗 Родитель «${escapeHtml(report.parent.nameRu)}» в базе не было — создал заглушку ${report.parent.poiId} и связал. Заполните её факты (или пришлите мне этот объект отдельно).`
        : `🔗 Родитель: ${escapeHtml(report.parent.nameRu)} (${report.parent.poiId}) — связан в Parent POI.`,
    )
  }

  if (report.stubs.length) {
    lines.push(
      '',
      `📋 <b>Из программы создано ${report.stubs.length} заглушек</b> (имя + город, связаны с родителем):`,
      ...report.stubs.map((s) => `• ${s.poiId} ${escapeHtml(s.nameRu)}${s.siteCity ? ` (${escapeHtml(s.siteCity)})` : ''}`),
      'Наполнить факты: пришлите место отдельным сообщением.',
    )
  }
  const warns = report.canonIssues.filter((i) => i.level === 'warn')
  if (warns.length) {
    lines.push('', '⚙️ Приведено к канону:', ...warns.map((i) => `• ${escapeHtml(i.message)}`))
  }

  if (report.stubsSkippedAsExisting.length) {
    lines.push(
      '',
      '✔️ Уже в базе (пропущены):',
      ...report.stubsSkippedAsExisting.map((s) => `• ${escapeHtml(s.nameRu)} (${s.poiId})`),
    )
  }

  if (report.duplicates.length) {
    lines.push(
      '',
      '⚠️ <b>Похоже на существующие точки:</b>',
      ...report.duplicates.map((d) => `• ${escapeHtml(d.nameRu)} (${d.poiId}${d.siteCity ? `, ${escapeHtml(d.siteCity)}` : ''})`),
      'Если это дубль — удалите черновик.',
    )
  }

  if (research.openQuestions.length) {
    lines.push('', '❓ <b>Не подтверждено:</b>', ...research.openQuestions.map((q) => `• ${escapeHtml(q)}`))
  }

  if (research.sources.length) {
    lines.push('', `<b>Источники:</b> ${research.sources.map(escapeHtml).join(', ')}`)
  }

  lines.push('', 'Статус: Draft / Fact Check: Todo — на сайт не попадёт до вашей проверки.', report.airtableUrl)
  return lines.join('\n')
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
