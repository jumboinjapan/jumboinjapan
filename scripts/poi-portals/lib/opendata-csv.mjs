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

/** Строит карту «нормализованный заголовок → фактический заголовок». */
function buildHeaderIndex(headers) {
  const index = new Map()
  for (const h of headers) index.set(foldWidth(h), h)
  return index
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
  const text = decodeCsv(await res.arrayBuffer())

  const rows = parseCsv(text, { columns: true, skip_empty_lines: true, relax_column_count: true })
  if (!rows.length) return { candidates: [], meta: { ...resolved, rows: 0 } }

  const headerIndex = buildHeaderIndex(Object.keys(rows[0]))
  const sliced = limit ? rows.slice(0, limit) : rows

  const candidates = sliced.map((row, i) => {
    const get = (key) => pick(row, headerIndex, key)
    const lat = toNumber(get('lat'))
    const lon = toNumber(get('lon'))
    const sourceId = get('sourceId') || `row-${i + 1}`

    return {
      // Ключ происхождения — то, чего сейчас у POI нет вообще.
      // Позволяет повторный прогон без дублей и выборку «всё из источника X».
      sourceKey: `${portal.id}:${sourceId}`,
      seedSource: portal.id,
      sourceUrl: get('url') || portal.url,
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

  return {
    candidates,
    meta: {
      ...resolved,
      rows: rows.length,
      returned: candidates.length,
      columns: Object.keys(rows[0]).length,
    },
  }
}
