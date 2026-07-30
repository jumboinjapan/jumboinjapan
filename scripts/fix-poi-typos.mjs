#!/usr/bin/env node
/**
 * Разовая правка опечаток в описаниях POI.
 *
 * Список составлен вручную из отчёта словарной проверки: сюда попало только
 * то, где ошибка бесспорна — пропущенная или лишняя буква. Всё, что касается
 * выбора слова, согласования и стиля, здесь СОЗНАТЕЛЬНО отсутствует: это
 * редактура, её делает человек.
 *
 * Автоматике замены не доверяем: каждая пара «было → стало» проверена в
 * контексте, скрипт только применяет. Правятся все три поля описания
 * (RU / Approved / Draft) синхронно — иначе следующее «Утвердить» вернёт
 * ошибку обратно.
 *
 *   node scripts/fix-poi-typos.mjs            # показать, что изменится
 *   node scripts/fix-poi-typos.mjs --write    # применить (со снимком «до»)
 */
import fs from 'node:fs'
import path from 'node:path'

const WRITE = process.argv.includes('--write')

/**
 * [что заменить, на что] — регистр учитывается. Замена идёт по границе слова:
 * подстрочная сломала бы уже верное слово, содержащее опечатку как подстроку
 * («лощадку» внутри «площадку» → «пплощадку»; проверено на живых данных).
 */
const FIXES = [
  ['иточники', 'источники'],
  ['источиники', 'источники'],
  ['изветсный', 'известный'],
  ['прекрсный', 'прекрасный'],
  ['белаое', 'белое'],
  ['Белаое', 'Белое'],
  ['тоговая', 'торговая'],
  ['рыбые', 'рыбные'],
  ['маршру ', 'маршрут '],
  ['лощадку', 'площадку'],
  ['рождния', 'рождения'],
  ['вености', 'верности'],
  ['объеденителей', 'объединителей'],
  ['атмоферный', 'атмосферный'],
  ['осзис', 'оазис'],
  ['Скалд из красной кирпичной кладки', 'Склад из красной кирпичной кладки'],
  // след моей же ошибки 2026-07-30: подстрочная замена «лощадку» задвоила «п»
  ['пплощадку', 'площадку'],
]

const FIELDS = ['Description (RU)', 'Description Approved (RU)', 'Description Draft (RU)']

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
  console.error('Нет AIRTABLE_TOKEN / AIRTABLE_BASE_ID')
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

const meta = await api(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`)
const poi = meta.tables.find(t => t.name === 'POI')
if (!poi) throw new Error('Таблица POI не найдена')

let offset
const records = []
do {
  const u = new URL(`https://api.airtable.com/v0/${BASE}/${poi.id}`)
  u.searchParams.set('pageSize', '100')
  if (offset) u.searchParams.set('offset', offset)
  const page = await api(u)
  records.push(...page.records)
  offset = page.offset
} while (offset)

const backup = []
const updates = []
for (const record of records) {
  const fields = {}
  for (const field of FIELDS) {
    const value = record.fields[field]
    if (typeof value !== 'string' || !value) continue
    let next = value
    const applied = []
    for (const [from, to] of FIXES) {
      // (?<![А-Яа-яЁё]) — слева не буква, иначе замена залезет внутрь слова.
      // \b в JavaScript для кириллицы не работает: \w это [A-Za-z0-9_].
      const re = new RegExp(`(?<![А-Яа-яЁё])${from}`, 'g')
      if (!re.test(next)) continue
      re.lastIndex = 0
      next = next.replace(re, to)
      applied.push(`${from} → ${to}`)
    }
    if (next === value) continue
    fields[field] = next
    backup.push({ id: record.id, name: record.fields['Name (RU)'] ?? '', field, before: value, after: next, applied })
  }
  if (Object.keys(fields).length) updates.push({ id: record.id, fields })
}

for (const item of backup) {
  const i = item.applied.length ? item.before.indexOf(item.applied[0].split(' → ')[0]) : 0
  console.log(`[${item.name || item.id} · ${item.field.replace(' (RU)', '')}] ${item.applied.join(', ')}`)
  console.log(`  …${item.before.slice(Math.max(0, i - 50), i + 60).replace(/\s+/g, ' ')}…`)
}
console.log(`\n${WRITE ? 'Применяю' : 'Будет изменено'}: ${backup.length} значений в ${updates.length} записях`)

if (!WRITE || !updates.length) process.exit(0)

const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '')
const file = `tmp/poi-typos-backup-${stamp}.json`
fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync(file, JSON.stringify(backup, null, 1))
console.log(`Снимок «до»: ${file}`)

for (let i = 0; i < updates.length; i += 10) {
  const chunk = updates.slice(i, i + 10)
  await api(`https://api.airtable.com/v0/${BASE}/${poi.id}`, { method: 'PATCH', body: JSON.stringify({ records: chunk }) })
  console.log(`  записано ${Math.min(i + 10, updates.length)}/${updates.length}`)
}
console.log('Готово.')
