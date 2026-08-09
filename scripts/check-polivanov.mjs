#!/usr/bin/env node
/**
 * Сверка транслитератора с живой базой.
 *
 *   npm run check:polivanov
 *   npm run check:polivanov -- --show 60     показать расхождения
 *
 * Зачем это отдельный прогон, а не юнит-тест. Правила Поливанова
 * однозначны не везде, а канон сайта местами важнее правил: «Хаконе»,
 * а не «Хаконэ». Спорные места нельзя решать по учебнику — их решает
 * то, как владелец уже написал 394 имени руками. Каждый вопрос по ходу
 * работы закрывался счётом по этому корпусу:
 *
 *   ai → ай  34 : 3    ei → эй  12 : 0    oi → ои  0 : 5    ui → уи  7 : 3
 *
 * Эталон — не идеал. Половина расхождений это редакторские решения,
 * которых транслитератор не может знать: «Музей повести о Гэндзи»,
 * «Маяк „Морская свеча“», «Рыбный рынок Тоёсу». Поэтому прогон НЕ падает
 * по доле совпадений — он падает, если совпадений стало заметно меньше,
 * чем в прошлый раз. Это тест на регрессию, а не на совершенство.
 */

import { readFile } from 'node:fs/promises'
import nextEnv from '@next/env'
import { poiNameToRu } from '../src/lib/polivanov.ts'
import { normalizeName } from '../src/lib/poi-matching.ts'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

/**
 * Порог регрессии. Значение измерено 6 августа 2026 на 394 парах имён.
 * Поднимать его можно, опускать — только вместе с объяснением почему.
 */
const MIN_EXACT_SHARE = 0.45

async function loadCorpus(fixture) {
  if (fixture) {
    return JSON.parse(await readFile(fixture, 'utf8'))
  }
  const token = process.env.AIRTABLE_TOKEN?.trim()
  const baseId = process.env.AIRTABLE_BASE_ID?.trim() || 'apppwhjFN82N9zNqm'
  if (!token) {
    // Без токена берём снимок корпуса из репозитория. Прогон должен
    // работать везде, где работает git: проверка на регрессию, которая
    // требует доступа к живой базе, не запускается, а значит бесполезна.
    console.log('AIRTABLE_TOKEN не задан — сверка идёт по снимку tests/fixtures/poi-names.json')
    return JSON.parse(await readFile('tests/fixtures/poi-names.json', 'utf8'))
  }

  const out = []
  let offset
  try {
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${POI_TABLE_ID}`)
    url.searchParams.set('pageSize', '100')
    for (const f of ['POI ID', 'POI Name (RU)', 'POI Name (EN)']) url.searchParams.append('fields[]', f)
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    if (!res.ok) throw new Error(`Airtable: ${res.status} ${await res.text()}`)
    const data = await res.json()
    out.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)
  } catch (error) {
    // Сети может не быть — тогда сверяемся со снимком, а не падаем.
    // Проверка на регрессию обязана работать в том числе офлайн, иначе
    // её перестанут запускать.
    console.log(`База недоступна (${error.message}) — сверка по снимку tests/fixtures/poi-names.json`)
    return JSON.parse(await readFile('tests/fixtures/poi-names.json', 'utf8'))
  }

  return out
    .map((r) => ({ id: r.fields['POI ID'], ru: r.fields['POI Name (RU)'], en: r.fields['POI Name (EN)'] }))
    .filter((p) => typeof p.ru === 'string' && typeof p.en === 'string' && p.ru.trim() && p.en.trim())
}

async function main() {
  const argv = process.argv.slice(2)
  const show = argv.includes('--show') ? Number(argv[argv.indexOf('--show') + 1]) || 40 : 0
  const fixtureIndex = argv.indexOf('--fixture')
  const pairs = await loadCorpus(fixtureIndex >= 0 ? argv[fixtureIndex + 1] : null)

  const key = (s) => normalizeName(s)
  const bag = (s) => key(s).split(' ').sort().join(' ')

  let exact = 0
  let reordered = 0
  let flagged = 0
  const diverged = []

  for (const p of pairs) {
    const r = poiNameToRu(p.en)
    // Имя с латиницей или без единого японского слова уходит человеку —
    // в долю совпадений оно не входит ни в плюс, ни в минус.
    if (!r.nameRu || r.confidence < 0.95 || r.keptLatin.length) {
      flagged += 1
      continue
    }
    if (key(r.nameRu) === key(p.ru)) exact += 1
    else if (bag(r.nameRu) === bag(p.ru)) reordered += 1
    else diverged.push([p.id, p.en, p.ru, r.nameRu, r.warnings])
  }

  const auto = exact + reordered + diverged.length
  const share = auto ? exact / auto : 0

  console.log(`\nСВЕРКА ПОЛИВАНОВА — ${pairs.length} пар имён из базы\n`)
  console.log(`  собрано без вмешательства   ${auto}`)
  console.log(`    совпало с эталоном        ${exact}  (${Math.round(share * 100)}%)`)
  console.log(`    разошёлся порядок слов    ${reordered}`)
  console.log(`    разошлось                 ${diverged.length}`)
  console.log(`  отдано человеку             ${flagged}  (латиница или заимствование)\n`)

  for (const [id, en, ru, got] of diverged.slice(0, show)) {
    console.log(`  ${String(id).padEnd(11)} ${en.slice(0, 34).padEnd(34)}`)
    console.log(`              эталон: ${ru}`)
    console.log(`              собрано: ${got}\n`)
  }

  if (share < MIN_EXACT_SHARE) {
    console.error(
      `✗ РЕГРЕССИЯ: совпадений ${Math.round(share * 100)}%, порог ${Math.round(MIN_EXACT_SHARE * 100)}%.\n` +
        '  Транслитератор стал хуже — сравните с прошлым прогоном, прежде чем собирать имена.',
    )
    process.exitCode = 1
  } else {
    console.log(`Порог ${Math.round(MIN_EXACT_SHARE * 100)}% пройден.`)
  }
}

main().catch((error) => {
  console.error(`[check-polivanov] ${error.message}`)
  process.exitCode = 2
})
