#!/usr/bin/env node
/**
 * Проверка русской типографики в исходниках. `npm run check:typography`.
 *
 * Ловит только грубые ошибки — те, которые типографер на рендере
 * (src/lib/typography.ts) сознательно не исправляет, потому что без
 * понимания смысла верный случай от неверного не отличить: прямые кавычки,
 * дефис вместо тире, числовые диапазоны, десятичную точку. Неразрывные
 * пробелы здесь НЕ проверяются: их расставляет типографер на выводе, и
 * требовать их в исходниках значило бы дублировать работу.
 *
 * Разбирается только текст: строковые литералы и JSX-текст. Комментарии,
 * выражения {…} и код в разбор не попадают.
 *
 *   node scripts/check-typography.mjs            # публичные поверхности
 *   node scripts/check-typography.mjs --all      # включая админку
 */
import fs from 'node:fs'
import path from 'node:path'

const ALL = process.argv.includes('--all')
const CYR = /[А-Яа-яЁё]/

const RULES = [
  { id: 'quotes-dumb', desc: 'Прямые кавычки вместо «ёлочек» (R1)', re: /"[^"\n]{0,80}"/g, test: m => CYR.test(m) },
  { id: 'quotes-curly', desc: 'Английские кавычки “ ” в русском тексте (R7)', re: /[“”][^“”\n]{0,80}[“”]/g, test: m => CYR.test(m) },
  { id: 'quotes-nested', desc: 'Вложенные «ёлочки» вместо „лапок“ (R4)', re: /«[^»]*«[^»]*»[^«]*»/g },
  { id: 'hyphen-as-dash', desc: 'Дефис в роли тире (R15)', re: /(?<=[А-Яа-яЁё0-9)»,]) -+ (?=[А-Яа-яЁё0-9(«])/g },
  { id: 'double-hyphen', desc: 'Два дефиса вместо тире (R14)', re: /(?<=[А-Яа-яЁё\s])--(?=[А-Яа-яЁё\s])/g },
  { id: 'range-hyphen', desc: 'Дефис в числовом диапазоне вместо короткого тире (R21)', re: /(?<![\d\-:.])\d{1,4} ?- ?\d{1,4}(?![\d\-:.])/g },
  { id: 'three-dots', desc: 'Три точки вместо многоточия … (R45)', re: /\.\.\./g },
  { id: 'two-dots', desc: 'Две точки (R46)', re: /(?<![.\d\s\\])\.\.(?!\.)/g },
  { id: 'decimal-dot', desc: 'Десятичная точка вместо запятой (R54)', re: /(?<![\d.:])\d{1,3}\.\d(?=[\s ]?(?:ч|часа|часов|км|мин|м)(?![А-Яа-яЁё]))/g },
  { id: 'unit-nospace', desc: 'Число и единица измерения без пробела (R36)', re: /\d(мин|км|кг|мм|см|м²|га|°C|°F)(?![А-Яа-яЁё])/g },
  { id: 'space-before-punct', desc: 'Пробел перед знаком препинания (R40)', re: /[А-Яа-яЁё)] [,;:!?](?=[\s]|$)/g },
  { id: 'ordinal-long', desc: 'Избыточное наращение: 90-ые → 90-е (R96)', re: /\d-(ые|ая|ое|ого|ому|ом|ых|ий|ый)(?![А-Яа-яЁё])/g },
  { id: 'roman-ordinal', desc: 'Наращение к римским цифрам (R58)', re: /\b[IVXLC]{1,5}-(й|я|е|го|му|ый|ой)(?![А-Яа-яЁё])/g },
]

/** Строковые литералы и JSX-текст; комментарии и выражения {…} пропускаются. */
function extractUnits(src) {
  const units = []
  let i = 0
  let jsxStart = -1
  const n = src.length
  while (i < n) {
    const c = src[i]
    // Комментарий обрывает накопленный JSX-текст: иначе в него попадёт то,
    // что мы только что пропустили, и правила сработают на комментарии.
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      if (jsxStart >= 0 && CYR.test(src.slice(jsxStart, i))) units.push({ text: src.slice(jsxStart, i), offset: jsxStart })
      if (src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++ }
      else { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2 }
      jsxStart = i
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      const start = ++i
      let buf = ''
      while (i < n) {
        if (src[i] === '\\') { buf += src[i] + src[i + 1]; i += 2; continue }
        if (src[i] === quote) break
        if (quote !== '`' && src[i] === '\n') break
        buf += src[i]
        i++
      }
      i++
      if (quote === '`') buf = buf.replace(/\$\{[^{}]*\}/g, m => '_'.repeat(m.length))
      if (CYR.test(buf)) units.push({ text: buf, offset: start })
      jsxStart = -1
      continue
    }
    if (c === '{') { jsxStart = -1; i++; continue }
    if (c === '}') { jsxStart = i + 1; i++; continue }
    if (c === '>') { jsxStart = /[=\->]/.test(src[i - 1] || '') ? -1 : i + 1; i++; continue }
    if (c === '<') {
      if (jsxStart >= 0 && CYR.test(src.slice(jsxStart, i))) units.push({ text: src.slice(jsxStart, i), offset: jsxStart })
      jsxStart = -1
      i++
      continue
    }
    i++
  }
  return units
}

const files = []
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (/node_modules|\.next|\.well-known/.test(p)) continue
      if (!ALL && /\/(admin|api)$/.test(p)) continue
      walk(p)
      continue
    }
    if (/\.(tsx?|json)$/.test(entry.name)) files.push(p)
  }
})('src')

const findings = []
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  if (!CYR.test(src)) continue
  const lineStarts = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1)
  const lineOf = off => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= off) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  const units = file.endsWith('.json')
    ? [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].filter(m => CYR.test(m[1])).map(m => ({ text: m[1], offset: m.index + 1 }))
    : extractUnits(src)

  for (const unit of units) {
    // Отсев не-текста: код, случайно попавший между `}` и `<`, и строки с
    // исходниками регулярных выражений (в классе [А-Яа-яЁё0-9] дефис между
    // цифрами — это диапазон символов, а не типографика).
    if (/;|=>| = |\bconst\b|\breturn\b/.test(unit.text)) continue
    if (/\(\?[=<:!]|\\\\?[sdwb]|\[\^/.test(unit.text)) continue
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m
      while ((m = rule.re.exec(unit.text))) {
        if (rule.test && !rule.test(m[0])) continue
        const line = lineOf(unit.offset + m.index)
        const raw = src.slice(lineStarts[line - 1], lineStarts[line] ?? src.length).trim()
        if (/^(\/\/|\*|\/\*)/.test(raw)) continue
        const from = Math.max(0, m.index - 40)
        findings.push({
          file, line, rule: rule.id, desc: rule.desc,
          ctx: unit.text.slice(from, m.index + m[0].length + 40).replace(/\s+/g, ' ').trim(),
        })
        if (!m[0].length) rule.re.lastIndex++
      }
    }
  }
}

if (!findings.length) {
  console.log(`✅ Типографика: нарушений не найдено (${files.length} файлов${ALL ? ', включая админку' : ''})`)
  process.exit(0)
}

console.error(`❌ Типографика: ${findings.length} нарушений\n`)
for (const f of findings) {
  console.error(`${f.file}:${f.line}  ${f.rule} — ${f.desc}`)
  console.error(`    …${f.ctx}…`)
}
console.error('\nПравила: docs/typography-audit-2026-07-29.md, ru-text/typography.md')
process.exit(1)
