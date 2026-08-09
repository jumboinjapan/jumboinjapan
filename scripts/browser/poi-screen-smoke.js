/*
 * Прогон экрана POI целиком — в браузере, на живой панели.
 *
 * Зачем. 9 августа кнопку «Сохранить название» чинили четыре раза подряд.
 * Каждый раз проверялся тот путь, который только что написали: выбрать
 * запись, набрать, нажать кнопку, убедиться. Путь владельца — набрать и
 * нажать «Утвердить и опубликовать» — не проверялся ни разу, а ломалось
 * именно на нём. Проверка «своей правки» вместо проверки «сценария
 * человека» и стоила дня.
 *
 * Правила прогона:
 *   1. Каждая проверка читает состояние ДО, действует и сверяет с Airtable
 *      свежим запросом, а не с тем, что нарисовано на экране.
 *   2. Всё изменённое возвращается на место, и возврат тоже сверяется.
 *   3. Дорогое и разрушительное (генерация текста, публикация, удаление)
 *      по умолчанию не запускается — только явными флагами.
 *
 * Как запустить: открыть https://jumboinjapan.com/admin/seo-llm, дождаться
 * загрузки, открыть консоль браузера и вставить содержимое файла целиком.
 * Флаги: window.SMOKE_ALLOW_GENERATE = true — разрешить «Переписать текст».
 */
;(async () => {
  const results = []
  const changed = []
  const ok = (name, pass, detail) => results.push({ name, pass, detail })

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const listButtons = () => [...document.querySelectorAll('button')].filter((b) => b.className.includes('grid w-full gap-1'))
  const inputs = () => [...document.querySelectorAll('input')]
  const byText = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.innerText))
  const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set

  function type(el, value) {
    nativeSet.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /* Уход из поля.
   *
   * el.blur() молчит, если окно браузера не в фокусе: Chrome не рассылает
   * события фокуса неактивному документу. На этом прогон один раз соврал —
   * показал три «поломки» там, где приложение работало. React слушает не
   * blur, а всплывающий focusout, поэтому шлём именно его. */
  function leaveField(el) {
    if (document.hasFocus() && document.activeElement === el) el.blur()
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  }

  /* Счётчик запросов: если после ухода из поля не ушло НИ ОДНОГО запроса,
   * значит сломался инструмент, а не приложение. Разница принципиальная —
   * во втором случае чинить нечего. */
  let apiCalls = 0
  const originalFetch = window.fetch
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0] && args[0].url
    const method = (args[1] && args[1].method) || 'GET'
    if (String(url).includes('/api/admin') && method === 'POST') apiCalls += 1
    return originalFetch.apply(this, args)
  }

  /* Что реально лежит в Airtable. Читаем страницу заново: список приходит
     с сервера, и это единственный источник правды, который видит человек. */
  function fieldAfter(text, from, field) {
    const k = text.indexOf(field + '\\":\\"', from)
    if (k < 0) return null
    const start = k + field.length + 5
    const end = text.indexOf('\\"', start)
    return end < 0 ? null : text.slice(start, end)
  }
  async function storedNames(poiId) {
    const t = await (await fetch('/admin/seo-llm', { cache: 'no-store' })).text()
    const i = t.indexOf('poiId\\":\\"' + poiId)
    if (i < 0) return null
    return { nameRu: fieldAfter(t, i, 'nameRu'), nameEn: fieldAfter(t, i, 'nameEn') }
  }
  async function storedDetail(recordId) {
    const r = await fetch('/api/admin/seo-llm?recordId=' + encodeURIComponent(recordId), { cache: 'no-store' })
    const d = await r.json()
    return d.ok ? d.detail : null
  }

  // ── 0. Экран живой ───────────────────────────────────────────────────
  const t0 = performance.now()
  while (performance.now() - t0 < 30000) {
    const b = listButtons()[0]
    if (b && Object.keys(b).some((k) => k.startsWith('__reactProps'))) break
    await sleep(150)
  }
  const rows = listButtons()
  ok('экран ожил и список кликабелен', rows.length > 0 && Object.keys(rows[0]).some((k) => k.startsWith('__reactProps')), `${rows.length} записей`)
  if (!rows.length) return console.table(results)

  // ── 1. Выбор записи подтягивает тексты ───────────────────────────────
  const target = rows.find((b) => /Акихабара/.test(b.innerText)) || rows[1]
  const targetName = target.innerText.split('\n')[0]
  const poiId = (target.innerText.match(/POI-\d+/) || [])[0]
  target.click()
  await sleep(2500)
  const areas = document.querySelectorAll('textarea')
  ok('выбор записи подтягивает тексты', areas.length >= 2, `${areas.length} полей текста, запись ${poiId}`)

  const before = await storedNames(poiId)
  /* Record id берём из того же ответа сервера, что и название: обход
     внутренностей React ломается от любой перестановки разметки. */
  const recordId = await (async () => {
    const t = await (await fetch('/admin/seo-llm', { cache: 'no-store' })).text()
    const i = t.indexOf('poiId\\":\\"' + poiId)
    if (i < 0) return null
    const k = t.lastIndexOf('id\\":\\"', i)
    if (k < 0) return null
    const start = k + 7
    const end = t.indexOf('\\"', start)
    return end < 0 ? null : t.slice(start, end)
  })()
  ok('запись опознана', Boolean(before && recordId), `${poiId} ${recordId} «${before && before.nameRu}»`)
  if (!before || !recordId) return console.table(results)

  const probe = before.nameRu + ' ⟪тест⟫'

  // ── 2. Название сохраняется при уходе из поля ────────────────────────
  type(inputs()[1], probe)
  await sleep(300)
  const dirtyChip = document.body.innerText.includes('Не сохранено')
  ok('видно, что название не сохранено', dirtyChip, dirtyChip ? '' : 'нет отметки «Не сохранено»')
  leaveField(inputs()[1])
  await sleep(4000)
  const afterBlur = await storedNames(poiId)
  const blurSaved = afterBlur && afterBlur.nameRu === probe
  if (blurSaved) changed.push('название ' + poiId)
  if (!blurSaved && apiCalls === 0) {
    ok('ИНСТРУМЕНТ: уход из поля дошёл до приложения', false, 'ни одного запроса — проверять нечего, чинить надо прогон')
  }
  ok('уход из поля сохраняет название', blurSaved, `в Airtable: «${afterBlur && afterBlur.nameRu}»`)

  // ── 3. Название переживает переключение записи ───────────────────────
  if (!blurSaved) {
    type(inputs()[1], probe)
    await sleep(300)
    const other = rows.find((b) => b !== target)
    other.click()
    await sleep(2000)
    target.click()
    await sleep(2000)
    const afterSwitch = await storedNames(poiId)
    ok('название переживает переключение записи', afterSwitch && afterSwitch.nameRu === probe, `в Airtable: «${afterSwitch && afterSwitch.nameRu}»`)
    if (afterSwitch && afterSwitch.nameRu === probe) changed.push('название ' + poiId)
  } else {
    ok('название переживает переключение записи', true, 'покрыто уходом из поля')
  }

  // ── 4. Стирание названия не проходит молча ───────────────────────────
  target.click()
  await sleep(1500)
  type(inputs()[1], '')
  await sleep(300)
  const wipeWarned = document.body.innerText.includes('стёрто')
  leaveField(inputs()[1])
  await sleep(3500)
  const afterWipe = await storedNames(poiId)
  ok('стирание названия не сохраняется само', afterWipe && afterWipe.nameRu !== '', `предупреждение: ${wipeWarned ? 'есть' : 'нет'}; в Airtable: «${afterWipe && afterWipe.nameRu}»`)

  // ── 5. Возврат названия ──────────────────────────────────────────────
  target.click()
  await sleep(1500)
  type(inputs()[1], before.nameRu)
  await sleep(300)
  const saveBtn = byText(/Сохранить название/)
  if (saveBtn && !saveBtn.disabled) saveBtn.click()
  await sleep(4000)
  const restored = await storedNames(poiId)
  ok('название возвращено как было', restored && restored.nameRu === before.nameRu, `«${restored && restored.nameRu}»`)

  // ── 6. Черновик описания сохраняется при уходе из поля ───────────────
  const detailBefore = await storedDetail(recordId)
  const draftArea = [...document.querySelectorAll('textarea')].find((a) => !a.readOnly)
  if (draftArea && detailBefore) {
    const originalDraft = draftArea.value
    const areaSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    areaSet.call(draftArea, originalDraft + ' ⟪тест⟫')
    draftArea.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(200)
    leaveField(draftArea)
    await sleep(4000)
    const detailAfter = await storedDetail(recordId)
    const draftSaved = detailAfter && (detailAfter.draft?.workingDraftRu || '').includes('⟪тест⟫')
    ok('черновик описания сохраняется при уходе из поля', Boolean(draftSaved), draftSaved ? '' : 'в Airtable без правки')
    // возврат
    areaSet.call(draftArea, originalDraft)
    draftArea.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(200)
    leaveField(draftArea)
    await sleep(4000)
    const detailRestored = await storedDetail(recordId)
    ok('черновик описания возвращён как был',
      detailRestored && (detailRestored.draft?.workingDraftRu || '') === (detailBefore.draft?.workingDraftRu || ''),
      '')
  } else {
    ok('черновик описания сохраняется при уходе из поля', false, 'поле черновика не найдено')
  }

  // ── 7. Кнопки нижней панели живые ────────────────────────────────────
  const bar = ['Переписать текст', 'Утвердить и опубликовать', 'Удалить POI'].map((label) => {
    const b = byText(new RegExp(label))
    return { label, found: Boolean(b), wired: Boolean(b && Object.keys(b).some((k) => k.startsWith('__reactProps'))), disabled: b ? b.disabled : null }
  })
  ok('кнопки нижней панели на месте и подключены', bar.every((b) => b.found && b.wired), JSON.stringify(bar))

  // ── 8. Генерация текста (только по флагу) ────────────────────────────
  if (window.SMOKE_ALLOW_GENERATE) {
    const snapshot = await storedDetail(recordId)
    const gen = byText(/Переписать текст/)
    gen.click()
    await sleep(25000)
    const afterGen = await storedDetail(recordId)
    ok('«Переписать текст» пишет новый черновик',
      afterGen && (afterGen.draft?.workingDraftRu || '') !== (snapshot.draft?.workingDraftRu || ''), '')
    await fetch('/api/admin/seo-llm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveDraft', recordId, poiId,
        workingDraftRu: snapshot.draft?.workingDraftRu ?? '', approvedRu: snapshot.draft?.approvedRu ?? '',
        workingDraftEn: snapshot.draft?.workingDraftEn ?? '', approvedEn: snapshot.draft?.approvedEn ?? '',
        copyStatus: snapshot.draft?.status }) })
    const back = await storedDetail(recordId)
    ok('черновик после генерации возвращён как был',
      back && (back.draft?.workingDraftRu || '') === (snapshot.draft?.workingDraftRu || ''), '')
  } else {
    ok('«Переписать текст» — пропущено', true, 'запуск флагом window.SMOKE_ALLOW_GENERATE = true')
  }

  // Публикация и удаление автоматически не проверяются: обе пишут на живой
  // сайт необратимо. Публикацию проверять руками на записи, где черновик
  // совпадает с текстом на сайте.
  ok('публикация и удаление — только руками', true, 'необратимо, автоматом не трогаем')

  const failed = results.filter((r) => !r.pass)
  console.table(results)
  console.log(failed.length ? `❌ провалено проверок: ${failed.length}` : '✅ все проверки пройдены')
  if (changed.length) console.log('менялось в базе (и возвращалось):', changed.join(', '))
  window.__smoke = { results, failed, changed }
  return window.__smoke
})()
