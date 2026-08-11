/**
 * Отчёт бота приёма POI: PoiIntakeReport → текст сообщения в Telegram.
 *
 * Вынесено из route.ts, потому что файл маршрута Next может экспортировать
 * только обработчики и несколько служебных имён — обычную функцию оттуда
 * не достать, а без экспорта её нельзя проверить тестом. До 11.08.2026 ни
 * одна ветка отчёта теста не имела: ветка needs_review уехала бы владельцу
 * под заголовком «не прошла канон» и никто бы не заметил.
 */

import type { PoiIntakeReport } from './poi-intake.ts'

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Экспортируется ради прямого теста веток отчёта: до 11.08.2026 ни одна
// из них теста не имела, и ветка needs_review уехала бы владельцу под
// заголовком «не прошла канон» незамеченной.
export function buildReport(report: PoiIntakeReport): string {
  const { research } = report

  // Приём мог не состояться: гейт нашёл дубль или запись не прошла канон.
  // Раньше такой ветки не было — intakePoi всегда возвращал created: true.
  if (!report.created) {
    // needs_review — отдельная ветка, и она не про канон. Запись прошла
    // канон и не совпала уверенно ни с чем: гейт не смог решить, тот же это
    // объект или другой, и остановился. Без этой ветки такой случай уезжал
    // владельцу под заголовком «не прошла канон» — то есть с неверной
    // причиной, по которой не починить ничего.
    const head =
      report.outcome === 'blocked_duplicate'
        ? `♻️ <b>Уже есть в базе</b> — <code>${report.poiId}</code>`
        : report.outcome === 'already_ingested'
          ? `♻️ <b>Эта запись источника уже принята</b> — <code>${report.poiId}</code>`
          : report.outcome === 'needs_review'
            ? '⏸ <b>Остановил: нужна ваша проверка</b>'
            : '🚫 <b>Не завёл: запись не прошла канон</b>'
    const tail: string[] = [head, '', escapeHtml(report.explanation)]
    if (research?.nameRu) tail.push('', `Присланное место: <b>${escapeHtml(research.nameRu)}</b>`)
    if (report.outcome === 'needs_review' && report.duplicates.length) {
      tail.push(
        '',
        'Похожие записи:',
        ...report.duplicates
          .slice(0, 3)
          .map((d) => `• <code>${d.poiId}</code> ${escapeHtml(d.nameRu)}${d.siteCity ? ` (${escapeHtml(d.siteCity)})` : ''}`),
      )
    }
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

  // Остановленные и отвергнутые локации показываются ОТДЕЛЬНО от «уже в базе».
  // До 11.08.2026 всё, что не создано, сваливалось в один список, и локация,
  // остановленная гейтом, уезжала владельцу под подписью «уже в базе» с
  // пустым идентификатором — с неверной причиной и без записи, которую можно
  // открыть.
  if (report.stubsNeedsReview.length) {
    lines.push(
      '',
      `⏸ <b>Остановлено на проверку: ${report.stubsNeedsReview.length}</b>`,
      ...report.stubsNeedsReview.map((s) => `• ${escapeHtml(s.nameRu)}${s.siteCity ? ` (${escapeHtml(s.siteCity)})` : ''} — ${escapeHtml(s.reason)}`),
    )
  }

  if (report.stubsRejected.length) {
    lines.push(
      '',
      `🚫 <b>Не прошли канон: ${report.stubsRejected.length}</b>`,
      ...report.stubsRejected.map((s) => `• ${escapeHtml(s.nameRu)} — ${escapeHtml(s.reason)}`),
    )
  }

  if (report.parentNotLinked) {
    lines.push(
      '',
      `🔗 Родитель «${escapeHtml(report.parentNotLinked.nameRu)}» не связан: ${escapeHtml(report.parentNotLinked.reason)}`,
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
