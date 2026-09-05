/**
 * Адаптер стандарта 自治体標準オープンデータセット / 観光施設一覧.
 *
 * Смысл файла: японские префектуры публикуют список туристических объектов
 * по общему рекомендованному шаблону, но с расхождениями. Проверено вживую
 * 2026-08-06 на двух наборах:
 *
 *   Осака (270008_tourism)      58 колонок, адрес в «所在地_連結表記»,
 *                               скобки в «料金(基本)» ПОЛУШИРИННЫЕ
 *   Киото (260002_kankou_...)   32 колонки, адрес в «住所»,
 *                               скобки в «料金（基本）» ПОЛНОШИРИННЫЕ
 *
 * Поэтому колонки читаются не по точному имени, а через таблицу алиасов
 * с нормализацией ширины символов. Один парсер закрывает обе префектуры и
 * все остальные, кто следует тому же стандарту.
 */

import { parse as parseCsv } from 'csv-parse/sync'
import { RAW_FILE_BYTES_SPEC, sha256Bytes } from '../../lib/byte-digest.mjs'

/**
 * Версия адаптера. Входит в манифест прогона: digest канонического набора
 * кандидатов сравним между прогонами только при одной и той же версии
 * адаптера (ADR-0002 § 8). v2 — 10f-Q: ключ источника перестал зависеть от
 * позиции строки (см. sourceKeyRefusalsOf).
 */
export const OPENDATA_CSV_ADAPTER_VERSION = 'opendata-csv/v3'

/**
 * Закрытый список отказов в ключе источника. Каждый — именованный терминальный
 * исход строки, а не пропуск: строка без ключа в кандидаты не попадает, но и
 * не исчезает — она уезжает в `unkeyed` и считается инвариантом суммы.
 *
 *   sourceIdColumnMissing    в выгрузке нет ни одной колонки идентификатора
 *   sourceIdColumnAmbiguous  колонок идентификатора больше одной — какая из
 *                            них тождество, по данным не установить
 *   sourceIdEmpty            колонка есть, значение в строке пусто
 *   sourceIdInvalid          значение содержит пробельные или управляющие
 *                            символы: ключ сравнивается посимвольно (===)
 *                            во всех потребителях, и такое значение либо
 *                            «выглядит как» другое, либо не найдётся никогда
 *   sourceKeyCollision       одно и то же значение у нескольких строк:
 *                            которая из них «та самая» — неизвестно, ключ не
 *                            достаётся ни одной
 */
export const SOURCE_KEY_REFUSALS = Object.freeze([
  'sourceIdColumnMissing',
  'sourceIdColumnAmbiguous',
  'sourceIdEmpty',
  'sourceIdInvalid',
  'sourceKeyCollision',
])

/**
 * Форма допустимого идентификатора источника: непустая строка без пробельных
 * и управляющих символов. Регистр и всё остальное — как в источнике, без
 * нормализации: ключ — тождество, и чинить его догадкой нельзя.
 */
const SOURCE_ID_FORBIDDEN = /[\s\p{Cc}]/u

/** Полная ширина → половинная, чтобы «（基本）» и «(基本)» сошлись. */
function foldWidth(s) {
  return String(s ?? '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .trim()
}

const COLUMN_ALIASES = {
  nameJa: ['名称'],
  nameKana: ['名称_カナ', '名称カナ'],
  nameEn: ['名称_英語', '名称英語'],
  address: ['所在地_連結表記', '住所', '所在地'],
  prefecture: ['所在地_都道府県', '都道府県名'],
  city: ['所在地_市区町村', '市区町村名'],
  lat: ['緯度'],
  lon: ['経度'],
  openDays: ['利用可能曜日'],
  openFrom: ['開始時間'],
  openTo: ['終了時間'],
  openNote: ['利用可能日時特記事項'],
  priceBasic: ['料金(基本)', '料金（基本）'],
  priceDetail: ['料金(詳細)', '料金（詳細）'],
  descriptionJa: ['説明'],
  descriptionEn: ['説明_英語', '説明英語'],
  access: ['アクセス方法'],
  parking: ['駐車場情報'],
  phone: ['連絡先電話番号'],
  image: ['画像'],
  imageLicence: ['画像_ライセンス', '画像ライセンス'],
  url: ['URL'],
  sourceId: ['ID', 'NO'],
  updatedAt: ['情報更新日'],
  note: ['備考'],
}

/**
 * Строит карту «нормализованный заголовок → фактический заголовок».
 *
 * Вызывается ТОЛЬКО после `assertHeaderRow`: карта по построению теряет
 * повторы (последний заголовок вытесняет предыдущий), и строить её по
 * непроверенным заголовкам значило бы уничтожить признак неоднозначности
 * раньше, чем его успели прочитать.
 */
function buildHeaderIndex(headers) {
  const index = new Map()
  for (const h of headers) index.set(foldWidth(h), h)
  return index
}

/**
 * НЕОДНОЗНАЧНОСТЬ ЗАГОЛОВКОВ ЛОВИТСЯ ДО ПОТЕРИ ИХ СТРУКТУРЫ (10f-Q R1, находка
 * аудита 4).
 *
 * `parse(csv, { columns: true })` отдаёт объект: два одинаковых заголовка
 * схлопываются в один ключ, и значение первой колонки исчезает молча. То же
 * делает `foldWidth`: «ID» и полноширинный «ＩＤ» — разные колонки источника и
 * один ключ у нас. Воспроизведено на production-адаптере
 * (`tmp/10f-q-r1-repro-headers-OLD-2026-09-04.log`): при заголовках `ID,ID`
 * ключ брался из ВТОРОЙ колонки, а `meta.columns` показывал 15 при 16 колонках
 * в файле; при `ID,ＩＤ` неоднозначность не замечалась вовсе.
 *
 * Поэтому строка заголовков читается СЫРОЙ, до сборки объектов, и повтор —
 * точный или после складывания ширины — отказ всей выгрузки: разбор дальше
 * шёл бы вслепую (ADR-0002 § 8.1). Пустые заголовки в проверке не участвуют:
 * хвостовые пустые колонки — обычная форма японских выгрузок, и ключами они
 * не становятся.
 */
export function assertHeaderRow(headers, portalId) {
  if (!Array.isArray(headers) || !headers.length) {
    throw new Error(`${portalId}: в выгрузке нет строки заголовков`)
  }
  const groups = new Map()
  headers.forEach((header, i) => {
    const raw = String(header ?? '')
    if (!raw.trim()) return
    const folded = foldWidth(raw)
    if (!groups.has(folded)) groups.set(folded, [])
    groups.get(folded).push({ raw, column: i + 1 })
  })
  const ambiguous = [...groups.entries()].filter(([, list]) => list.length > 1)
  if (ambiguous.length) {
    const described = ambiguous
      .map(([folded, list]) => `«${folded}» — колонки ${list.map((c) => `${c.column} («${c.raw}»)`).join(', ')}`)
      .join('; ')
    throw new Error(
      `${portalId}: заголовки выгрузки неоднозначны и разбор дальше шёл бы вслепую: ${described}. `
      + 'Одинаковые (в том числе после складывания полной и половинной ширины) имена колонок '
      + 'схлопываются при разборе, и значение одной из них исчезает молча.',
    )
  }
  return headers
}

function pick(row, headerIndex, key) {
  for (const alias of COLUMN_ALIASES[key] ?? []) {
    const actual = headerIndex.get(foldWidth(alias))
    if (actual !== undefined) {
      const value = String(row[actual] ?? '').trim()
      if (value) return value
    }
  }
  return ''
}

function toNumber(value) {
  if (!value) return null
  const n = Number(String(value).replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Часы работы собираются в ОДНУ строку — ровно тот формат, который сейчас
 * принимает поле Airtable «Working Hours». Типографика по канону проекта:
 * короткое тире без пробелов между временами.
 */
function composeWorkingHours({ openDays, openFrom, openTo, openNote }) {
  const parts = []
  const from = openFrom.slice(0, 5)
  const to = openTo.slice(0, 5)
  if (from && to) parts.push(`${from}–${to}`)
  else if (from) parts.push(`с ${from}`)
  if (openDays) parts.push(openDays)
  if (openNote) parts.push(openNote)
  return parts.join('. ')
}

/** Достаёт актуальный URL CSV-ресурса из CKAN, а не хардкодит ссылку на файл. */
export async function resolveCkanCsvUrl({ api, datasetId }, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${api}?id=${encodeURIComponent(datasetId)}`)
  if (!res.ok) throw new Error(`CKAN ${datasetId}: HTTP ${res.status}`)
  const body = await res.json()
  if (!body.success) throw new Error(`CKAN ${datasetId}: success=false`)
  const csv = body.result.resources.find((r) => String(r.format).toUpperCase() === 'CSV')
  if (!csv) throw new Error(`CKAN ${datasetId}: нет CSV-ресурса`)
  return {
    url: csv.url,
    licenceId: body.result.license_id,
    dataUpdated: (csv.last_modified ?? body.result.metadata_modified ?? '').slice(0, 10),
  }
}

/** Японские CSV бывают в cp932 — определяем кодировку, а не гадаем. */
function decodeCsv(buffer) {
  const bytes = new Uint8Array(buffer)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  // U+FFFD в первых килобайтах = это не UTF-8, пробуем cp932.
  if (utf8.slice(0, 4000).includes('�')) {
    return new TextDecoder('shift_jis').decode(bytes)
  }
  return utf8.replace(/^﻿/, '')
}

/**
 * @returns {Promise<{candidates: object[], meta: object}>}
 * Кандидат — сырая нормализованная запись. Ни скоринга, ни решений здесь нет:
 * адаптер только приводит источник к общей форме.
 */
export async function collectFromOpenDataCsv(portal, { fetchImpl = fetch, limit = null } = {}) {
  const resolved = await resolveCkanCsvUrl(portal.ckan, { fetchImpl })
  const res = await fetchImpl(resolved.url)
  if (!res.ok) throw new Error(`${portal.id}: CSV HTTP ${res.status}`)
  const rawBuffer = await res.arrayBuffer()
  const rawBytes = rawBuffer.byteLength
  const rawDigest = sha256Bytes(new Uint8Array(rawBuffer))
  const text = decodeCsv(rawBuffer)

  /* ОДИН разбор всей выгрузки и БЕЗ объектов: строка заголовков нужна сырой,
     до того как `columns` превратит её в ключи и схлопнет повторы.

     Разбор в два прохода (`to_line: 1` для заголовка, `from_line: 2` для
     данных) выглядел так же, но на двух законных формах выгрузки давал ПУСТОЙ
     заголовок и молча пустые строки: файл, начинающийся с пустой строки, и
     заголовок с переносом внутри кавычек. `to_line`/`from_line` считают
     ФИЗИЧЕСКИЕ строки файла, а не записи, и `skip_empty_lines` до них не
     доходит. Найдено сравнением с `columns: true` при разборе мутаций
     (10f-Q R1, N12); обе формы закреплены проверками. */
  const records = parseCsv(text, { columns: false, skip_empty_lines: true, relax_column_count: true })
  const headerRow = records.length ? records[0] : []
  assertHeaderRow(headerRow, portal.id)
  const headers = headerRow.map((h) => String(h ?? ''))
  /* Объекты строятся ТЕМИ ЖЕ проверенными заголовками — по позиции, как это
     делает `columns`: лишние поля строки отбрасываются, недостающие ключей не
     получают, повтор имени перекрывается последним. Заново прочитать заголовок
     из тех же байтов дало бы то же самое, но не дало бы связи между тем, что
     проверено, и тем, что применено. */
  const rows = records.slice(1).map((record) => {
    const row = {}
    const width = Math.min(headers.length, record.length)
    for (let i = 0; i < width; i += 1) row[headers[i]] = record[i]
    return row
  })

  if (!rows.length) {
    return {
      candidates: [],
      unkeyed: [],
      meta: {
        ...resolved, adapter: OPENDATA_CSV_ADAPTER_VERSION, rows: 0, considered: 0, returned: 0, unkeyed: 0,
        columns: 0, headers: [], sourceIdColumn: null,
        rawPayload: { digest: rawDigest, bytes: rawBytes, spec: RAW_FILE_BYTES_SPEC },
      },
    }
  }

  const headerIndex = buildHeaderIndex(headers)

  /* КЛЮЧ ИСТОЧНИКА — ПО ВСЕМ СТРОКАМ И ДО ОГРАНИЧЕНИЯ --limit. Коллизия ключа
     между строкой внутри лимита и строкой за его пределами — всё равно коллизия:
     ключ обязан быть тождеством во всей выгрузке, а не в её префиксе. */
  const keyed = sourceKeyRefusalsOf(rows, headerIndex, portal.id)
  const considered = limit ? keyed.slice(0, limit) : keyed
  const unkeyed = considered
    .filter((k) => k.refusal)
    .map((k) => ({
      rowIndex: k.rowIndex,
      refusal: k.refusal,
      sourceId: k.sourceId,
      nameJa: pick(rows[k.rowIndex - 1], headerIndex, 'nameJa'),
      ...(k.collidesWith ? { collidesWith: k.collidesWith } : {}),
    }))

  const candidates = considered.filter((k) => !k.refusal).map((k) => {
    const row = rows[k.rowIndex - 1]
    const get = (key) => pick(row, headerIndex, key)
    const lat = toNumber(get('lat'))
    const lon = toNumber(get('lon'))

    return {
      // Ключ происхождения: «<портал>:<идентификатор строки в источнике>».
      // Позволяет повторный прогон без дублей и выборку «всё из источника X».
      // От позиции строки НЕ зависит: до 10f-Q при пустом идентификаторе
      // подставлялось `row-N`, и перестановка строк переносила ключ — а с ним
      // идемпотентность, имя из --names и решение владельца — на другой объект.
      sourceKey: k.sourceKey,
      seedSource: portal.id,
      /* ССЫЛКА МОЖЕТ ОТСУТСТВОВАТЬ — И ЭТО `null`, А НЕ `undefined` (10f-S).
         У порталов BODIK своего `url` в реестре нет, а колонка `URL` пуста у
         496 строк из 2012 текущей выгрузки. `undefined` не сериализуется
         каноническим контрактом (это его намеренная строгость), и первая же
         такая строка роняла ВЕСЬ портал: `poi-candidate-set/v1.candidates[51]
         .sourceUrl: значение типа undefined не сериализуется`. Отсутствие
         ссылки — это факт о строке, и он представим. */
      sourceUrl: get('url') || portal.url || null,
      licence: portal.licence,

      nameJa: get('nameJa'),
      nameKana: get('nameKana'),
      nameEn: get('nameEn'),
      descriptionJa: get('descriptionJa'),
      descriptionEn: get('descriptionEn'),

      lat,
      lon,
      address: get('address'),
      prefectureJa: get('prefecture') || null,
      cityJa: get('city') || null,

      workingHours: composeWorkingHours({
        openDays: get('openDays'),
        openFrom: get('openFrom'),
        openTo: get('openTo'),
        openNote: get('openNote'),
      }),
      priceLabel: [get('priceBasic'), get('priceDetail')].filter(Boolean).join('. '),
      access: get('access'),
      parking: get('parking'),
      phone: get('phone'),
      website: get('url'),
      image: get('image'),
      imageLicence: get('imageLicence'),
      note: get('note'),
      sourceUpdatedAt: get('updatedAt') || resolved.dataUpdated || null,
    }
  })

  /* ЗАКОН СОХРАНЕНИЯ на границе адаптера: каждая рассмотренная строка — либо
     кандидат, либо именованный отказ в ключе. Проверяется здесь, а не только у
     потребителя: потребитель видит уже разложенное. */
  if (candidates.length + unkeyed.length !== considered.length) {
    throw new Error(
      `${portal.id}: строки выгрузки потеряны на границе адаптера — рассмотрено ${considered.length}, `
      + `кандидатов ${candidates.length}, отказов в ключе ${unkeyed.length}`,
    )
  }

  return {
    candidates,
    /* Строки без ключа — именованными исходами, не молчанием. */
    unkeyed,
    meta: {
      ...resolved,
      adapter: OPENDATA_CSV_ADAPTER_VERSION,
      rows: rows.length,
      considered: considered.length,
      returned: candidates.length,
      unkeyed: unkeyed.length,
      columns: headers.length,
      /* Диагностика формы входа: сырые заголовки в порядке источника и колонка
         идентификатора, по которой собран ключ (ADR-0002 § 8.1). */
      headers,
      sourceIdColumn: keyed.sourceIdColumn,
      /* Тождество входа для манифеста прогона: SHA-256 ровно тех байтов, что
         пришли от источника, — до декодирования и разбора. */
      rawPayload: { digest: rawDigest, bytes: rawBytes, spec: RAW_FILE_BYTES_SPEC },
    },
  }
}

/**
 * Ключ источника для каждой строки — или именованный отказ.
 *
 * Возвращает массив той же длины, что `rows`, с `rowIndex` (1-based, только
 * диагностика — ключом он не является), `sourceKey` либо `refusal`. Свойство
 * `sourceIdColumn` на массиве — фактическая колонка идентификатора или null.
 *
 * Правила — см. SOURCE_KEY_REFUSALS. Идентификатор читается СЫРЫМ, без
 * подрезки: пробел в значении — отказ, а не догадка о том, что источник
 * «имел в виду».
 */
export function sourceKeyRefusalsOf(rows, headerIndex, portalId) {
  const idColumns = (COLUMN_ALIASES.sourceId ?? [])
    .map((alias) => headerIndex.get(foldWidth(alias)))
    .filter((actual) => actual !== undefined)
  const sourceIdColumn = idColumns.length === 1 ? idColumns[0] : null
  const columnRefusal = idColumns.length === 0
    ? 'sourceIdColumnMissing'
    : idColumns.length > 1 ? 'sourceIdColumnAmbiguous' : null

  const out = rows.map((row, i) => {
    const rowIndex = i + 1
    if (columnRefusal) return { rowIndex, sourceId: null, refusal: columnRefusal }
    const raw = row[sourceIdColumn]
    const sourceId = raw === undefined || raw === null ? '' : String(raw)
    if (sourceId === '') return { rowIndex, sourceId, refusal: 'sourceIdEmpty' }
    if (SOURCE_ID_FORBIDDEN.test(sourceId)) return { rowIndex, sourceId, refusal: 'sourceIdInvalid' }
    return { rowIndex, sourceId, sourceKey: `${portalId}:${sourceId}` }
  })

  /* Коллизии — после того, как каждая строка получила ключ или отказ. Группа
     с одним и тем же ключом теряет ключ целиком: назначить его «первой» строке
     значило бы вернуть зависимость от позиции. */
  const byKey = new Map()
  for (const k of out) {
    if (!k.sourceKey) continue
    if (!byKey.has(k.sourceKey)) byKey.set(k.sourceKey, [])
    byKey.get(k.sourceKey).push(k)
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    for (const k of group) {
      k.refusal = 'sourceKeyCollision'
      k.collidesWith = group.filter((g) => g !== k).map((g) => g.rowIndex)
      delete k.sourceKey
    }
  }
  out.sourceIdColumn = sourceIdColumn
  return out
}
