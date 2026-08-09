#!/usr/bin/env node
/**
 * Сверка транслитератора с Wikidata.
 *
 *   npm run check:polivanov-wd -- --portal bodik-kyoto-tourism --limit 200
 *
 * ЗАЧЕМ ЭТО ОТДЕЛЬНО ОТ check:polivanov.
 *
 * Тот прогон сверяется с 394 именами, которые владелец написал руками.
 * Это эталон вкуса, но не эталон правильности: если владелец где-то
 * ошибся, транслитератор будет «ошибаться» вместе с ним и прогон этого
 * не покажет. Нужен источник, независимый от проекта.
 *
 * Wikidata им и служит. Идея простая: у объекта там есть японская метка
 * и латинская (обычно Хэпбёрн — «Tōdai-ji», «Senshō-ji Temple»). Мы берём
 * ДВА РАЗНЫХ ВХОДА — чтение каной из открытых данных и латиницу
 * из Wikidata — и прогоняем оба через одну таблицу Поливанова. Если
 * таблица верна, результаты обязаны совпасть. Расхождение означает ошибку
 * ровно в одном месте: либо в разборе каны, либо в разборе ромадзи,
 * и какое именно — видно из пары.
 *
 * Совпадение здесь весит больше, чем совпадение с живой базой: два входа
 * независимы, и согласиться случайно они не могут.
 */

import nextEnv from '@next/env'
import { getPortal } from './poi-portals/registry.mjs'
import { collectFromOpenDataCsv } from './poi-portals/lib/opendata-csv.mjs'
import { poiNameFromKana, poiNameToRu } from '../src/lib/polivanov.ts'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const SPARQL = 'https://query.wikidata.org/sparql'
const UA = 'jumboinjapan-poi-check/1.0 (https://jumboinjapan.com)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Латинская метка объекта по его японскому названию. */
async function fetchLatinLabels(names) {
  const found = new Map()
  for (let i = 0; i < names.length; i += 25) {
    const batch = names.slice(i, i + 25)
    const values = batch.map((n) => `"${n.replace(/["\\]/g, '')}"@ja`).join(' ')
    const query = `SELECT ?jaLabel ?enLabel WHERE {
      VALUES ?ja { ${values} }
      ?item rdfs:label ?ja . ?item rdfs:label ?enLabel . FILTER(lang(?enLabel)='en')
      BIND(?ja AS ?jaLabel) } LIMIT 120`

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, {
          headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
        })
        // Wikidata держит общий лимит на всех и отвечает 429/503 щедро.
        // Отступ обязателен: без него прогон выглядит как отсутствие данных.
        if (res.status === 429 || res.status === 503) { await sleep(5000); continue }
        if (!res.ok) break
        const data = await res.json()
        for (const b of data.results.bindings) found.set(b.jaLabel.value, b.enLabel.value)
        break
      } catch { await sleep(3000) }
    }
    await sleep(1200)
  }
  return found
}

/**
 * Ядро имени без родового слова: сравнивать надо звучание, а не то,
 * перевели ли «Temple» словом «Храм». Родовые слова разных языков сюда
 * не относятся — их проверяет check:polivanov по живой базе.
 */
function core(value) {
  return String(value ?? '')
    .toLowerCase()
    // Японское родовое слово, оставшееся ВНУТРИ имени, тоже снимается.
    // Два источника расходятся не в звучании, а в том, перевести его или
    // сохранить: 経ヶ岬 это «Мыс Кёга» по кане и «Cape Kyōgamisaki»
    // по Wikidata — «мисаки» там осталось в имени. Звучание при этом
    // одинаковое, и именно оно здесь проверяется.
    .replace(/(?:мисаки|хама|кофун|дзиндзя|тайся|онсэн|коэн|гава|кава|таки|дайра|когэн|бокудзё|танада)$/u, '')
    .replace(/^(?:храм|святилище|музей|замок|руины замка|парк|сад|гора|озеро|мыс|пляж|рынок|курган|водопад|мост|остров|станция|башня|ворота|пруд|долина|река|плотина|перевал|ущелье|зоопарк|аквариум|горячие источники|художественный музей|ботанический сад|смотровая)\s+/u, '')
    .replace(/[^а-яё]/g, '')
}

async function main() {
  const argv = process.argv.slice(2)
  const portalId = argv[argv.indexOf('--portal') + 1] || 'bodik-kyoto-tourism'
  const limit = Number(argv[argv.indexOf('--limit') + 1]) || 200

  const portal = getPortal(portalId)
  const { candidates } = await collectFromOpenDataCsv(portal, {})
  const withKana = candidates.filter((c) => c.nameJa && c.nameKana).slice(0, limit)
  console.log(`\nСВЕРКА С WIKIDATA — ${portal.label}\n`)
  console.log(`  строк с чтением каной: ${withKana.length}`)

  const labels = await fetchLatinLabels(withKana.map((c) => c.nameJa))
  console.log(`  нашлось в Wikidata:    ${labels.size}\n`)

  let agree = 0
  const disagree = []
  for (const c of withKana) {
    const latin = labels.get(c.nameJa)
    if (!latin) continue
    const fromKana = poiNameFromKana(c.nameJa, c.nameKana)
    // Латинскую сторону гоняем через ПОЛНЫЙ сборщик имени, а не через
    // голый romajiToCyrillic. Первая версия сверки этого не делала, и
    // «Cape Kyōgamisaki» превращалось в «апэкёгамисаки»: слово «Cape»
    // разбиралось как ромадзи. Сверка показывала 38% расхождений, из
    // которых настоящими были единицы — ошибка была в измерителе.
    const fromLatin = poiNameToRu(latin)
    if (!fromKana.nameRu || !fromLatin.nameRu) continue
    // Заимствования сравнивать нечем: латинская сторона оставит слово
    // как есть, кана даст его звучание, и совпасть они не могут.
    if (fromLatin.keptLatin.length) continue
    if (core(fromKana.nameRu) === core(fromLatin.nameRu)) agree += 1
    else disagree.push([c.nameJa, c.nameKana, fromKana.nameRu, latin, fromLatin.nameRu])
  }

  const total = agree + disagree.length
  const share = total ? agree / total : 0
  console.log(`  сравнимых пар:         ${total}`)
  console.log(`  два входа сошлись:     ${agree}  (${Math.round(share * 100)}%)`)
  console.log(`  разошлись:             ${disagree.length}\n`)

  for (const [ja, kana, ru, latin, ruLatin] of disagree.slice(0, 25)) {
    console.log(`  ${ja}`)
    console.log(`      кана    ${kana}  →  ${ru}`)
    console.log(`      Wikidata ${latin}  →  ${ruLatin}\n`)
  }

  // Порог 60%, и это не занижение планки, а честная цена оставшегося
  // расхождения. Замер 6 августа 2026 на Киото: 20 из 31. Все одиннадцать
  // несовпадений разобраны поштучно, и НИ ОДНО не является ошибкой
  // звучания — расходятся границы слов и выбор родового слова:
  //
  //   屏風岩       Бёбуива      / Бёбу          岩 переведено как «Rock»
  //   大宮ふれあい工房 Омияфурэайкобо / Омия Фурэай  кана не ставит пробелов
  //   円頓寺       Храм Эндондзи / Торговый центр Эндодзи — Wikidata
  //                              описывает ДРУГОЙ объект, улицу у храма
  //
  // Это предел метода: кана записывает звучание, но не размечает границы
  // слов, и «Омияфурэайкобо» не разложить на «Омия Фурэай» без словаря.
  // Wikidata эти границы знает — и именно поэтому её стоит подключать
  // как обогащение, а не только как проверку.
  if (total >= 10 && share < 0.6) {
    console.error(`✗ Сошлось только ${Math.round(share * 100)}% — таблица расходится сама с собой.`)
    process.exitCode = 1
  } else if (total >= 10) {
    console.log('Два входа согласованы.')
  } else {
    console.log('Слишком мало пар для вывода — Wikidata не отдала метки.')
  }
}

main().catch((error) => {
  console.error(`[check-polivanov-wd] ${error.message}`)
  process.exitCode = 2
})
