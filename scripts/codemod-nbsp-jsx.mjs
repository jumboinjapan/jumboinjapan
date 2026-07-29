#!/usr/bin/env node
/**
 * Разовый codemod: расставляет неразрывные пробелы в JSX-тексте.
 *
 * Зачем отдельно от типографера. src/lib/typography.ts работает на границе
 * props — то есть покрывает текст, который приходит в компонент данными
 * (Airtable, src/data, объекты страниц). Проза, написанная прямо в разметке
 * (<p>Текст…</p>), ни через какие props не проходит, и достать её на рендере
 * нечем. Поэтому она правится в исходниках — один раз, механически.
 *
 * Правила здесь УЖЕ типографера: только вставка неразрывных пробелов и
 * многоточие. Схлопывание сдвоенных пробелов сознательно выключено — в JSX
 * это отступы разметки, и codemod переформатировал бы весь файл.
 *
 *   node scripts/codemod-nbsp-jsx.mjs            # показать, что изменится
 *   node scripts/codemod-nbsp-jsx.mjs --write    # применить
 */
import fs from 'node:fs'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
const NBSP = ' '
const CYR = /[А-Яа-яЁё]/
const SINGLE_LETTER = 'вВкКсСоОуУиИаАяЯ'
const UNITS = 'мин|сек|мм|см|км|кг|га|°C|°|м|ч|г|л'
const WORD_UNITS = 'минут|минуты|часов|часа|дней|дня|метров|километров'

const RULES = [
  [/\.\.\./g, '…'],
  [/([?!])…/g, '$1..'],
  [new RegExp(`(^|[\\s(«„—–])([${SINGLE_LETTER}]) (?=[А-Яа-яЁё0-9])`, 'g'), `$1$2${NBSP}`],
  [new RegExp(`(^|[\\s(«„—–])([${SINGLE_LETTER}]) (?=[А-Яа-яЁё0-9])`, 'g'), `$1$2${NBSP}`],
  [/ —/g, `${NBSP}—`],
  [new RegExp(`(\\d) (?=(?:${UNITS})(?![А-Яа-яЁё]))`, 'g'), `$1${NBSP}`],
  [new RegExp(`(\\d) (?=(?:${WORD_UNITS})(?![А-Яа-яЁё]))`, 'g'), `$1${NBSP}`],
  [/(?<![А-Яа-яЁёA-Za-z])т\. ?([депк])\./g, `т.${NBSP}$1.`],
  [/№ ?(?=\d)/g, `№${NBSP}`],

  // Перенос строки в разметке рендерится как пробел, поэтому предлог, стоящий
  // последним в строке исходника, всё равно повиснет в конце строки на экране.
  // Такие места приходится склеивать: неразрывный пробел нельзя «положить»
  // на перевод строки. Строка исходника становится длиннее на одно слово.
  [new RegExp(`(^|[\\s(«„—–])([${SINGLE_LETTER}])\\n[^\\S\\n]*(?=[А-Яа-яЁё0-9])`, 'g'), `$1$2${NBSP}`],
  [new RegExp(`(^|[\\s(«„—–])([${SINGLE_LETTER}])\\n[^\\S\\n]*(?=[А-Яа-яЁё0-9])`, 'g'), `$1$2${NBSP}`],
  [/(\S)[^\S\n]*\n[^\S\n]*—/g, `$1${NBSP}—`],
  [new RegExp(`(\\d)[^\\S\\n]*\\n[^\\S\\n]*(?=(?:${UNITS}|${WORD_UNITS})(?![А-Яа-яЁё]))`, 'g'), `$1${NBSP}`],
]

function transform(text) {
  let out = text
  for (const [re, to] of RULES) out = out.replace(re, to)
  return out
}

/**
 * Находит JSX-текст: то, что стоит между `>` и `<` вне строк, комментариев и
 * выражений {…}. Стрелки `=>` и сравнения не считаются началом текста.
 */
function findJsxTextSpans(src) {
  const spans = []
  let i = 0
  let start = -1
  const n = src.length
  while (i < n) {
    const c = src[i]
    // Комментарий обрывает накопленный текст: иначе в него попадёт то, что мы
    // только что пропустили, и codemod правил бы комментарии.
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      if (start >= 0 && CYR.test(src.slice(start, i))) spans.push([start, i])
      if (src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++ }
      else { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2 }
      start = i
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) break
        if (q !== '`' && src[i] === '\n') break
        i++
      }
      i++
      start = -1
      continue
    }
    // Выражение {…} тоже обрывает текст, но накопленное до него — настоящий
    // JSX-текст: «…поездки, можно{' '}» без этого терялся целиком.
    if (c === '{') {
      if (start >= 0 && CYR.test(src.slice(start, i))) spans.push([start, i])
      start = -1
      i++
      continue
    }
    if (c === '}') { start = i + 1; i++; continue }
    if (c === '>') { start = /[=\->]/.test(src[i - 1] || '') ? -1 : i + 1; i++; continue }
    if (c === '<') {
      if (start >= 0 && CYR.test(src.slice(start, i))) spans.push([start, i])
      start = -1
      i++
      continue
    }
    i++
  }
  return spans
}

const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!/node_modules|\.next|\/admin$|\/api$/.test(p)) walk(p)
      continue
    }
    if (e.name.endsWith('.tsx')) files.push(p)
  }
})('src')

let changedFiles = 0
let changedSpans = 0
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  if (!CYR.test(src)) continue
  const spans = findJsxTextSpans(src)
  let out = ''
  let cursor = 0
  let touched = 0
  for (const [s, e] of spans) {
    const original = src.slice(s, e)
    const next = transform(original)
    if (next === original) continue
    out += src.slice(cursor, s) + next
    cursor = e
    touched++
  }
  if (!touched) continue
  out += src.slice(cursor)
  changedFiles++
  changedSpans += touched
  if (WRITE) fs.writeFileSync(file, out)
  else console.log(`${file}: ${touched} фрагментов`)
}
console.log(`\n${WRITE ? 'Изменено' : 'Будет изменено'}: ${changedSpans} фрагментов JSX-текста в ${changedFiles} файлах`)
