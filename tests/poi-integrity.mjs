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


// ── Маркеры приёма ──────────────────────────────────────────────────────────
/* Тройка Intake Run ID / Origin / Contract Version проверяется атомарно.
   Фикстура содержит каждый случай ровно один раз: наследие, корректную
   новую запись (две записи одного запуска), обход конвейера, половинчатый
   маркер, незнакомую версию, битый origin и переиспользованный Run ID. */
const markers = run('tests/fixtures/poi-intake-markers')
const mItems = (code) => itemsOf(markers, code)
const mCodes = markers.findings.map((f) => f.code)

ok(mItems('intake_bypassed').length === 1, 'обход конвейера найден ровно один',
  mItems('intake_bypassed').join(' | ') || '(ничего)')
ok(mItems('intake_bypassed').join(' ').includes('recBYPASS1'),
  'и это именно запись, созданная после порога')
ok(mItems('intake_bypassed').join(' ').includes('POI-000004')
  && mItems('intake_bypassed').join(' ').includes('«Заведён руками»')
  && mItems('intake_bypassed').join(' ').includes('создана 2026-08-20'),
  'в отчёте есть recordId, POI ID, имя и дата создания',
  mItems('intake_bypassed').join(' | '))

/* Историческая запись без маркеров ошибкой не является. Именно это отличает
   проверку от простого «поле не пусто»: 466 записей живой базы заведены до
   порога, и ни одна из них не виновата. */
ok(!mItems('intake_bypassed').join(' ').includes('recLEGACY01'),
  'наследие не объявлено обходом')
ok(mCodes.includes('intake_legacy'), 'наследие посчитано отдельной строкой INFO')
ok(byCode(markers, 'intake_legacy')[0]?.level === 'INFO',
  'и это INFO, а не FAIL', byCode(markers, 'intake_legacy')[0]?.level)

/* Половинчатый маркер — FAIL независимо от возраста: старый код в эти поля
   не писал вовсе, значит заполнить половину мог только человек или чужой код. */
ok(mItems('intake_marker_partial').length === 1, 'половинчатый маркер найден',
  mItems('intake_marker_partial').join(' | ') || '(ничего)')
ok(mItems('intake_marker_partial').join(' ').includes('Intake Origin'),
  'и названо, какое поле пусто')
ok(mItems('intake_marker_partial').join(' ').includes('recPARTIAL'),
  'возраст записи половинчатый маркер не оправдывает')

ok(mItems('intake_origin_invalid').length === 1, 'неразбираемый origin найден',
  mItems('intake_origin_invalid').join(' | ') || '(ничего)')
/* Две записи с версией v0: одиночная и вторая половина смешанного запуска.
   Обе законно попадают сюда — незнакомая версия ошибка сама по себе,
   независимо от того, есть ли рядом разнобой внутри запуска. */
ok(mItems('intake_version_unknown').length === 2, 'незнакомая версия найдена',
  mItems('intake_version_unknown').join(' | ') || '(ничего)')
ok(mItems('intake_version_unknown').join(' ').includes('recOLDVER1'),
  'и одиночная запись с v0 среди них')
ok(mItems('intake_run_inconsistent').length === 2, 'разнобой внутри Run ID найден дважды',
  mItems('intake_run_inconsistent').join(' | ') || '(ничего)')
ok(mItems('intake_run_inconsistent').join(' ').includes('run-eee'),
  'и назван сам идентификатор запуска')

/* Разнобой версий внутри одного Run ID — отдельная ветка, а не «иначе»
   после разнобоя источников: запуск может разойтись и по тому, и по другому,
   и вторая половина не должна прятаться за первой. */
ok(mItems('intake_run_inconsistent').some((i) => i.includes('run-fff') && i.includes('версии')),
  'разнобой версий внутри одного Run ID найден',
  mItems('intake_run_inconsistent').join(' | '))

/* Неизвестный возраст — FAIL, а не наследие. Иначе достаточно испортить одну
   дату, чтобы обход перестал находиться. */
ok(mItems('intake_created_time_invalid').length === 2, 'пустой маркер без даты — ошибка',
  mItems('intake_created_time_invalid').join(' | ') || '(ничего)')
ok(mItems('intake_created_time_invalid').join(' ').includes('recNODATE1')
  && mItems('intake_created_time_invalid').join(' ').includes('recBADDATE'),
  'и отсутствующая, и неразбираемая дата обе пойманы')
ok(!mItems('intake_created_time_invalid').join(' ').includes('recLEGACY01'),
  'запись с нормальной датой в этот список не попала')

/* Корректные записи не должны попадать ни в один список. Две записи одного
   запуска с одинаковыми origin и версией — это норма, а не разнобой. */
const allMarkerItems = ['intake_bypassed', 'intake_marker_partial', 'intake_origin_invalid',
  'intake_version_unknown', 'intake_run_inconsistent', 'intake_created_time_invalid'].flatMap(mItems).join(' ')
ok(!allMarkerItems.includes('recGOOD001') && !allMarkerItems.includes('recGOOD002'),
  'корректные записи ни в одну ошибку не попали', allMarkerItems)
ok(!allMarkerItems.includes('run-aaa'),
  'две записи одного запуска разнобоем не считаются')

// ── Итог ─────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n❌ Провалено ${failures.length} из ${failures.length + passed}:\n`)
  failures.forEach((f) => console.error('  • ' + f))
  process.exit(1)
}
console.log(`✓ целостность POI: ${passed} проверок пройдено`)
