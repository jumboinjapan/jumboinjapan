#!/usr/bin/env node
/**
 * Проверка длины текстов по ролям. `npm run check:copy`
 *
 * Смотрит туда, откуда текст попадает на страницу: заголовки и описания в
 * коде (по классам шкалы) и публичные поля Airtable. Пределы и обоснования —
 * src/lib/copy-limits.ts, здесь только применение.
 *
 * Два уровня. «Перелёт» (за пределом) — красный, ломает блок. «Длинновато»
 * (за комфортом) — жёлтый, повод сократить. По умолчанию код возвращает
 * ненулевой статус только на перелётах: жёлтое не должно блокировать работу.
 *
 *   node scripts/check-copy-length.mjs             # код + Airtable
 *   node scripts/check-copy-length.mjs --code      # только код (быстро, без сети)
 *   node scripts/check-copy-length.mjs --strict    # падать и на «длинновато»
 */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const CODE_ONLY = process.argv.includes('--code')
const STRICT = process.argv.includes('--strict')

// ── лимиты берём из единственного источника правды ───────────────────────────
const limitsSrc = fs.readFileSync('src/lib/copy-limits.ts', 'utf8')
const limitsJs = ts.transpileModule(limitsSrc, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { COPY_LIMITS, checkCopyLength } = await import(
  'data:text/javascript;base64,' + Buffer.from(limitsJs).toString('base64')
)

/**
 * Роль определяется тегом, а класс шкалы только уточняет. Тег — это и есть
 * заявленная иерархия: h2 остаётся шапкой раздела, даже если набран мельче.
 * Класс нужен там, где тега не хватает: метка-надзаголовок это <p>.
 */
function roleOf(tag, classText) {
  if (tag === 'h1') return /\btext-hero\b/.test(classText) ? 'heroTitle' : 'pageTitle'
  if (tag === 'h2') return 'sectionTitle'
  if (tag === 'h3') return 'cardTitle'
  if (/\btext-label\b/.test(classText)) return 'eyebrow'
  return null
}

const findings = []

// ── документ для агентов не должен разъезжаться с кодом ──────────────────────
// docs/copy-canon-for-agents.md вставляют в промпты копипастой, кода он не
// видит. Если числа в его таблице отстанут от copy-limits.ts, агенты будут
// писать по устаревшим лимитам — молча и до первой сломанной вёрстки.
const CANON_DOC = 'docs/copy-canon-for-agents.md'
const docDrift = []
if (fs.existsSync(CANON_DOC)) {
  const doc = fs.readFileSync(CANON_DOC, 'utf8')
  const byLabel = new Map(Object.values(COPY_LIMITS).map(l => [l.label, l]))
  const seen = new Set()
  for (const row of doc.matchAll(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/gm)) {
    const [, label, ideal, max] = row
    const limit = byLabel.get(label.trim())
    if (!limit) continue
    seen.add(label.trim())
    if (limit.ideal !== Number(ideal) || limit.max !== Number(max)) {
      docDrift.push(`${label.trim()}: в документе ${ideal}/${max}, в коде ${limit.ideal}/${limit.max}`)
    }
  }
  for (const [label] of byLabel) if (!seen.has(label)) docDrift.push(`${label}: роли нет в таблице документа`)
} else {
  docDrift.push(`${CANON_DOC} не найден — агентам нечего вставлять в промпт`)
}

// ── код: JSX-элементы с классами шкалы и статическим текстом ─────────────────
const files = []
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!/node_modules|\.next|\.well-known|\/admin$|\/api$/.test(p)) walk(p)
      continue
    }
    if (entry.name.endsWith('.tsx')) files.push(p)
  }
})('src')

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  if (!/[А-Яа-яЁё]/.test(src)) continue
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  const visit = node => {
    if (ts.isJsxElement(node)) {
      const attrs = node.openingElement.attributes.properties
      const className = attrs.find(a => ts.isJsxAttribute(a) && a.name.getText(sf) === 'className')
      const classText = className ? className.getText(sf) : ''
      const role = roleOf(node.openingElement.tagName.getText(sf), classText)
      if (role) {
        // берём только статический текст: {expr} проверить нельзя, он приходит из данных
        const text = node.children
          .filter(ts.isJsxText)
          .map(c => c.getText(sf))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (text && /[А-Яа-яЁё]/.test(text)) {
          const check = checkCopyLength(role, text)
          if (check.status !== 'ok') {
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
            findings.push({ where: `${file}:${line}`, ...check, text })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

// ── Airtable: публичные поля ────────────────────────────────────────────────
if (!CODE_ONLY) {
  const envFile = '.env.local'
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
    console.warn('⚠ Airtable пропущен: нет AIRTABLE_TOKEN / AIRTABLE_BASE_ID. Проверен только код.\n')
  } else {
    const api = async url => {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
      if (!r.ok) throw new Error(`${r.status} ${url}`)
      return r.json()
    }
    const meta = await api(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`)
    const FIELD_ROLE = {
      Routes: {
        'Title': 'cardTitle',
        'Preview Title': 'cardTitle',
        'Short Title': 'cardTitle',
        'Preview Subtitle': 'cardSummary',
        'SEO Title Approved': 'metaTitle',
        'SEO Description Approved': 'metaDescription',
        'Route Intro Approved': 'intro',
      },
      // Day Items и Route Days сознательно не проверяются: это строки
      // программы тура, они переносятся свободно и сетку не держат. Лимиты
      // существуют для блоков фиксированной формы, а не для любого текста.
    }
    for (const [tableName, fields] of Object.entries(FIELD_ROLE)) {
      const table = meta.tables.find(t => t.name === tableName)
      if (!table) continue
      let offset
      do {
        const url = new URL(`https://api.airtable.com/v0/${BASE}/${table.id}`)
        url.searchParams.set('pageSize', '100')
        if (offset) url.searchParams.set('offset', offset)
        const page = await api(url)
        for (const record of page.records) {
          for (const [field, role] of Object.entries(fields)) {
            const value = record.fields[field]
            if (typeof value !== 'string' || !/[А-Яа-яЁё]/.test(value)) continue
            const check = checkCopyLength(role, value)
            if (check.status !== 'ok') {
              findings.push({ where: `Airtable ${tableName}.${field} ${record.id}`, ...check, text: value })
            }
          }
        }
        offset = page.offset
      } while (offset)
    }
  }
}

// ── отчёт ────────────────────────────────────────────────────────────────────
const over = findings.filter(f => f.status === 'over')
const warn = findings.filter(f => f.status === 'warn')

const show = (list, title) => {
  if (!list.length) return
  console.log(`\n${title}\n`)
  for (const f of list) {
    console.log(`  ${f.where}`)
    console.log(`    ${f.label}: ${f.length} знаков (комфортно ${f.ideal}, предел ${f.max})`)
    console.log(`    «${f.text.replace(/\s+/g, ' ').slice(0, 90)}${f.text.length > 90 ? '…' : ''}»`)
  }
}

if (docDrift.length) {
  console.log(`\n❌ ${CANON_DOC} разошёлся с src/lib/copy-limits.ts (${docDrift.length})\n`)
  for (const line of docDrift) console.log('  ' + line)
  console.log('\n  Источник правды — код. Обновите таблицу в документе под него.')
}

show(over, `❌ Перелёт за предел — ломает блок (${over.length})`)
show(warn, `⚠ Длиннее комфортного (${warn.length})`)

if (!findings.length && !docDrift.length) {
  console.log('✅ Длина текстов в норме, документ для агентов совпадает с кодом')
} else {
  console.log(`\nПравила и обоснования: src/lib/copy-limits.ts`)
  console.log('Заголовок не лечится уменьшением кегля — кегль держит иерархию. Лечится текст.')
}

process.exit(over.length || docDrift.length || (STRICT && warn.length) ? 1 : 0)
