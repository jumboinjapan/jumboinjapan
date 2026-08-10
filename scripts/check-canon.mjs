#!/usr/bin/env node
/**
 * Сторож канонов текста на живой базе.
 *
 *   npm run check:canon
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ПРОГОН. За один день 10.08.2026 нашлись ТРИ канона,
 * записанных прозой и не стерегущих ничего: написание топонимов
 * («Хаконэ» — 58 вхождений в POI и 144 в маршрутах, включая утверждённые
 * описания и SEO-заголовки), склонение (128 мест), тождество place_id.
 * Ни один не нашёлся проверкой — обо все три спотыкались случайно,
 * занимаясь другим.
 *
 * Общее у них одно: правило жило в CLAUDE.md и в голове, а между ним
 * и записью в Airtable не стояло ничего. Этот прогон и есть то, что
 * стоит между. Он НЕ судит о стиле — только о том, что проверяется
 * механически и потому не должно зависеть от чьей-то внимательности.
 *
 * Падает при любом нарушении: канон, который можно «пока не чинить»,
 * через полгода снова окажется прозой.
 */
import { readFileSync } from 'node:fs'
import { CANON_SPELLING_FIXES, DECLINED_TOPONYM_FORMS } from '../src/lib/polivanov.ts'

const BASE = 'apppwhjFN82N9zNqm'
const TABLES = [
  ['tblVCmFcHRpXUT24y', 'POI'],
  ['tblIsgkRfrQZpJawB', 'Маршруты'],
  ['tblxsVqIqsxcErF7z', 'Дни маршрута'],
  ['tblcwN0cRyh0dJy62', 'Пункты дня'],
  ['tblpa3Zof1ZGofAtS', 'Остановки'],
]

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

async function load(token, table) {
  const out = []
  let offset
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${table}`)
    url.searchParams.set('pageSize', '100')
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Airtable ${res.status} на ${table}`)
    const data = await res.json()
    out.push(...data.records)
    offset = data.offset
  } while (offset)
  return out
}

/** Английские поля из проверки исключены: правила про русский текст. */
const isRussianField = (name) => !/\(EN\)|English/.test(name)

function scanText(records, label, pairs, matcher) {
  const hits = []
  for (const rec of records) {
    for (const [field, value] of Object.entries(rec.fields)) {
      if (typeof value !== 'string' || !isRussianField(field)) continue
      for (const [wrong, right] of pairs) {
        if (!matcher(value, wrong)) continue
        hits.push({ table: label, id: rec.fields['POI ID'] ?? rec.fields.Title ?? rec.id, field, wrong, right })
      }
    }
  }
  return hits
}

const plain = (text, wrong) => text.includes(wrong) || text.includes(wrong[0].toLowerCase() + wrong.slice(1))
const whole = (text, wrong) => new RegExp(`(^|[^А-Яа-яЁё])${wrong}(?![А-Яа-яЁё])`).test(text)

function report(title, hits, note) {
  console.log(`\n${title}: ${hits.length === 0 ? 'чисто' : `${hits.length} нарушений`}`)
  if (note && hits.length) console.log(`  ${note}`)
  const shown = hits.slice(0, 12)
  for (const h of shown) {
    console.log(`  ${h.table.padEnd(13)} ${String(h.id).padEnd(14)} ${h.field.padEnd(26)} «${h.wrong}» → «${h.right}»`)
  }
  if (hits.length > shown.length) console.log(`  … и ещё ${hits.length - shown.length}`)
  return hits.length
}

async function main() {
  const token = env('AIRTABLE_TOKEN')
  console.log('\nСТОРОЖ КАНОНОВ ТЕКСТА\n')

  const loaded = []
  for (const [id, label] of TABLES) loaded.push([label, await load(token, id)])
  console.log(`  прочитано записей: ${loaded.reduce((s, [, r]) => s + r.length, 0)}`)

  let bad = 0
  bad += report(
    'Канонические написания',
    loaded.flatMap(([label, recs]) => scanText(recs, label, CANON_SPELLING_FIXES, plain)),
    'Список выводится из POLIVANOV_EXCEPTIONS — правьте таблицу, не текст правила.',
  )
  bad += report(
    'Склонение топонимов',
    loaded.flatMap(([label, recs]) => scanText(recs, label, DECLINED_TOPONYM_FORMS, whole)),
    'Канон 01.08.2026: японские топонимы не склоняются. Исключения — Токио, Киото, Осака.',
  )

  // Тождество place_id: два POI с одним идентификатором — одно место,
  // заведённое дважды. Проверка отдельно от матчера имён, потому что имена
  // могут расходиться сколь угодно, а place_id — нет.
  const pois = loaded.find(([label]) => label === 'POI')[1]
  const byPlace = new Map()
  for (const rec of pois) {
    const pid = rec.fields['Google Place ID']
    if (!pid) continue
    byPlace.set(pid, [...(byPlace.get(pid) ?? []), rec.fields['POI ID']])
  }
  const dupes = [...byPlace.entries()].filter(([, ids]) => ids.length > 1)
  console.log(`\nОдин place_id — один POI: ${dupes.length === 0 ? 'чисто' : `${dupes.length} конфликтов`}`)
  for (const [pid, ids] of dupes.slice(0, 10)) console.log(`  ${pid}: ${ids.join(', ')}`)
  bad += dupes.length

  // Сезонный объект без окна нельзя сверить с датами тура — это не ошибка
  // записи, а незаполненное поле, поэтому предупреждение, а не падение.
  const seasonal = pois.filter((r) => r.fields['Operating Status'] === 'Сезонный' && !r.fields['Season Window'])
  if (seasonal.length) {
    console.log(`\nПредупреждение: сезонных объектов без окна — ${seasonal.length}`)
    for (const r of seasonal.slice(0, 10)) console.log(`  ${r.fields['POI ID']} ${r.fields['POI Name (RU)']}`)
  }

  // ── Очередь на проверку ────────────────────────────────────────────────
  //
  // Владелец 10.08.2026: «при генерации текста записи сразу выпадают из
  // списка на проверке, я не успеваю посмотреть сгенерированный текст».
  // Причина не в коде: очередь держалась на ОТСУТСТВИИ текста, а генерация
  // текст пишет — запись переставала подходить под фильтр. Работа по очереди
  // сама её и опустошала.
  //
  // Правильная ось — состояние, а не наличие: Draft (текста нет) → Review
  // (написано, ждёт человека) → Approved (человек утвердил) → Synced.
  // При такой оси генерация ДОБАВЛЯЕТ запись в очередь.
  //
  // Это предупреждение, не падение: состояние рабочего процесса, а не порча
  // данных. Но видеть его надо, иначе очередь снова протечёт молча.
  const text = (r, f) => String(r.fields[f] ?? '').trim()
  const invisible = pois.filter(
    (r) => text(r, 'Description Draft (RU)') && !text(r, 'Description Approved (RU)') && r.fields['Copy Status'] === 'Draft',
  )
  const empty = pois.filter(
    (r) => !r.fields['Is System'] && !text(r, 'Description Draft (RU)') && !text(r, 'Description (RU)'),
  )
  const waiting = pois.filter((r) => r.fields['Copy Status'] === 'Review')
  console.log('\nОчередь на проверку:')
  console.log(`  ждут вас (Copy Status = Review):        ${waiting.length}`)
  console.log(`  текст написан, но статус Draft:         ${invisible.length}  ← не видны в очереди`)
  console.log(`  без описания вовсе:                     ${empty.length}`)
  for (const r of invisible.slice(0, 10)) {
    console.log(`     ${r.fields['POI ID']} ${String(r.fields['POI Name (RU)'] ?? '').slice(0, 44)}`)
  }
  if (invisible.length > 10) console.log(`     … и ещё ${invisible.length - 10}`)

  // ── Текст лежит не в том поле ──────────────────────────────────────────
  //
  // Найдено 10.08.2026 по жалобе владельца «открываю запись, а текста нет».
  // Текст был — но в другом поле. Шесть записей по Хоккайдо имели
  // заполненный Description (RU) при пустых Draft и Approved: сайт берёт
  // approvedRu || descriptionRu и показывал текст, а редактор показывал
  // пустоту. Ещё тридцать три имели утверждённый английский, не доехавший
  // до Description (EN).
  //
  // Перекос возникает от асимметричной записи скриптом: заполнили одно
  // поле из трёх и ушли. Ни один экран этого не показывает, потому что
  // каждый смотрит в своё поле и видит там ровно то, что ожидает.
  const editorEmpty = pois.filter((r) => text(r, 'Description (RU)') && !text(r, 'Description Approved (RU)'))
  const notPublishedEn = pois.filter((r) => text(r, 'Description Approved (EN)') && !text(r, 'Description (EN)'))
  console.log('\nТекст не на месте:')
  console.log(`  опубликован, но редактор пуст:          ${editorEmpty.length}`)
  console.log(`  английский утверждён, но не перенесён:  ${notPublishedEn.length}`)
  for (const r of [...editorEmpty, ...notPublishedEn].slice(0, 8)) {
    console.log(`     ${r.fields['POI ID']} ${String(r.fields['POI Name (RU)'] ?? '').slice(0, 44)}`)
  }
  bad += editorEmpty.length + notPublishedEn.length

  console.log(bad === 0 ? '\n✓ каноны соблюдены\n' : `\n✗ нарушений: ${bad}\n`)
  process.exitCode = bad === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(`[check-canon] ${error.message}`)
  process.exitCode = 2
})
