#!/usr/bin/env node
/**
 * Разовая нормализация типографики в публичных текстовых полях Airtable.
 * Следствие аудита docs/typography-audit-2026-07-29.md.
 *
 * Чинит то, чего типографер на рендере сознательно не делает, потому что без
 * понимания смысла верный случай от неверного не отличить: числовые
 * диапазоны через дефис, десятичную точку, прямые кавычки, «..», а также
 * заголовки маршрутов с дефисом вместо тире.
 *
 * Безопасность:
 *   — dry-run по умолчанию, запись только по --write;
 *   — перед записью полный снимок исходных значений уходит в JSON-файл;
 *   — правятся только перечисленные ниже поля перечисленных таблиц;
 *   — таблицы с персональными данными (Prospects) не читаются вовсе;
 *   — каждое правило показывает «было → стало» в отчёте.
 *
 *   node scripts/fix-airtable-typography.mjs                    # показать
 *   node scripts/fix-airtable-typography.mjs --write            # применить
 *   node scripts/fix-airtable-typography.mjs --only=POI         # одна таблица
 */
import fs from 'node:fs'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7)
const RULE = (process.argv.find(a => a.startsWith('--rule=')) || '').slice(7)

// ── доступ ───────────────────────────────────────────────────────────────────
const envFile = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const key = line.slice(0, line.indexOf('=')).trim()
    if (!process.env[key]) process.env[key] = line.slice(line.indexOf('=') + 1).trim()
  }
}
const TOKEN = process.env.AIRTABLE_TOKEN
const BASE = process.env.AIRTABLE_BASE_ID
if (!TOKEN || !BASE) {
  console.error('Нет AIRTABLE_TOKEN / AIRTABLE_BASE_ID (.env.local или окружение).')
  process.exit(1)
}

const api = async (url, init) => {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) throw new Error(`${res.status} ${url}\n${await res.text()}`)
  return res.json()
}

// ── правила ──────────────────────────────────────────────────────────────────
const NBSP = ' '
const MONTHS = 'янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек'

/** Общие для всех текстовых полей. */
const COMMON = [
  ['три точки → многоточие', /\.\.\./g, '…'],
  ['две точки → многоточие', /(?<![.\d\s])\.\.(?!\.)/g, '…'],
  ['сдвоенный пробел', /(\S)[^\S\n]{2,}(\S)/g, '$1 $2'],
  ['прямые кавычки → «ёлочки»', /"([^"\n]{1,120})"/g, (m, inner) => (/[А-Яа-яЁё]/.test(inner) ? `«${inner}»` : m)],
  // Диапазон дат («31 дек - 1 янв», «1 апреля - 30 апреля») — короткое тире.
  ['диапазон дат', new RegExp(`(\\d{1,2}\\s+(?:${MONTHS})\\S*(?:\\s*\\([^)]*\\))?)\\s+-\\s+(?=\\d{1,2}\\s+(?:${MONTHS}))`, 'gi'), '$1 – '],
  ['диапазон времени', /(\d{1,2}:\d{2})\s?-\s?(?=\d{1,2}:\d{2})/g, '$1–'],
  ['числовой диапазон', /(?<![\d\-:.])(\d{1,4})\s?-\s?(?=\d{1,4}(?![\d\-:.]))/g, '$1–'],
  ['дефис в роли тире', /(?<=[А-Яа-яЁё0-9)»]) -+ (?=[А-Яа-яЁё(«])/g, ' — '],
  ['температура', /(\d)°([CF])/g, `$1${NBSP}°$2`],
]

/**
 * Десятичная запятая — только там, где рядом единица времени или расстояния,
 * иначе не отличить от короткой даты «18.07». Границы слова — через
 * (?![А-Яа-яЁё]): \b в JavaScript работает по [A-Za-z0-9_] и рядом с
 * кириллицей молча не срабатывает.
 */
const DECIMAL = [
  ['десятичная запятая', /(\d)\.(\d)(?=[  ]?(?:ч|часа|часов|км|мин|м)(?![А-Яа-яЁё]))/g, '$1,$2'],
  ['десятичная запятая (рейтинг)', /(Рейтинг\s+\d)\.(\d)/g, '$1,$2'],
]

/**
 * Поля, которые видит гость. Всё остальное (Internal Notes, Program Backup,
 * Pricing Data, служебные заголовки) не трогаем.
 */
const TARGETS = [
  { table: 'Routes', fields: ['Title', 'Preview Title', 'Short Title', 'Preview Subtitle'], rules: COMMON },
  { table: 'POI', fields: ['Description (RU)', 'Description Approved (RU)', 'Description Draft (RU)'], rules: [...COMMON, ...DECIMAL] },
  { table: 'POI', fields: ['Working Hours'], rules: COMMON },
  { table: 'Resources', fields: ['Description', 'Summary'], rules: [...COMMON, ...DECIMAL] },
  { table: 'Resource Event Details', fields: ['Description'], rules: [...COMMON, ...DECIMAL] },
  { table: 'Route Days', fields: ['Day Summary'], rules: [...COMMON, ...DECIMAL] },
  { table: 'Day Items', fields: ['Short Description', 'Display Title'], rules: [...COMMON, ...DECIMAL] },
  { table: 'Route Stops', fields: ['Selling Highlights'], rules: COMMON, json: true },
]

/**
 * Заголовки, где помимо дефиса неверна капитализация: в русском заголовке с
 * прописной пишется только первое слово и имена собственные. Правится точечно
 * по record id — автоматике такое доверять нельзя.
 */
const TITLE_FIXES = {
  recM1KgTXpnhSJCAO: 'Япония — глубокое погружение',
  recph3WoPjr0k8h42: 'Япония — первое открытие',
  reczpx5kMqyoepYCo: 'Япония — первое касание',
}

function applyRules(text, rules) {
  let out = text
  const applied = []
  for (const [name, re, to] of rules) {
    const before = out
    out = out.replace(re, to)
    if (out !== before) applied.push(name)
  }
  return { text: out, applied }
}

/** Selling Highlights — JSON-массив; типографируем только строки внутри. */
function applyToJson(raw, rules) {
  let parsed
  try { parsed = JSON.parse(raw) } catch { return { text: raw, applied: [] } }
  const applied = new Set()
  const walk = value => {
    if (typeof value === 'string') {
      const r = applyRules(value, rules)
      r.applied.forEach(a => applied.add(a))
      return r.text
    }
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
    }
    return value
  }
  const next = walk(parsed)
  return { text: JSON.stringify(next), applied: [...applied] }
}

// ── обход ────────────────────────────────────────────────────────────────────
const meta = await api(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`)
const tableId = name => {
  const t = meta.tables.find(x => x.name === name)
  if (!t) throw new Error(`Таблица «${name}» не найдена`)
  return t.id
}

const backup = []
const updatesByTable = new Map()
const stats = new Map()

for (const target of TARGETS) {
  if (ONLY && target.table !== ONLY) continue
  const id = tableId(target.table)
  let offset
  const records = []
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${id}`)
    url.searchParams.set('pageSize', '100')
    if (offset) url.searchParams.set('offset', offset)
    const page = await api(url)
    records.push(...page.records)
    offset = page.offset
  } while (offset)

  for (const record of records) {
    const fields = {}
    for (const field of target.fields) {
      const value = record.fields[field]
      if (typeof value !== 'string' || !/[А-Яа-яЁё]/.test(value)) continue

      let next = target.json ? applyToJson(value, target.rules) : applyRules(value, target.rules)

      if (target.table === 'Routes' && TITLE_FIXES[record.id] && (field === 'Title' || field === 'Preview Title')) {
        next = { text: TITLE_FIXES[record.id], applied: [...next.applied, 'заголовок: тире и капитализация'] }
      }

      if (next.text === value) continue
      fields[field] = next.text
      next.applied.forEach(a => stats.set(a, (stats.get(a) || 0) + 1))
      backup.push({ table: target.table, id: record.id, field, before: value, after: next.text, applied: next.applied })
    }
    if (Object.keys(fields).length === 0) continue
    if (!updatesByTable.has(id)) updatesByTable.set(id, [])
    updatesByTable.get(id).push({ id: record.id, fields })
  }
}

// ── отчёт ────────────────────────────────────────────────────────────────────
/** Показывает окрестность первого расхождения, а не начало поля. */
function diffFragment(before, after) {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) tail++
  const pad = 45
  const cut = (s, end) => s.slice(Math.max(0, head - pad), end + pad).replace(/\s+/g, ' ')
  return [cut(before, before.length - tail), cut(after, after.length - tail)]
}

console.log(`${WRITE ? 'ПРИМЕНЯЮ' : 'ПРЕДПРОСМОТР (для записи добавьте --write)'}\n`)
for (const item of backup) {
  const [was, now] = diffFragment(item.before, item.after)
  if (RULE && !item.applied.some(a => a.includes(RULE))) continue
  console.log(`[${item.table}.${item.field} ${item.id}] ${item.applied.join(', ')}`)
  console.log(`  было:  …${was}…`)
  console.log(`  стало: …${now}…`)
}
console.log('\n── по правилам ──')
;[...stats.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(5), k))
const recordCount = [...updatesByTable.values()].reduce((a, x) => a + x.length, 0)
console.log(`\nЗатронуто значений: ${backup.length} в ${recordCount} записях`)

if (!WRITE) process.exit(0)
if (!backup.length) { console.log('Менять нечего.'); process.exit(0) }

const backupPath = `airtable-typography-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 1))
console.log(`\nСнимок исходных значений: ${backupPath}`)

for (const [id, records] of updatesByTable) {
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10)
    await api(`https://api.airtable.com/v0/${BASE}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ records: chunk }),
    })
    console.log(`  записано ${Math.min(i + 10, records.length)}/${records.length} → ${id}`)
  }
}
console.log('Готово.')
