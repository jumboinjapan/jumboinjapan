#!/usr/bin/env node
/**
 * Проверка целостности базы POI и безопасности публикации.
 *
 *   npm run check:poi              — проверить живую базу
 *   npm run check:poi -- --json    — машиночитаемый отчёт
 *   node scripts/check-poi-integrity.mjs --fixture tmp/  — прогон на дампах
 *
 * Код выхода 1, если найдена проблема уровня FAIL. Уровень WARN не роняет
 * прогон — это гигиена, а не поломка.
 *
 * Проверки составлены по результатам аудита 6 августа 2026 на живой базе
 * (431 POI, 63 остановки маршрутов). Каждая соответствует реальной ошибке,
 * найденной тогда, либо механизму, который к такой ошибке приведёт.
 */

import { readFile } from 'node:fs/promises'
import nextEnv from '@next/env'
import { POI_TABLE_ID, ROUTE_STOPS_TABLE_ID } from '../src/lib/airtable-schema.ts'
import { haversineMeters, screenNewPoi } from '../src/lib/poi-matching.ts'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const TOKEN = process.env.AIRTABLE_TOKEN?.trim() ?? ''
const BASE_ID = process.env.AIRTABLE_BASE_ID?.trim() ?? 'apppwhjFN82N9zNqm'

// ── Загрузка ────────────────────────────────────────────────────────────

async function fetchAll(tableId, fields) {
  if (!TOKEN) throw new Error('AIRTABLE_TOKEN не задан — нечем читать базу')
  const out = []
  let offset
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`)
    url.searchParams.set('pageSize', '100')
    for (const f of fields) url.searchParams.append('fields[]', f)
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }, cache: 'no-store' })
    if (!res.ok) throw new Error(`Airtable ${tableId}: ${res.status} ${await res.text()}`)
    const data = await res.json()
    out.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)
  return out
}

const text = (fields, key) => (typeof fields[key] === 'string' ? fields[key].trim() : '')

// ── Проверки ────────────────────────────────────────────────────────────

const findings = []
const add = (level, code, title, detail, items = []) =>
  findings.push({ level, code, title, detail, count: items.length || undefined, items: items.slice(0, 30) })

/**
 * 1. Остановка маршрута ссылается на несуществующий POI.
 *
 * Route Stops хранит связь как ОБЫЧНЫЙ ТЕКСТ (поле «POI ID»,
 * singleLineText), а не как record link. Airtable не мешает удалить POI,
 * на который ссылаются: `deleteAirtablePoi` в src/lib/airtable.ts тоже
 * никаких ссылок не проверяет. Страница молча теряет данные точки.
 * Риск становится острым при слиянии дублей.
 */
function checkDanglingStops(pois, stops) {
  const ids = new Set(pois.map((p) => p.poiId).filter(Boolean))
  const dead = stops.filter((s) => s.poiId && !ids.has(s.poiId))
  if (dead.length) {
    add('FAIL', 'stop_dangling_poi', 'Остановка ссылается на удалённый POI',
      'Страница маршрута отрисуется без описания, часов и фото этой точки.',
      dead.map((s) => `${s.routeSlug} №${s.order} → ${s.poiId} («${s.nameSnapshot}»)`))
  }
}

/**
 * 2. Один POI используется двумя остановками одного маршрута.
 *
 * Найдено вживую: RST-ENOSHIMA-02 «Сад Самюэля Кокинга» и RST-ENOSHIMA-03
 * «Смотровая башня Морская свеча» обе указывали на POI-000016. Вторая
 * остановка показывала описание и часы работы сада вместо маяка.
 */
function checkStopPoiCollision(stops) {
  const byRoute = new Map()
  for (const s of stops) {
    if (!s.poiId) continue
    const key = `${s.routeSlug}|${s.poiId}`
    if (!byRoute.has(key)) byRoute.set(key, [])
    byRoute.get(key).push(s)
  }
  const clashes = [...byRoute.values()].filter((g) => g.length > 1)
  if (clashes.length) {
    add('FAIL', 'stop_poi_collision', 'Две остановки маршрута указывают на один POI',
      'Одна из них показывает чужие данные. Проверьте, какой POI должен быть у второй.',
      clashes.map((g) => `${g[0].routeSlug}: ${g.map((s) => `${s.stopId} «${s.nameSnapshot}»`).join(' + ')} → ${g[0].poiId}`))
  }
}

/**
 * 3. Дубли внутри базы. Тот же матчер, что и на входе (poi-matching.ts),
 * применённый ко всей базе задним числом: гейт не защищает от того, что
 * было заведено до него.
 */
function checkDuplicates(pois) {
  const live = pois.filter((p) => !p.isSystem && p.nameRu)

  /* Часть и целое — не дубль, если связь уже размечена.
     «Рыбный рынок Тоёсу» внутри «Тоёсу (район)», музей внутри храма:
     имена похожи, и матчер по имени честно их сводит. Но если у одной
     записи другая стоит в Parent POI, вопрос уже решён человеком —
     держать это в списке на слияние значит звать чинить починенное.
     Неразмеченные похожие пары остаются в отчёте: там решение нужно. */
  const byRecordId = new Map(pois.filter((p) => p.recordId).map((p) => [p.recordId, p.poiId]))
  const linked = new Set()
  for (const p of pois) {
    for (const parentRecordId of p.parentPoi ?? []) {
      const parentPoiId = byRecordId.get(parentRecordId)
      if (parentPoiId) linked.add([p.poiId, parentPoiId].sort().join('|'))
    }
  }

  const seen = new Set()
  const pairs = []
  for (let i = 0; i < live.length; i += 1) {
    const others = live.filter((_, j) => j !== i)
    const screen = screenNewPoi(live[i], others)
    const match = screen.blockingDuplicate
    if (!match) continue
    const key = [live[i].poiId, match.candidate.poiId].sort().join('|')
    if (seen.has(key) || linked.has(key)) continue
    seen.add(key)
    pairs.push(`${live[i].poiId} «${live[i].nameRu}» ⟷ ${match.candidate.poiId} «${match.candidate.nameRu}» (${match.score})`)
  }
  if (pairs.length) {
    add('FAIL', 'duplicates', 'Дубли в базе', 'Слить, оставив ID, на который есть ссылки с живых страниц.', pairs)
  }
}

/**
 * 4. Текст, видимый публично при неутверждённом статусе.
 *
 * Сайт рендерит `poi.approvedRu || poi.descriptionRu`
 * (src/lib/intercity-pois.ts:255), а публичные выборки фильтруют только
 * `NOT({Is System})` — Copy Status в отборе не участвует ВООБЩЕ. Значит
 * заполненное «Description Approved (RU)» попадает на страницу независимо
 * от того, доведён ли текст до статуса Synced.
 *
 * На момент аудита ни одна такая запись не стояла в маршруте — но это
 * везение, а не защита: достаточно поставить точку в маршрут.
 */
function checkUnapprovedOnLive(pois, stops) {
  const inRoute = new Set(stops.map((s) => s.poiId).filter(Boolean))
  const risky = pois.filter(
    (p) => p.approvedRu && p.copyStatus !== 'Synced' && p.copyStatus !== 'Approved',
  )
  const onLive = risky.filter((p) => inRoute.has(p.poiId))
  if (onLive.length) {
    add('FAIL', 'unapproved_on_live', 'Неутверждённый текст стоит в живом маршруте',
      'Copy Status не участвует в отборе на публикацию — текст уже виден.',
      onLive.map((p) => `${p.poiId} «${p.nameRu}» [${p.copyStatus || 'без статуса'}]`))
  } else if (risky.length) {
    add('WARN', 'unapproved_text', 'Есть неутверждённый текст, готовый к публикации',
      `${risky.length} записей с заполненным Approved-текстом вне статусов Approved/Synced. ` +
      'Пока ни одна не стоит в маршруте — но защиты от этого в коде нет.',
      risky.slice(0, 10).map((p) => `${p.poiId} «${p.nameRu}» [${p.copyStatus || 'без статуса'}]`))
  }
}

/** 5. Точка в маршруте вообще без описания — пустая карточка на сайте. */
function checkEmptyOnLive(pois, stops) {
  const byId = new Map(pois.map((p) => [p.poiId, p]))
  const empty = []
  for (const s of stops) {
    if (!s.poiId) continue
    const p = byId.get(s.poiId)
    if (p && !p.approvedRu && !p.descriptionRu && !s.descriptionOverride) {
      empty.push(`${s.routeSlug} №${s.order} ${s.poiId} «${p.nameRu}»`)
    }
  }
  if (empty.length) {
    add('FAIL', 'empty_on_live', 'Точка маршрута без описания', 'На странице будет пустая карточка.', empty)
  }
}

/** 6. Снимок имени в остановке разошёлся с базой — на сайте старое имя. */
function checkSnapshotDrift(pois, stops) {
  const byId = new Map(pois.map((p) => [p.poiId, p]))
  const drift = []
  for (const s of stops) {
    if (!s.poiId || !s.nameSnapshot) continue
    const p = byId.get(s.poiId)
    if (p && p.nameRu && p.nameRu.trim() !== s.nameSnapshot.trim()) {
      drift.push(`${s.stopId}: снимок «${s.nameSnapshot}» ≠ база «${p.nameRu}»`)
    }
  }
  if (drift.length) {
    add('WARN', 'snapshot_drift', 'Имя остановки разошлось с именем POI',
      'Снимок — денормализованная копия, она не обновляется автоматически.', drift)
  }
}

/** 7. Остановка без ссылки на POI: страница живёт на одном снимке имени. */
function checkStopsWithoutPoi(stops) {
  const orphan = stops.filter((s) => !s.poiId)
  if (orphan.length) {
    add('WARN', 'stop_without_poi', 'Остановка не привязана к POI',
      'Ни описания, ни часов, ни фото из базы — только текст в самой остановке.',
      orphan.map((s) => `${s.routeSlug} №${s.order} «${s.nameSnapshot}»`))
  }
}

/** 8. Иерархия: висячие ссылки, самоссылки, циклы. */
function checkHierarchy(pois) {
  /* Parent POI — связанное поле: Airtable отдаёт в нём record id (rec…),
     а не человекочитаемый POI ID. Проверка сравнивала одно с другим, и
     потому «удалённым родителем» объявлялась КАЖДАЯ запись, у которой
     родитель просто есть: 9 августа это дало 55 «поломок» на ровном
     месте, все пятьдесят пять родителей нашлись в базе живыми. Тем же
     был сломан и поиск циклов: обход шёл по record id, а parents.has()
     смотрел по POI ID — настоящий цикл не нашёлся бы никогда.

     Сверяем по record id, показываем POI ID: в интерфейсе виден он. */
  const byRecordId = new Map(pois.filter((p) => p.recordId).map((p) => [p.recordId, p]))
  if (!byRecordId.size) {
    add('SKIP', 'no_record_ids', 'Иерархия Parent POI не проверена',
      'В источнике нет record id — связи проверяются только по живой базе.')
    return
  }
  const label = (recordId) => byRecordId.get(recordId)?.poiId ?? recordId

  const parents = new Map(
    pois.filter((p) => p.recordId && p.parentPoi?.length).map((p) => [p.recordId, p.parentPoi]),
  )
  const dangling = []
  const selfref = []
  for (const [child, ps] of parents) {
    for (const p of ps) {
      if (!byRecordId.has(p)) dangling.push(`${label(child)} → ${p}`)
      if (p === child) selfref.push(label(child))
    }
  }
  const cycles = []
  for (const start of parents.keys()) {
    const path = []
    let node = start
    while (node && parents.has(node)) {
      if (path.includes(node)) { cycles.push(path.map(label).join(' → ')); break }
      path.push(node)
      node = parents.get(node)[0]
    }
  }
  if (dangling.length) add('FAIL', 'parent_dangling', 'Parent POI указывает на удалённую запись', '', dangling)
  if (selfref.length) add('FAIL', 'parent_self', 'POI назначен родителем самому себе', '', selfref)
  if (cycles.length) add('FAIL', 'parent_cycle', 'Цикл в иерархии Parent POI', 'Обход дерева зациклится.', cycles)
}

/** 9. Слаги городов: дробление и опечатки. */
function checkCitySlugs(pois) {
  const counts = new Map()
  for (const p of pois) {
    if (p.isSystem || !p.siteCity) continue
    counts.set(p.siteCity, (counts.get(p.siteCity) ?? 0) + 1)
  }
  const slugs = [...counts.keys()]
  const cyrillic = slugs.filter((s) => /[А-Яа-яЁё]/.test(s))
  if (cyrillic.length) {
    add('FAIL', 'city_slug_cyrillic', 'Слаг города записан кириллицей',
      'getPoisByCity ищет точным совпадением — такие записи выпадают из выборки по городу.',
      cyrillic.map((s) => `«${s}» (${counts.get(s)} записей)`))
  }
  const overlapping = []
  for (const a of slugs) {
    for (const b of slugs) {
      if (a >= b) continue
      if (a.includes(b) || b.includes(a)) overlapping.push(`${a} (${counts.get(a)}) ⟷ ${b} (${counts.get(b)})`)
    }
  }
  if (overlapping.length) {
    add('WARN', 'city_slug_overlap', 'Похожие слаги городов',
      'Возможно дробление одного города. getPoisByCity увидит только один из них.', overlapping)
  }
}

/** 10. Незаполненные поля — гигиена, не поломка. */
function checkCompleteness(pois) {
  const live = pois.filter((p) => !p.isSystem)
  const noCategory = live.filter((p) => !p.category?.length)
  const noStatus = live.filter((p) => !p.copyStatus)
  const noCity = live.filter((p) => !p.siteCity)
  if (noCity.length) {
    add('FAIL', 'no_city', 'POI без города и без флага Is System',
      'Не попадёт ни в одну выборку по городу и не отсеётся как служебная запись.',
      noCity.map((p) => `${p.poiId} «${p.nameRu}»`))
  }
  if (noCategory.length) {
    add('WARN', 'no_category', 'POI без категории',
      `${noCategory.length} из ${live.length}. Категория нужна для подбора точек под интересы гостя.`)
  }
  if (noStatus.length) {
    add('WARN', 'no_copy_status', 'POI без Copy Status',
      `${noStatus.length} записей вне редакционного конвейера.`)
  }
}

/**
 * 10. Координаты: половина пары, точка вне Японии, совпадающие точки.
 *
 * Поля Latitude/Longitude заведены 6 августа 2026 вместе с гейтом приёма.
 * Гейт сравнивает расстояние между точками, поэтому испорченная координата
 * дороже отсутствующей: она принимает решение, а проверить её нечем.
 * Три класса ошибок, каждый ловится здесь:
 *   — половина пары: одну координату записали, вторую нет. Точку нельзя
 *     поставить на карту, но поле выглядит заполненным;
 *   — перестановка широты и долготы — самая частая ошибка внешних
 *     источников, и в Японии она видна сразу: долгота 122–154, широта
 *     столько быть не может;
 *   — две записи в одной точке. Не всегда ошибка (ворота и главный зал
 *     храма стоят рядом), поэтому WARN, а не FAIL.
 */
function checkCoords(pois) {
  const live = pois.filter((p) => !p.isSystem)
  const half = live.filter((p) => (p.lat === null) !== (p.lon === null))
  const outside = live.filter(
    (p) => p.lat !== null && p.lon !== null &&
      (p.lat < 20 || p.lat > 46.5 || p.lon < 122 || p.lon > 154),
  )
  const withCoords = live.filter((p) => p.lat !== null && p.lon !== null && !outside.includes(p))

  if (half.length) {
    add('FAIL', 'coords_half', 'Записана одна координата из двух',
      'На карту такую точку не поставить, а поле выглядит заполненным.',
      half.map((p) => `${p.poiId} «${p.nameRu}» — lat ${p.lat ?? '—'}, lon ${p.lon ?? '—'}`))
  }
  if (outside.length) {
    add('FAIL', 'coords_outside_japan', 'Точка лежит вне Японии',
      'Либо переставлены широта и долгота, либо источник дал координаты другого объекта.',
      outside.map((p) => `${p.poiId} «${p.nameRu}» — ${p.lat}, ${p.lon}`))
  }

  // Пары ближе 30 метров. Порог грубее точности поля (седьмой знак — это
  // сантиметры) и грубее разброса источников, но тоньше расстояния между
  // соседними постройками комплекса.
  const near = []
  for (let i = 0; i < withCoords.length; i += 1) {
    for (let j = i + 1; j < withCoords.length; j += 1) {
      const d = haversineMeters(withCoords[i], withCoords[j])
      if (d !== null && d <= 30) {
        near.push(`${withCoords[i].poiId} «${withCoords[i].nameRu}» ⟷ ${withCoords[j].poiId} «${withCoords[j].nameRu}» — ${Math.round(d)} м`)
      }
    }
  }
  if (near.length) {
    add('WARN', 'coords_same_point', 'Две записи в одной точке',
      'Либо дубль, либо части одного комплекса. Проверьте и проставьте Parent POI.', near)
  }

  // Считаем ПУСТЫЕ, а не «всё остальное»: испорченные координаты уже
  // отчитались выше как FAIL, и попадать в этот счётчик второй раз им
  // незачем — иначе цифра «без координат» перестаёт значить «нечего чинить,
  // надо заполнить».
  const missing = live.filter((p) => p.lat === null && p.lon === null).length
  if (missing > 0) {
    add('WARN', 'coords_missing', 'POI без координат',
      `${missing} из ${live.length}. Без координат дедуп по расстоянию не работает — остаётся только сравнение имён.`)
  }
}

/**
 * 11. Русское описание без английского.
 *
 * Замер 06.08.2026: 121 запись из 431 с русским текстом и без единого
 * английского, обратных случаев — ноль. Односторонний перекос означает
 * не случайные пропуски, а незакрытый путь записи: исследователь возвращал
 * английский текст, а конвейер его молча терял.
 *
 * Путь закрыт (канон больше не принимает описание без пары), но уже
 * заведённые записи чинятся только руками, и знать их количество нужно.
 */
function checkDescriptionPairs(pois) {
  const live = pois.filter((p) => !p.isSystem)
  const pairs = [
    ['Description', 'descriptionRu', 'descriptionEn'],
    ['Description Draft', 'draftRu', 'draftEn'],
    ['Description Approved', 'approvedRu', 'approvedEn'],
  ]
  const orphaned = new Set()
  for (const [label, ru, en] of pairs) {
    const half = live.filter((p) => p[ru] && !p[en])
    if (!half.length) continue
    for (const p of half) orphaned.add(p.poiId)
    add('WARN', `desc_half_${ru}`, `«${label}»: русский текст без английского`,
      `${half.length} записей. Карточка места выйдет наполовину пустой.`,
      half.slice(0, 10).map((p) => `${p.poiId} «${p.nameRu}»`))
  }
  if (orphaned.size) {
    add('WARN', 'desc_no_english', 'Записи без английского текста вообще',
      `${orphaned.size} из ${live.length}. Заводить новые такими канон больше не даёт, эти — наследие.`)
  }
}

// ── Прогон ──────────────────────────────────────────────────────────────

async function loadLive() {
  const poiRecords = await fetchAll(POI_TABLE_ID, [
    'POI ID', 'POI Name (RU)', 'POI Name (EN)', 'Site City', 'POI Category (RU)',
    'Copy Status', 'Is System', 'Parent POI', 'Description (RU)',
    'Description Approved (RU)', 'Working Hours', 'Latitude', 'Longitude',
    'Description (EN)', 'Description Draft (EN)', 'Description Approved (EN)',
    'Description Draft (RU)',
  ])
  const stopRecords = await fetchAll(ROUTE_STOPS_TABLE_ID, [
    'Route Stop ID', 'Route Slug', 'POI ID', 'POI Name Snapshot', '№', 'Status', 'Description Override',
  ])

  const pois = poiRecords.map((r) => ({
    recordId: r.id,
    poiId: text(r.fields, 'POI ID'),
    nameRu: text(r.fields, 'POI Name (RU)'),
    nameEn: text(r.fields, 'POI Name (EN)'),
    siteCity: text(r.fields, 'Site City'),
    category: r.fields['POI Category (RU)'] ?? [],
    copyStatus: typeof r.fields['Copy Status'] === 'string' ? r.fields['Copy Status'] : '',
    isSystem: r.fields['Is System'] === true,
    parentPoi: Array.isArray(r.fields['Parent POI']) ? r.fields['Parent POI'] : [],
    descriptionRu: text(r.fields, 'Description (RU)'),
    approvedRu: text(r.fields, 'Description Approved (RU)'),
    descriptionEn: text(r.fields, 'Description (EN)'),
    draftRu: text(r.fields, 'Description Draft (RU)'),
    draftEn: text(r.fields, 'Description Draft (EN)'),
    approvedEn: text(r.fields, 'Description Approved (EN)'),
    workingHours: text(r.fields, 'Working Hours'),
    lat: typeof r.fields['Latitude'] === 'number' ? r.fields['Latitude'] : null,
    lon: typeof r.fields['Longitude'] === 'number' ? r.fields['Longitude'] : null,
  }))

  const stops = stopRecords
    .filter((r) => {
      const status = r.fields['Status']
      return typeof status !== 'string' || status !== 'Archived'
    })
    .map((r) => ({
      stopId: text(r.fields, 'Route Stop ID'),
      routeSlug: text(r.fields, 'Route Slug'),
      poiId: text(r.fields, 'POI ID'),
      nameSnapshot: text(r.fields, 'POI Name Snapshot'),
      order: r.fields['№'] ?? null,
      descriptionOverride: text(r.fields, 'Description Override'),
    }))

  return { pois, stops, hasContentFields: true }
}

async function loadFixture(dir) {
  const pois = JSON.parse(await readFile(`${dir}/poi-base.json`, 'utf8')).map((r) => ({
    // Record id есть не в каждом дампе; без него проверка иерархии
    // пропускается вслух, а не врёт (см. checkHierarchy).
    recordId: r.recordId ?? r.id ?? '',
    poiId: r.poiId, nameRu: r.nameRu, nameEn: r.nameEn, siteCity: r.siteCity,
    category: r.category ?? [], copyStatus: r.copyStatus ?? '', isSystem: Boolean(r.f_V85),
    parentPoi: r.f_uxL ?? [], descriptionRu: '', approvedRu: '', workingHours: '',
    descriptionEn: '', draftRu: '', draftEn: '', approvedEn: '',
    // Координаты в дампе есть не всегда, но если есть — проверяются:
    // это единственный способ прогнать checkCoords без сети.
    lat: typeof r.lat === 'number' ? r.lat : null,
    lon: typeof r.lon === 'number' ? r.lon : null,
  }))
  const raw = JSON.parse(await readFile(`${dir}/stops.json`, 'utf8'))
  const stops = raw.map(([stopId, routeSlug, poiId, nameSnapshot, order]) => ({
    stopId, routeSlug, poiId: poiId ?? '', nameSnapshot, order, descriptionOverride: '',
  }))
  // В дампе нет текстовых полей, поэтому проверки публикации на нём
  // не запускаются: иначе они отрапортовали бы, что описания нет ни у одной
  // точки маршрута. Отсутствие данных не то же самое, что найденная ошибка.
  return { pois, stops, hasContentFields: false }
}

async function main() {
  const argv = process.argv.slice(2)
  const asJson = argv.includes('--json')
  const fixtureIndex = argv.indexOf('--fixture')

  // Нет ключей и нет дампа — проверять нечем. Это не поломка базы, а
  // отсутствие доступа к ней; раньше скрипт падал с кодом 2, и в CI такой
  // выход неотличим от настоящего провала. Тот же контракт, что у
  // check:copy, check:images и check:polivanov: пропуск — не провал.
  if (fixtureIndex < 0 && !TOKEN) {
    console.log('⚠ Целостность POI пропущена: нет AIRTABLE_TOKEN. Запустите с ключами или с --fixture <файл>.')
    return
  }

  const { pois, stops, hasContentFields } =
    fixtureIndex >= 0 ? await loadFixture(argv[fixtureIndex + 1]) : await loadLive()

  checkDanglingStops(pois, stops)
  checkStopPoiCollision(stops)
  checkDuplicates(pois)
  if (hasContentFields) {
    checkUnapprovedOnLive(pois, stops)
    checkEmptyOnLive(pois, stops)
  } else {
    add('SKIP', 'no_content_fields', 'Проверки публикации пропущены',
      'В источнике нет текстовых полей — запустите без --fixture, чтобы проверить их.')
  }
  checkSnapshotDrift(pois, stops)
  checkStopsWithoutPoi(stops)
  checkHierarchy(pois)
  checkCitySlugs(pois)
  checkCompleteness(pois)
  checkCoords(pois)
  if (hasContentFields) checkDescriptionPairs(pois)

  const fails = findings.filter((f) => f.level === 'FAIL')

  if (asJson) {
    console.log(JSON.stringify({ pois: pois.length, stops: stops.length, findings }, null, 2))
  } else {
    console.log(`\nЦЕЛОСТНОСТЬ БАЗЫ POI — ${pois.length} точек, ${stops.length} остановок\n`)
    if (!findings.length) console.log('  Замечаний нет.')
    for (const f of findings) {
      const mark = f.level === 'FAIL' ? '✗ ПОЛОМКА ' : '! внимание'
      console.log(`${mark} ${f.title}${f.count ? ` — ${f.count}` : ''}`)
      if (f.detail) console.log(`           ${f.detail}`)
      for (const item of f.items) console.log(`             ${item}`)
      if (f.count > f.items.length) console.log(`             … ещё ${f.count - f.items.length}`)
      console.log()
    }
    console.log(fails.length ? `ПОЛОМОК: ${fails.length}` : 'Поломок нет.')
  }

  process.exitCode = fails.length ? 1 : 0
}

main().catch((error) => {
  console.error(`[check-poi] ${error.message}`)
  process.exitCode = 2
})
