#!/usr/bin/env node
/**
 * Инварианты типографера (src/lib/typography.ts).
 *
 * Запуск: node tests/typography.mjs
 *
 * Главное, что здесь проверяется, — не только что типографер расставляет
 * неразрывные пробелы, но и что он НЕ трогает то, чего трогать нельзя:
 * даты, адреса, диапазоны, латиницу, slug'и и ключи логики. Ошибка второго
 * рода дороже: пропущенный NBSP — косметика, испорченный адрес — враньё.
 */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const source = fs.readFileSync(path.join(root, 'src/lib/typography.ts'), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
const { typo, typoDeep } = await import(dataUrl)

const NBSP = ' '
const failures = []
let passed = 0

function eq(actual, expected, message) {
  if (actual === expected) { passed++; return }
  failures.push(`${message}\n    получено: ${JSON.stringify(actual)}\n    ожидалось: ${JSON.stringify(expected)}`)
}

// ── Что типографер обязан сделать ────────────────────────────────────────────
eq(typo('Прилёт в Токио'), `Прилёт в${NBSP}Токио`, 'NBSP после однобуквенного предлога')
eq(typo('и в Токио, и с гидом'), `и${NBSP}в${NBSP}Токио, и${NBSP}с${NBSP}гидом`, 'подряд идущие предлоги')
eq(typo('В начале дня'), `В${NBSP}начале дня`, 'предлог с прописной в начале строки')
eq(typo('Токио — не за один день'), `Токио${NBSP}— не за один день`, 'NBSP перед длинным тире; двухбуквенное «за» не трогаем')
eq(typo('Ну что ж...'), 'Ну что ж…', 'три точки → многоточие')
eq(typo('Неужели?...'), 'Неужели?..', 'после ? — две точки')
eq(typo('само  по  себе'), 'само по себе', 'сдвоенные пробелы схлопываются')
eq(typo('цель центра - представить оперу'), `цель центра${NBSP}— представить оперу`, 'дефис в роли тире')
eq(typo('около 40 минут'), `около 40${NBSP}минут`, 'NBSP между числом и единицей')
eq(typo('сталь 900 °C'), `сталь 900${NBSP}°C`, 'NBSP перед знаком градуса')
eq(typo('дом № 12'), `дом №${NBSP}12`, 'NBSP после знака номера')
eq(typo('и т.д.'), `и${NBSP}т.${NBSP}д.`, 'сокращение с неразрывным пробелом')

// ── Чего типографер трогать не должен ────────────────────────────────────────
eq(typo('Асакуса, 1-32-11'), 'Асакуса, 1-32-11', 'японский адрес не превращается в диапазон')
eq(typo('Закрытые дни: 18.07, 08.11'), 'Закрытые дни: 18.07, 08.11', 'короткая дата не становится дробью')
eq(typo('Сезон 2026: 30.05–18.10'), 'Сезон 2026: 30.05–18.10', 'диапазон дат сохраняется')
eq(typo('+7 (999) 123-45-67'), '+7 (999) 123-45-67', 'телефон не трогаем')
eq(typo('city-tour/day-one'), 'city-tour/day-one', 'латинский slug возвращается как есть')
eq(typo('https://jumboinjapan.com/faq'), 'https://jumboinjapan.com/faq', 'URL не трогаем')
eq(typo('Wolfgang’s Steakhouse'), 'Wolfgang’s Steakhouse', 'латинская строка без кириллицы')
eq(typo(''), '', 'пустая строка')
eq(typo('перенос\nстроки'), 'перенос\nстроки', 'перевод строки сохраняется')
eq(typo('абзац\n\nабзац'), 'абзац\n\nабзац', 'двойной перевод строки не схлопывается в пробел')

// Идемпотентность: повторный прогон ничего не меняет (типографер применяется
// на рендере, и один и тот же текст проходит через него многократно).
const once = typo('Прилёт в Токио — и сразу в отель, около 40 минут...')
eq(typo(once), once, 'типографер идемпотентен')

// ── typoDeep ─────────────────────────────────────────────────────────────────
const deep = typoDeep({
  title: 'Маршрут по Токио с гидом',
  slug: 'city-tour/day-one',
  mode: 'Частный транспорт с гидом',
  stops: [{ name: 'Сад Хамарикю', text: 'Всего в десяти минутах пешком' }],
})
eq(deep.title, `Маршрут по Токио с${NBSP}гидом`, 'typoDeep обрабатывает вложенный текст')
eq(deep.slug, 'city-tour/day-one', 'typoDeep не трогает slug')
eq(deep.mode, 'Частный транспорт с гидом', 'typoDeep не трогает ключи логики (mode)')
eq(deep.stops[0].text, `Всего в${NBSP}десяти минутах пешком`, 'typoDeep идёт вглубь массивов')

const el = { $$typeof: Symbol.for('react.element'), props: { children: 'в Токио' } }
eq(typoDeep({ children: el }).children, el, 'typoDeep не разбирает React-элементы')
eq(typoDeep(null), null, 'typoDeep переносит null')
eq(typoDeep(42), 42, 'typoDeep переносит числа')

// ── Итог ─────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n❌ Провалено ${failures.length} из ${failures.length + passed}:\n`)
  failures.forEach(f => console.error('  • ' + f))
  process.exit(1)
}
console.log(`✅ Типографика: ${passed} проверок пройдено`)
