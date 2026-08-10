#!/usr/bin/env node
/**
 * Дистанция до эталона записи POI. Эталон — docs/poi-standard.md.
 *
 *   npm run poi:score
 *   npm run poi:score -- --list
 *   npm run poi:score -- --city kyoto
 *
 * ЭТО НЕ ПРОВЕРКА НА ОШИБКУ. Мерка не падает и падать не должна: она
 * показывает, чего записи не хватает до готовности, а не что в ней сломано.
 * Сломанное ловят check:canon и check:poi — они падают.
 *
 * КЛАССЫ МЕРЯЮТСЯ ПО-РАЗНОМУ, и это главное в файле. Первая попытка
 * посчитать «записи без описания» дала 29 и оказалась бессмысленной: шесть
 * из них — зоны Этиго-Цумари, у которых описания и не должно быть. Мерка,
 * не различающая классы, врёт в обе стороны: ругает исправное и молчит
 * про сломанное.
 */
import { readFileSync } from 'node:fs'

const BASE = 'apppwhjFN82N9zNqm'
const POI = 'tblVCmFcHRpXUT24y'
const STALE_DAYS = 30

function env(name) {
  if (process.env[name]?.trim()) return process.env[name].trim()
  for (const path of ['.env.local', '.env']) {
    try {
      const line = readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`))
      if (line) return line.slice(name.length + 1).trim()
    } catch {
      /* нет файла — идём дальше */
    }
  }
  throw new Error(`${name} не задан`)
}

async function load(token) {
  const out = []
  let offset
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${POI}`)
    url.searchParams.set('pageSize', '100')
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Airtable ${res.status}`)
    const data = await res.json()
    out.push(...data.records)
    offset = data.offset
  } while (offset)
  return out
}

const text = (r, f) => String(r.fields[f] ?? '').trim()
const list = (r, f) => (Array.isArray(r.fields[f]) ? r.fields[f] : [])
const num = (r, f) => (typeof r.fields[f] === 'number' ? r.fields[f] : null)

/** Классификация. Родитель узнаётся по детям, а не по имени. */
function classify(rec, childCount) {
  if (rec.fields['Is System']) return 'служебная'
  if (childCount > 0 && (!text(rec, 'Google Place ID') || num(rec, 'Latitude') === null)) return 'родительская'
  return 'обычная'
}

/** Требования по классу. Каждое — [ключ, выполнено?, вес]. */
function requirements(rec, klass, childCount) {
  const has = (f) => Boolean(text(rec, f))
  const coords = num(rec, 'Latitude') !== null && num(rec, 'Longitude') !== null
  const status = text(rec, 'Operating Status')

  if (klass === 'служебная') {
    return [
      ['имя RU', has('POI Name (RU)'), 1],
      ['пояснение в Notes', has('Notes'), 1],
    ]
  }

  if (klass === 'родительская') {
    return [
      ['имя RU', has('POI Name (RU)'), 1],
      ['имя EN', has('POI Name (EN)'), 1],
      ['город', has('Site City'), 1],
      ['есть дети', childCount > 0, 1],
      ['описание (объясняет связку)', has('Description Approved (RU)'), 0.5],
    ]
  }

  const freshCoords = (() => {
    const at = text(rec, 'Coords Checked At')
    if (!at) return false
    const days = (Date.now() - new Date(at).getTime()) / 86_400_000
    return Number.isFinite(days) && days <= STALE_DAYS
  })()

  return [
    ['имя RU', has('POI Name (RU)'), 1],
    ['имя EN', has('POI Name (EN)'), 1],
    ['имя JA', has('Name (JA)'), 0.5],
    ['place_id', has('Google Place ID'), 1],
    ['город', has('Site City'), 1],
    ['префектура', has('Prefecture (RU)') && has('Prefecture (EN)'), 1],
    ['координаты', coords, 1],
    ['координаты свежие', freshCoords, 0.5],
    ['статус работы', Boolean(status), 1],
    ['окно сезона', status !== 'Сезонный' || has('Season Window'), 1],
    ['категория', list(rec, 'POI Category (RU)').length > 0, 1],
    ['описание RU', has('Description Approved (RU)'), 1],
    ['описание EN', has('Description Approved (EN)'), 1],
    ['происхождение текста', has('Text Source'), 0.5],
    ['факты', has('Facts (JSON)'), 0.5],
  ]
}

function bar(share, width = 24) {
  const filled = Math.round(share * width)
  return '█'.repeat(filled) + '·'.repeat(width - filled)
}

async function main() {
  const args = process.argv.slice(2)
  const showList = args.includes('--list')
  const cityArg = args.includes('--city') ? args[args.indexOf('--city') + 1] : null

  const records = await load(env('AIRTABLE_TOKEN'))

  // Дети считаются по обратной ссылке: имя поля в Airtable историческое.
  const childCount = new Map()
  for (const rec of records) {
    for (const parent of list(rec, 'Parent POI')) {
      childCount.set(parent, (childCount.get(parent) ?? 0) + 1)
    }
  }

  const scored = records
    .filter((r) => !cityArg || text(r, 'Site City') === cityArg)
    .map((rec) => {
      const kids = childCount.get(rec.id) ?? 0
      const klass = classify(rec, kids)
      const reqs = requirements(rec, klass, kids)
      const total = reqs.reduce((s, [, , w]) => s + w, 0)
      const done = reqs.reduce((s, [, ok, w]) => s + (ok ? w : 0), 0)
      return { rec, klass, reqs, share: total ? done / total : 1, missing: reqs.filter(([, ok]) => !ok) }
    })

  console.log(`\nДИСТАНЦИЯ ДО ЭТАЛОНА${cityArg ? ` — город ${cityArg}` : ''}\n`)
  console.log(`  записей: ${scored.length}\n`)

  for (const klass of ['обычная', 'родительская', 'служебная']) {
    const group = scored.filter((s) => s.klass === klass)
    if (!group.length) continue
    const avg = group.reduce((s, x) => s + x.share, 0) / group.length
    const ready = group.filter((x) => x.share === 1).length
    console.log(`  ${klass.padEnd(14)} ${String(group.length).padStart(4)}   ${bar(avg)} ${Math.round(avg * 100)}%   готовы полностью: ${ready}`)
  }

  // Чего не хватает чаще всего — это и есть очередь работ.
  const gaps = new Map()
  for (const s of scored) {
    for (const [name] of s.missing) gaps.set(`${s.klass} · ${name}`, (gaps.get(`${s.klass} · ${name}`) ?? 0) + 1)
  }
  console.log('\n  ЧЕГО НЕ ХВАТАЕТ ЧАЩЕ ВСЕГО:\n')
  for (const [name, n] of [...gaps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
    console.log(`    ${String(n).padStart(4)}  ${name}`)
  }

  if (showList) {
    console.log('\n  ПОИМЁННО (самые далёкие сверху):\n')
    for (const s of scored.filter((x) => x.share < 1).sort((a, b) => a.share - b.share).slice(0, 40)) {
      const id = text(s.rec, 'POI ID')
      const name = text(s.rec, 'POI Name (RU)').slice(0, 32)
      console.log(`    ${Math.round(s.share * 100).toString().padStart(3)}%  ${id}  ${name.padEnd(34)} ${s.missing.map(([m]) => m).join(', ')}`)
    }
  } else {
    console.log('\n  Поимённо: npm run poi:score -- --list\n')
  }
}

main().catch((error) => {
  console.error(`[poi-score] ${error.message}`)
  process.exitCode = 2
})
