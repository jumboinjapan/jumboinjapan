#!/usr/bin/env node
/**
 * Инварианты проверки целостности базы POI (scripts/check-poi-integrity.mjs).
 *
 * Запуск: node tests/poi-integrity.mjs
 *
 * Зачем. 9 августа первый прогон по живой базе дал 55 «Parent POI указывает
 * на удалённую запись» — и ни одна из них не была удалена. `Parent POI` это
 * связанное поле, Airtable отдаёт в нём record id, а проверка сравнивала его
 * с множеством POI ID. Совпасть не могло никогда. Тем же были сломаны ещё
 * два правила рядом: «сам себе родитель» и поиск циклов. Три правила из
 * десяти молча не работали неизвестно сколько.
 *
 * Пережить это второй раз не хочется. Проверку проверяет фикстура: восемь
 * записей, в которых каждый нужный случай представлен ровно один раз.
 * Скрипт умеет `--json`, так что сверяемся с машинным отчётом, а не с
 * текстом для человека.
 */
import { execFileSync } from 'node:child_process'

const failures = []
let passed = 0

function ok(condition, message, detail) {
  if (condition) { passed++; return }
  failures.push(detail ? `${message}\n    ${detail}` : message)
}

/* Скрипт выходит с кодом 1, когда находит поломки, — здесь это норма:
   фикстура их и содержит намеренно. Нас интересует отчёт, а не код выхода,
   поэтому ненулевой выход перехватываем и читаем stdout из ошибки. */
function run(fixture) {
  const args = ['scripts/check-poi-integrity.mjs', '--fixture', fixture, '--json']
  const options = {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...process.env, AIRTABLE_TOKEN: '', AIRTABLE_BASE_ID: '' },
  }
  let out
  try {
    out = execFileSync('node', args, options)
  } catch (error) {
    if (typeof error.stdout !== 'string' || !error.stdout.trim()) throw error
    out = error.stdout
  }
  return JSON.parse(out)
}

const byCode = (report, code) => report.findings.filter((f) => f.code === code)
const itemsOf = (report, code) => byCode(report, code).flatMap((f) => f.items ?? [])

// ── Основная фикстура ────────────────────────────────────────────────────────
const report = run('tests/fixtures/poi-integrity')

ok(report.pois === 8, 'фикстура прочитана целиком', `точек в отчёте: ${report.pois}`)

// ── Иерархия ────────────────────────────────────────────────────────────────
const dangling = itemsOf(report, 'parent_dangling').join(' ')

/* Длина списка здесь важнее имён в нём. Баг 2026-08-09 объявлял висячими
   ВСЕХ, у кого родитель есть, и подписывал их record id — поиск по «POI-…»
   такой список благополучно не находил и утверждение проходило зря. */
ok(itemsOf(report, 'parent_dangling').length === 1,
  'висячий родитель ровно один — остальные три ссылки живые',
  `висячих: ${itemsOf(report, 'parent_dangling').length}, список: ${dangling || '(пусто)'}`)

ok(!dangling.includes('POI-000102') && !dangling.includes('rec00000000000102'),
  'живой родитель НЕ считается удалённым',
  `в списке висячих: ${dangling || '(пусто)'}`)
ok(!dangling.includes('POI-000111') && !dangling.includes('rec00000000000111'),
  'связанная пара «часть и целое» не считается висячей',
  `в списке висячих: ${dangling || '(пусто)'}`)
ok(dangling.includes('POI-000103'),
  'ссылка на удалённую запись ловится',
  `в списке висячих: ${dangling || '(пусто)'}`)
ok(dangling.includes('recDELETED000000'),
  'в отчёте виден недостающий record id — по нему и искать',
  `в списке висячих: ${dangling || '(пусто)'}`)

ok(itemsOf(report, 'parent_self').join(' ').includes('POI-000104'),
  'запись, назначенная родителем самой себе, ловится')

ok(byCode(report, 'parent_cycle').length > 0,
  'цикл в иерархии ловится',
  'до 2026-08-09 это правило не срабатывало никогда')

// ── Дубли ───────────────────────────────────────────────────────────────────
const duplicates = itemsOf(report, 'duplicates').join(' ')

ok(itemsOf(report, 'duplicates').length === 1,
  'пара дублей ровно одна — размеченная не в счёт',
  `дублей: ${itemsOf(report, 'duplicates').length}, список: ${duplicates || '(пусто)'}`)
ok(!duplicates.includes('POI-000111') && !duplicates.includes('POI-000110'),
  'размеченная через Parent POI пара не зовётся дублем',
  `в списке дублей: ${duplicates || '(пусто)'}`)
ok(duplicates.includes('POI-000113') || duplicates.includes('POI-000112'),
  'похожая НЕразмеченная пара остаётся в списке дублей',
  `в списке дублей: ${duplicates || '(пусто)'}`)

// ── Источник без record id: пропуск, а не враньё ─────────────────────────────
const noIds = run('tests/fixtures/poi-integrity-no-ids')

ok(byCode(noIds, 'no_record_ids').length > 0,
  'без record id иерархия пропускается вслух')
ok(itemsOf(noIds, 'parent_dangling').length === 0,
  'без record id проверка НЕ выдумывает висячих родителей',
  `выдумано: ${itemsOf(noIds, 'parent_dangling').join(' ') || '(ничего)'}`)

// ── Итог ─────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n❌ Провалено ${failures.length} из ${failures.length + passed}:\n`)
  failures.forEach((f) => console.error('  • ' + f))
  process.exit(1)
}
console.log(`✓ целостность POI: ${passed} проверок пройдено`)
