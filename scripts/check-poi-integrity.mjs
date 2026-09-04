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
import { describeIdentityIssues, haversineMeters, screenNewPoi } from '../src/lib/poi-matching.ts'
import { KNOWN_INTAKE_CONTRACT_VERSIONS, parseIntakeOrigin } from '../src/lib/poi-ingest.ts'
import {
  coordinatePolicyAgreesWithCoords,
  COORDINATE_POLICIES as COORDINATE_POLICY_VALUES,
} from '../src/lib/poi-coordinate-policy.ts'
import { describeTaxonomySchemaDiff, diffTaxonomySchema, findPoiTable } from '../src/lib/poi-taxonomy-airtable.ts'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

/**
 * С какого момента запись ОБЯЗАНА нести маркеры приёма.
 *
 * Значение снято с живой базы read-only 11.08.2026: 466 записей, маркеры
 * ровно у нуля, самая новая запись создана 10.08.2026 в 10:50:57 UTC. Порог
 * поставлен НЕ ПОЗЖЕ момента снимка — на начало того же дня, — и больше не
 * двигается.
 *
 * Почему не позже. Порог в будущем открывает слепое окно: запись, заведённая
 * руками между снимком и порогом, навсегда осталась бы наследием, и обход
 * конвейера был бы легализован задним числом. Ровно тот случай, ради
 * которого проверка и писалась.
 *
 * Почему не двигается. Запись без маркеров после порога — это находка, а не
 * ложная тревога: либо её завели мимо конвейера, либо в production ещё висит
 * сборка без маркеров. Оба случая надо увидеть и разобрать, а не заглушить
 * сдвигом даты. Двигать порог вслед за находками значит превратить проверку
 * в такую, которая всегда согласна с базой.
 *
 * Записи ДО порога маркеров не имеют и иметь не могут: их заводил код,
 * который в эти поля не писал. Проставить им происхождение задним числом
 * значило бы его выдумать.
 */
const INTAKE_MARKERS_REQUIRED_FROM = '2026-08-11T00:00:00.000Z'

const TOKEN = process.env.AIRTABLE_TOKEN?.trim() ?? ''
const BASE_ID = process.env.AIRTABLE_BASE_ID?.trim() ?? 'apppwhjFN82N9zNqm'

// Список значений один на весь проект и живёт рядом с путём записи:
// сторож и писатель, державшие параллельные перечисления, разошлись бы молча.
const COORDINATE_POLICIES = new Set(COORDINATE_POLICY_VALUES)

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

/**
 * Живая схема таблицы POI через Meta API. Чтение, не запись. Отказ (нет
 * scope `schema.bases:read`, сеть) возвращается значением, а не бросается:
 * сторож обязан сказать «схему проверить не смог», а не молча пропустить.
 */
async function fetchSchema() {
  const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }, cache: 'no-store' })
  if (!res.ok) return { fields: null, error: `${res.status} ${await res.text()}` }
  const data = await res.json()
  const found = findPoiTable(data?.tables)
  if (!found.ok) return { fields: null, error: found.reason }
  return { fields: found.table.fields ?? [], error: null }
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
  /* Пары, у которых совпал объект коллекции, но равенство самих коллекций
     доказать нечем: имена коллекций в разных алфавитах и транслитерацией
     не сошлись. Это НЕ команда на слияние — сливать по совпавшему объекту
     нельзя, — но и не пустое место: до 13.08.2026 такая пара нигде не
     показывалась, а утверждение «пропущенный дубль виден в отчёте» было
     ложным. Отдельный код находки и отдельный уровень: WARN, не FAIL. */
  const unverified = new Set()
  const unverifiedPairs = []
  /* Вторая непроверяемая гипотеза: совпала основа имени, различаются только
     скобки. Отдельный код находки — причина другая и решение другое. */
  const qualifierSeen = new Set()
  const qualifierPairs = []
  /* Третья гипотеза: оси имён противоречат друг другу — русские имена
     совпали, английские относят записи к разным коллекциям. */
  const conflictSeen = new Set()
  const conflictPairs = []
  for (let i = 0; i < live.length; i += 1) {
    const others = live.filter((_, j) => j !== i)
    const screen = screenNewPoi(live[i], others)
    for (const m of screen.unverifiedCollection) {
      const uKey = [live[i].poiId, m.candidate.poiId].sort().join('|')
      if (unverified.has(uKey) || linked.has(uKey)) continue
      unverified.add(uKey)
      unverifiedPairs.push(
        `${live[i].poiId} «${live[i].nameRu}» ⟷ ${m.candidate.poiId} «${m.candidate.nameRu}» (вес ${m.score} по оси ${m.basis}; расхождения: ${describeIdentityIssues(m.issues)})`,
      )
    }
    for (const m of screen.unverifiedQualifier) {
      const qKey = [live[i].poiId, m.candidate.poiId].sort().join('|')
      /* Прямая связь через Parent POI = отношение пары уже разобрано
         человеком. Тот же контракт, что у duplicates: повторять вопрос,
         на который уже ответили разметкой, значит звать чинить починенное.
         ОБЩИЙ родитель сюда не входит — он ничего не говорит о паре. */
      if (qualifierSeen.has(qKey) || linked.has(qKey)) continue
      qualifierSeen.add(qKey)
      qualifierPairs.push(
        `${live[i].poiId} «${live[i].nameRu}» ⟷ ${m.candidate.poiId} «${m.candidate.nameRu}» (вес ${m.score} по оси ${m.basis}; расхождения: ${describeIdentityIssues(m.issues)})`,
      )
    }
    for (const m of screen.conflictingCollection) {
      const cKey = [live[i].poiId, m.candidate.poiId].sort().join('|')
      if (conflictSeen.has(cKey) || linked.has(cKey)) continue
      conflictSeen.add(cKey)
      conflictPairs.push(
        `${live[i].poiId} «${live[i].nameRu}» ⟷ ${m.candidate.poiId} «${m.candidate.nameRu}» (вес ${m.score} по оси ${m.basis}; расхождения: ${describeIdentityIssues(m.issues)})`,
      )
    }
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
  if (unverifiedPairs.length) {
    add('WARN', 'collection_identity_unverified',
      'Равенство коллекций не подтверждено',
      'Объект совпал, а имена коллекций записаны разными письменностями и транслитерацией не сходятся. ' +
      'Сливать по этому признаку НЕЛЬЗЯ: так же выглядит и перевод одной коллекции, и чужая коллекция. ' +
      'Проверьте вручную, один ли это объект. Один — объединить записи, оставив ID, на который есть ссылки. ' +
      'Разные объекты или части одного комплекса — оставить обе записи; Parent POI проставлять ТОЛЬКО если ' +
      'настоящая родительская запись существует, выдумывать связь ради закрытия предупреждения нельзя.',
      unverifiedPairs)
  }
  if (conflictPairs.length) {
    add('WARN', 'collection_identity_conflict',
      'Оси имён расходятся по коллекции',
      'Русское и английское имя пары записей не согласованы: по одним полям это тот же объект, ' +
      'по другим — разные коллекции. Какое из полей ошибочно, по этим данным не установить. ' +
      'Проверьте вручную, один ли это объект, и приведите имена в соответствие. ' +
      'Один объект — объединить записи; разные — оставить обе и привести имена в соответствие. ' +
      'Связь с родителем указывать только если такая запись действительно есть.',
      conflictPairs)
  }
  if (qualifierPairs.length) {
    add('WARN', 'qualifier_identity_unverified',
      'Уточнения в скобках не сверены',
      'Основа имени совпала посимвольно, различаются только скобки, и доказать их равенство или различие нечем: ' +
      'происхождение имени матчеру неизвестно, скобочную часть мог написать портал, файл имён, транслитерация или модель. ' +
      'Проверьте вручную, один ли это объект. Один — объединить записи. ' +
      'Разные — оставить обе; связь с родителем указывать только если такая запись действительно есть.',
      qualifierPairs)
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
  const unknownPolicy = live.filter(
    (p) => p.coordinatePolicy && !COORDINATE_POLICIES.has(p.coordinatePolicy),
  )
  // Правило согласия живёт рядом с путём записи и импортируется, а не
  // повторяется здесь: повторённое, оно разошлось бы с писателем молча.
  // Неизвестное значение с 1 сентября 2026 года не согласуется ни с какими
  // координатами (fail-closed), но о нём уже сказано отдельным FAIL выше.
  // Второй раз в списке противоречий оно не нужно: это одна поломка.
  const policyMismatch = live.filter((p) => !unknownPolicy.includes(p)
    && !coordinatePolicyAgreesWithCoords(p.coordinatePolicy, p.lat, p.lon))
  const half = live.filter((p) => (p.lat === null) !== (p.lon === null))
  const outside = live.filter(
    (p) => p.lat !== null && p.lon !== null &&
      (p.lat < 20 || p.lat > 46.5 || p.lon < 122 || p.lon > 154),
  )
  const withCoords = live.filter((p) => p.lat !== null && p.lon !== null && !outside.includes(p))

  if (unknownPolicy.length) {
    add('FAIL', 'coords_policy_unknown', 'Неизвестная политика координат',
      'Допустимы exactObjectPoint, representativePoint и notApplicable. Неизвестное значение не считается исключением из очереди.',
      unknownPolicy.map((p) => `${p.poiId} «${p.nameRu}» — ${p.coordinatePolicy}`))
  }
  if (policyMismatch.length) {
    add('FAIL', 'coords_policy_mismatch', 'Политика координат противоречит данным',
      'notApplicable требует пустую пару Latitude/Longitude; exactObjectPoint и representativePoint требуют полную пару.',
      policyMismatch.map((p) => `${p.poiId} «${p.nameRu}» — ${p.coordinatePolicy}; lat ${p.lat ?? '—'}, lon ${p.lon ?? '—'}`))
  }

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
  const missing = live.filter(
    (p) => p.lat === null && p.lon === null && p.coordinatePolicy !== 'notApplicable',
  ).length
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


/**
 * 14. Маркеры приёма: заведена ли запись конвейером.
 *
 * Тройка `Intake Run ID` / `Intake Origin` / `Intake Contract Version`
 * проверяется АТОМАРНО. Заполненная наполовину она хуже пустой: пустая
 * честно говорит «я старше маркеров», а половинчатая утверждает, что путь
 * пройден, и при этом не даёт ни собрать запуск целиком, ни назвать код,
 * который писал.
 *
 * Возраст решает только в одном месте — когда пусты все три. До порога это
 * наследие и не ошибка; после — запись заведена мимо конвейера. Всё
 * остальное ошибка независимо от возраста: половинчатый маркер, неразбираемый
 * origin и незнакомая версия не могут появиться у старой записи, потому что
 * старый код в эти поля не писал вовсе.
 */
function checkIntakeMarkers(pois) {
  const threshold = Date.parse(INTAKE_MARKERS_REQUIRED_FROM)
  const where = (p) => `${p.recordId || '—'} ${p.poiId || '—'} «${p.nameRu}» (создана ${p.createdTime || 'без даты'})`

  const legacy = []
  const bypassed = []
  const noDate = []
  const partial = []
  const badOrigin = []
  const badVersion = []
  const runs = new Map()

  for (const p of pois) {
    const runId = (p.intakeRunId ?? '').trim()
    const origin = (p.intakeOrigin ?? '').trim()
    const version = (p.intakeContractVersion ?? '').trim()
    const filled = [runId, origin, version].filter(Boolean).length

    if (filled === 0) {
      const created = Date.parse(p.createdTime || '')
      if (!Number.isFinite(created)) {
        // Возраст неизвестен — значит неизвестно и то, обязана ли запись
        // нести маркеры. Считать её наследием было бы fail-open: достаточно
        // испортить одну дату, чтобы обход перестал находиться.
        noDate.push(`${where(p)} — createdTime «${p.createdTime || 'отсутствует'}»`)
      } else if (created >= threshold) {
        bypassed.push(where(p))
      } else {
        legacy.push(p)
      }
      continue
    }

    if (filled < 3) {
      const missing = [
        runId ? '' : 'Intake Run ID',
        origin ? '' : 'Intake Origin',
        version ? '' : 'Intake Contract Version',
      ].filter(Boolean)
      partial.push(`${where(p)} — пусто: ${missing.join(', ')}`)
      continue
    }

    if (!parseIntakeOrigin(origin)) badOrigin.push(`${where(p)} — origin «${origin}»`)
    if (!KNOWN_INTAKE_CONTRACT_VERSIONS.includes(version)) {
      badVersion.push(`${where(p)} — версия «${version}»`)
    }

    const group = runs.get(runId) ?? { origins: new Set(), versions: new Set(), items: [] }
    group.origins.add(origin)
    group.versions.add(version)
    group.items.push(p)
    runs.set(runId, group)
  }

  if (bypassed.length) {
    add('FAIL', 'intake_bypassed', 'Запись заведена мимо конвейера приёма',
      `Создана после ${INTAKE_MARKERS_REQUIRED_FROM} и не несёт ни одного маркера. Так в базу попадают записи, заведённые руками в интерфейсе Airtable или скриптом в обход ingestPoi.`,
      bypassed)
  }
  if (noDate.length) {
    add('FAIL', 'intake_created_time_invalid', 'Пустой маркер при неизвестной дате создания',
      'Без даты нельзя сказать, старше запись порога маркеров или заведена мимо конвейера. Неизвестный возраст разбирается вручную, а не засчитывается в наследие.',
      noDate)
  }
  if (partial.length) {
    add('FAIL', 'intake_marker_partial', 'Маркер приёма заполнен наполовину',
      'Тройка ставится одной операцией до создания записи, поэтому неполная означает либо правку руками, либо код, который пишет поля сам.',
      partial)
  }
  if (badOrigin.length) {
    add('FAIL', 'intake_origin_invalid', 'Intake Origin не той формы',
      'Ожидается «вид-источника:идентификатор», где вид из перечня, а идентификатор — слаг строчными. Значение, которое нельзя разобрать, записано не конвейером.',
      badOrigin)
  }
  if (badVersion.length) {
    add('FAIL', 'intake_version_unknown', 'Незнакомая версия контракта приёма',
      `Известны: ${KNOWN_INTAKE_CONTRACT_VERSIONS.join(', ')}. Иная версия значит, что запись заведена кодом, которого в репозитории нет.`,
      badVersion)
  }

  // Один запуск — один источник и один контракт. Разнобой внутри группы
  // означает, что идентификатор запуска переиспользован: собрать по нему
  // приём целиком больше нельзя, а именно ради этого он и заводился.
  const mixed = []
  for (const [runId, group] of runs) {
    // Две независимые проверки, а не ветка «иначе»: запуск может разойтись
    // и по источнику, и по версии сразу, и вторая половина не должна
    // прятаться за первой.
    if (group.origins.size > 1) {
      mixed.push(`${runId}: origin ${[...group.origins].join(' и ')} (${group.items.length} записей)`)
    }
    if (group.versions.size > 1) {
      mixed.push(`${runId}: версии ${[...group.versions].join(' и ')} (${group.items.length} записей)`)
    }
  }
  if (mixed.length) {
    add('FAIL', 'intake_run_inconsistent', 'Один Run ID с разными origin или версиями',
      'Идентификатор запуска переиспользован. Собрать по нему приём целиком больше нельзя.',
      mixed)
  }

  if (legacy.length) {
    add('INFO', 'intake_legacy', 'Записи старше маркеров приёма',
      `${legacy.length} из ${pois.length} заведены до ${INTAKE_MARKERS_REQUIRED_FROM}. Это не ошибка. Проставлять им маркеры задним числом нельзя: происхождение было бы выдумано.`)
  }
}

// ── Прогон ──────────────────────────────────────────────────────────────

/**
 * 15. Схема POI против реестра таксономии v2 (10f-P, P04.3).
 *
 * Та же `diffTaxonomySchema`, что и в preflight writeRun: сторож и писатель
 * читают одну связь. Три исхода различаются намеренно:
 *   • полей нет — миграция L3 ещё не выполнена; writeRun в этом состоянии
 *     останавливается сам, поэтому здесь это предупреждение, а не поломка;
 *   • поле есть, но тип или опции не те — дрейф схемы, ПОЛОМКА: значение
 *     реестра в такое поле не запишется или запишется с чужим смыслом;
 *   • схему прочитать не удалось — сказано вслух, без вывода о её состоянии.
 */
function checkTaxonomySchema(schema) {
  if (!schema) {
    add('SKIP', 'taxonomy_schema_unchecked', 'Схема таксономии не проверена',
      'В дампе нет schema.json — запустите без --fixture, чтобы сверить живую схему с реестром.')
    return
  }
  if (schema.error) {
    add('WARN', 'taxonomy_schema_unavailable', 'Схема таксономии недоступна',
      `Meta API: ${schema.error}. Токену нужен scope schema.bases:read; writeRun без этой проверки записей не создаёт.`)
    return
  }
  const diff = diffTaxonomySchema(schema.fields)
  if (diff.missing.length) {
    add('WARN', 'taxonomy_schema_missing', 'Схема POI без полей таксономии v2',
      'writeRun остановится до первой записи. Поля добавляются только цепочкой scripts/poi-schema по замороженной карточке (tmp/10f-p-r5-l3-card-taxonomy-schema-2026-09-03.json) и отдельному разрешению.',
      diff.missing)
  }
  if (diff.mismatched.length) {
    add('FAIL', 'taxonomy_schema_drift', 'Схема таксономии расходится с реестром',
      describeTaxonomySchemaDiff({ ...diff, missing: [] }),
      diff.mismatched.map((m) => `${m.field}: ${m.reason}`))
  }
}

async function loadLive() {
  const schema = await fetchSchema()
  const poiRecords = await fetchAll(POI_TABLE_ID, [
    'POI ID', 'POI Name (RU)', 'POI Name (EN)', 'Site City', 'POI Category (RU)',
    'Copy Status', 'Is System', 'Parent POI', 'Description (RU)',
    'Description Approved (RU)', 'Working Hours', 'Latitude', 'Longitude',
    'Coordinate Policy',
    'Description (EN)', 'Description Draft (EN)', 'Description Approved (EN)',
    'Description Draft (RU)',
    'Intake Run ID', 'Intake Origin', 'Intake Contract Version',
  ])
  const stopRecords = await fetchAll(ROUTE_STOPS_TABLE_ID, [
    'Route Stop ID', 'Route Slug', 'POI ID', 'POI Name Snapshot', '№', 'Status',
    'Stop Description Override Approved (RU)', 'Description Override',
  ])

  const pois = poiRecords.map((r) => ({
    recordId: r.id,
    // createdTime отдаёт сам Airtable, полем это не является. Порог маркеров
    // сравнивается именно с ним: возраст записи нельзя взять из её полей.
    createdTime: r.createdTime ?? '',
    intakeRunId: text(r.fields, 'Intake Run ID'),
    intakeOrigin: text(r.fields, 'Intake Origin'),
    intakeContractVersion: text(r.fields, 'Intake Contract Version'),
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
    coordinatePolicy: text(r.fields, 'Coordinate Policy'),
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
      /* Поле, которое РЕНДЕРИТ сайт, — «Stop Description Override Approved
         (RU)»: его читают и src/lib/airtable.ts (mapRouteStopRecord), и
         админка (RouteStopsEditor). Легаси-поле «Description Override» в
         src/ не читает никто, и до 25.08.2026 проверка смотрела только в
         него. Из-за этого «пустая карточка» определялась не по тому, что
         увидит гость: остановка с заполненным одобренным override была бы
         объявлена пустой. Порядок здесь тот же, что в рендере: одобренный
         override выигрывает, легаси остаётся запасным, чтобы шесть строк
         первого дня, где текст лежит ещё в старом поле, не потеряли
         покрытия. */
      descriptionOverride: text(r.fields, 'Stop Description Override Approved (RU)')
        || text(r.fields, 'Description Override'),
    }))

  return { pois, stops, hasContentFields: true, schema }
}

async function loadFixture(dir) {
  const pois = JSON.parse(await readFile(`${dir}/poi-base.json`, 'utf8')).map((r) => ({
    // Record id есть не в каждом дампе; без него проверка иерархии
    // пропускается вслух, а не врёт (см. checkHierarchy).
    recordId: r.recordId ?? r.id ?? '',
    createdTime: r.createdTime ?? '',
    intakeRunId: r.intakeRunId ?? '',
    intakeOrigin: r.intakeOrigin ?? '',
    intakeContractVersion: r.intakeContractVersion ?? '',
    poiId: r.poiId, nameRu: r.nameRu, nameEn: r.nameEn, siteCity: r.siteCity,
    category: r.category ?? [], copyStatus: r.copyStatus ?? '', isSystem: Boolean(r.f_V85),
    parentPoi: r.f_uxL ?? [], descriptionRu: '', approvedRu: '', workingHours: '',
    descriptionEn: '', draftRu: '', draftEn: '', approvedEn: '',
    // Координаты в дампе есть не всегда, но если есть — проверяются:
    // это единственный способ прогнать checkCoords без сети.
    lat: typeof r.lat === 'number' ? r.lat : null,
    lon: typeof r.lon === 'number' ? r.lon : null,
    coordinatePolicy: typeof r.coordinatePolicy === 'string' ? r.coordinatePolicy.trim() : '',
  }))
  const raw = JSON.parse(await readFile(`${dir}/stops.json`, 'utf8'))
  const stops = raw.map((row) => (Array.isArray(row)
    ? {
      stopId: row[0], routeSlug: row[1], poiId: row[2] ?? '', nameSnapshot: row[3],
      order: row[4], descriptionOverride: row[5] ?? '',
    }
    : {
      stopId: row.stopId, routeSlug: row.routeSlug, poiId: row.poiId ?? '',
      nameSnapshot: row.nameSnapshot, order: row.order ?? null,
      descriptionOverride: row.descriptionOverride ?? '',
    }))
  /* Обычный дамп текстовых полей не содержит, и тогда проверки публикации
     на нём НЕ запускаются: иначе они отрапортовали бы, что описания нет ни
     у одной точки маршрута. Отсутствие данных не то же самое, что найденная
     ошибка.

     Но если дамп их несёт явно, пропускать проверки — значит держать два
     правила из десяти непроверяемыми вообще. Признак берётся из данных, а
     не из флага: хотя бы одна запись объявила текстовое поле. */
  const CONTENT_KEYS = ['descriptionRu', 'approvedRu', 'draftRu', 'workingHours']
  const rawPois = JSON.parse(await readFile(`${dir}/poi-base.json`, 'utf8'))
  const hasContentFields = rawPois.some((r) => CONTENT_KEYS.some((key) => key in r))
  if (hasContentFields) {
    for (const [index, record] of rawPois.entries()) {
      pois[index].descriptionRu = record.descriptionRu ?? ''
      pois[index].approvedRu = record.approvedRu ?? ''
      pois[index].draftRu = record.draftRu ?? ''
      pois[index].workingHours = record.workingHours ?? ''
    }
  }
  /* Схема в дампе необязательна: без неё проверка пропускается вслух. Форма
     та же, что у Meta API: { fields: [{ name, type, options }] }. */
  let schema = null
  try {
    schema = { fields: JSON.parse(await readFile(`${dir}/schema.json`, 'utf8')).fields ?? [], error: null }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return { pois, stops, hasContentFields, schema }
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

  const { pois, stops, hasContentFields, schema } =
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
  checkIntakeMarkers(pois)
  if (hasContentFields) checkDescriptionPairs(pois)
  checkTaxonomySchema(schema)

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
