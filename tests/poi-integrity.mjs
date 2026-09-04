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
import { readFileSync } from 'node:fs'

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

// ── Коллекция: разные части, настоящий дубль и связка родитель-ребёнок ──────
/* Отдельная фикстура на именованную коллекцию. Восемь записей:
   родитель без координат, два РАЗНЫХ объекта коллекции в 122 м, настоящий
   повтор одного из них с уточнением места в 3 м, запись с НЕСРАВНИМЫМИ
   именами коллекций, пара с одной основой и НЕСВЕРЕННЫМИ уточнениями и
   запись, у которой русское имя совпадает, а английское относит её
   к ДРУГОЙ коллекции. Проверка обязана развести все шесть случаев, и ни
   один из них не решается порогом «на глаз»:
     — разные объекты не попадают в дубли, хотя имена совпадают на 4/5 длины;
     — повтор попадает, ХОТЯ У НЕГО ТОТ ЖЕ Parent POI, что и у соседа;
     — ребёнок с родителем не попадают, потому что связь размечена;
     — чужая коллекция уходит в отдельную находку WARN, а не в дубли;
     — несверенные уточнения уходят в СВОЮ находку WARN, хотя их вес имени
       ниже порога показа и в разбор дублей они не попадают вовсе;
     — расхождение осей (RU совпал, EN относит к другой коллекции) уходит
       в третью находку WARN, хотя лучшая ось даёт вес 1.
   Кодов находок четыре, уровня серьёзности два: FAIL и WARN.
   Это локальная фикстура на выдуманных записях: она НЕ заменяет прогон
   check:poi по базе Airtable и ничего о её состоянии не говорит. */
const collection = run('tests/fixtures/poi-collection')
const collectionDuplicates = itemsOf(collection, 'duplicates').join(' ')

ok(collection.pois === 8, 'фикстура коллекции прочитана целиком',
  `точек в отчёте: ${collection.pois}`)
ok(!collectionDuplicates.includes('POI-000604'),
  'чужая коллекция через другой алфавит дублем не зовётся',
  `в списке дублей: ${collectionDuplicates || '(пусто)'}`)
ok(itemsOf(collection, 'duplicates').length === 1,
  'в коллекции ровно одна пара дублей',
  `дублей: ${itemsOf(collection, 'duplicates').length}, список: ${collectionDuplicates || '(пусто)'}`)
ok(collectionDuplicates.includes('POI-000601') && collectionDuplicates.includes('POI-000603'),
  'настоящий повтор внутри коллекции найден — общий Parent POI его не прячет',
  `в списке дублей: ${collectionDuplicates || '(пусто)'}`)
ok(!collectionDuplicates.includes('POI-000602'),
  'два разных объекта одной коллекции дублями не зовутся',
  `в списке дублей: ${collectionDuplicates || '(пусто)'}`)
ok(!collectionDuplicates.includes('POI-000600'),
  'родитель коллекции не зовётся дублем своего объекта',
  `в списке дублей: ${collectionDuplicates || '(пусто)'}`)

/* Недоказанное равенство коллекций — ОТДЕЛЬНАЯ находка и отдельный уровень.
   До 13.08.2026 checkDuplicates() читала только blockingDuplicate, поэтому
   такая пара не показывалась нигде, и утверждение «пропущенный дубль виден
   в отчёте целостности» было ложным. WARN, а не FAIL: сливать по совпавшему
   объекту нельзя — так же выглядит и перевод одной коллекции, и чужая. */
const unverified = itemsOf(collection, 'collection_identity_unverified').join(' ')

ok(byCode(collection, 'collection_identity_unverified').length === 1,
  'недоказанное равенство коллекций попадает в отчёт',
  `находок: ${byCode(collection, 'collection_identity_unverified').length}`)
ok(byCode(collection, 'collection_identity_unverified')[0]?.level === 'WARN',
  'и это WARN, а не команда на слияние',
  `уровень: ${byCode(collection, 'collection_identity_unverified')[0]?.level}`)
ok(unverified.includes('POI-000604'),
  'пара с чужой коллекцией показана',
  `в находке: ${unverified || '(пусто)'}`)
ok(/имена коллекций сравнить нечем/.test(unverified),
  'и названа причина, а не только пара',
  `в находке: ${unverified || '(пусто)'}`)
ok(!collectionDuplicates.includes('POI-000604'),
  'и она НЕ смешана с дублями',
  `в списке дублей: ${collectionDuplicates || '(пусто)'}`)
ok(byCode(collection, 'duplicates').length === 1 && byCode(collection, 'duplicates')[0].level === 'FAIL',
  'настоящий дубль остаётся единственным FAIL duplicates',
  `находок duplicates: ${byCode(collection, 'duplicates').length}`)

/* Несверенные уточнения — своя находка со своим кодом. Вес такой пары ниже
   порога показа, в duplicates она не попадает вовсе, и до 13.08.2026 её не
   было видно нигде. */
const qualifier = itemsOf(collection, 'qualifier_identity_unverified').join(' ')

ok(byCode(collection, 'qualifier_identity_unverified').length === 1,
  'несверенные уточнения попадают в отчёт',
  `находок: ${byCode(collection, 'qualifier_identity_unverified').length}`)
ok(byCode(collection, 'qualifier_identity_unverified')[0]?.level === 'WARN',
  'и это WARN, а не команда на слияние')
ok(qualifier.includes('POI-000605') && qualifier.includes('POI-000606'),
  'пара с несверенными уточнениями показана',
  `в находке: ${qualifier || '(пусто)'}`)
ok(!collectionDuplicates.includes('POI-000605') && !collectionDuplicates.includes('POI-000606'),
  'и она НЕ смешана с дублями',
  `в списке дублей: ${collectionDuplicates || '(пусто)'}`)
ok(!unverified.includes('POI-000605'),
  'и не смешана с находкой про коллекции',
  `в находке про коллекции: ${unverified || '(пусто)'}`)

/* Рекомендация не должна предлагать Parent POI как универсальное решение:
   выдуманная родительская связь ради зелёного отчёта — это порча данных. */
for (const code of ['collection_identity_unverified', 'qualifier_identity_unverified']) {
  const detail = byCode(collection, code)[0]?.detail ?? ''
  ok(/один ли это объект/.test(detail),
    `${code}: рекомендация начинается с вопроса «один ли это объект»`, detail.slice(0, 120))
  ok(/объединить/.test(detail),
    `${code}: для одного объекта предложено объединение`, detail.slice(0, 120))
  ok(/только если/i.test(detail),
    `${code}: родитель предлагается лишь при реально существующей записи`, detail.slice(0, 200))
}
const collectionDetail = byCode(collection, 'collection_identity_unverified')[0]?.detail ?? ''
ok(/выдумывать связь/.test(collectionDetail),
  'отчёт прямо запрещает выдумывать родительскую связь', collectionDetail.slice(0, 200))

/* Расхождение осей: русские имена совпали, английские относят записи
   к разным коллекциям. Вес по лучшей оси равен 1 — до 13.08.2026 такая
   пара блокировалась как дубль, потому что evidence хранилось только
   от победившей пары имён. */
const conflict = itemsOf(collection, 'collection_identity_conflict').join(' ')

ok(byCode(collection, 'collection_identity_conflict').length === 1,
  'расхождение осей попадает в отчёт',
  `находок: ${byCode(collection, 'collection_identity_conflict').length}`)
ok(byCode(collection, 'collection_identity_conflict')[0]?.level === 'WARN',
  'и это WARN, а не команда на слияние')
ok(conflict.includes('POI-000607'),
  'пара с расхождением осей показана', `в находке: ${conflict || '(пусто)'}`)
ok(/по оси ru↔ru/.test(conflict) && /коллекции разные \(en↔en\)/.test(conflict),
  'и названы обе оси: чем набран вес и что расходится',
  `в находке: ${conflict || '(пусто)'}`)
ok(!collectionDuplicates.includes('POI-000607'),
  'и она НЕ смешана с дублями',
  `в списке дублей: ${collectionDuplicates || '(пусто)'}`)
/* Одна пара может нести НЕСКОЛЬКО видов расхождения сразу, и коды отчёта
   не взаимоисключающие: POI-000604 ⟷ POI-000607 несёт и «имена коллекций
   сравнить нечем» (ru↔ru), и «коллекции разные» (en↔en). Внутри каждого кода
   пара при этом встречается РОВНО ОДИН раз. */
const pairIn = (items, a, b) => items.filter((i) => i.includes(a) && i.includes(b)).length

ok(pairIn(itemsOf(collection, 'collection_identity_unverified'), 'POI-000604', 'POI-000607') === 1,
  'составная пара попала в код о несравнимых коллекциях ровно один раз',
  itemsOf(collection, 'collection_identity_unverified').join(' | '))
ok(pairIn(itemsOf(collection, 'collection_identity_conflict'), 'POI-000604', 'POI-000607') === 1,
  'та же пара попала и в код о расхождении осей — виды не взаимоисключающие',
  itemsOf(collection, 'collection_identity_conflict').join(' | '))
ok(/имена коллекций сравнить нечем/.test(
  itemsOf(collection, 'collection_identity_conflict').find((i) => i.includes('POI-000604')) ?? '')
  && /коллекции разные/.test(
  itemsOf(collection, 'collection_identity_conflict').find((i) => i.includes('POI-000604')) ?? ''),
  'и в строке отчёта перечислены ОБА вида, а не только свой',
  itemsOf(collection, 'collection_identity_conflict').find((i) => i.includes('POI-000604')) ?? '(нет)')

const conflictDetail = byCode(collection, 'collection_identity_conflict')[0]?.detail ?? ''
ok(/один ли это объект/.test(conflictDetail) && /только если/i.test(conflictDetail),
  'рекомендация не предлагает выдуманный Parent POI', conflictDetail.slice(0, 200))

// ── Прямая связь Parent POI гасит identity-WARN, общий родитель — нет ───────
/* Тот же контракт, что у checkDuplicates: если одна запись НАПРЯМУЮ указывает
   на другую через Parent POI, отношение пары уже разобрано человеком, и
   повторять вопрос незачем. До 13.08.2026 это правило действовало только на
   duplicates и collection_identity_unverified, а два новых WARN его не знали
   и оставались висеть на размеченных парах.

   Фикстура poi-collection-linked — та же восьмёрка записей, но:
     POI-000606 → Parent POI = POI-000605  (прямая связь внутри пары уточнений)
     POI-000607 → Parent POI = POI-000601  (прямая связь внутри ОДНОЙ из пар коллекций)
     POI-000604 → Parent POI = POI-000600  (ОБЩИЙ родитель с POI-000601/603, прямой связи нет)
   Остальное — без изменений. */
const linked = run('tests/fixtures/poi-collection-linked')
const linkedDup = itemsOf(linked, 'duplicates').join(' ')
const linkedQualifier = itemsOf(linked, 'qualifier_identity_unverified').join(' ')
const linkedConflict = itemsOf(linked, 'collection_identity_conflict').join(' ')
const linkedUnverified = itemsOf(linked, 'collection_identity_unverified').join(' ')

// 1. Прямая связь гасит предупреждение об уточнениях.
ok(!linkedQualifier.includes('POI-000605') && !linkedQualifier.includes('POI-000606'),
  'прямая связь через Parent POI гасит WARN об уточнениях',
  `в находке: ${linkedQualifier || '(пусто)'}`)
ok(itemsOf(collection, 'qualifier_identity_unverified').length === 1,
  'а без связи та же пара предупреждение даёт',
  `в фикстуре без связей: ${itemsOf(collection, 'qualifier_identity_unverified').length}`)

// 2. Прямая связь гасит предупреждение о расхождении осей — но только свою пару.
ok(!/POI-000601 «[^»]*» ⟷ POI-000607|POI-000607 «[^»]*» ⟷ POI-000601/.test(linkedConflict),
  'прямая связь через Parent POI гасит WARN о расхождении осей',
  `в находке: ${linkedConflict || '(пусто)'}`)
// 3. Посторонняя родительская связь чужую пару не скрывает.
ok(linkedConflict.includes('POI-000603') && linkedConflict.includes('POI-000607'),
  'посторонняя связь не скрывает предупреждение у другой пары',
  `в находке: ${linkedConflict || '(пусто)'}`)

// 4. ОБЩИЙ родитель ничего не скрывает: ни настоящий дубль, ни предупреждение.
ok(linkedDup.includes('POI-000601') && linkedDup.includes('POI-000603'),
  'общий родитель НЕ скрывает настоящий дубль',
  `в списке дублей: ${linkedDup || '(пусто)'}`)
ok(linkedUnverified.includes('POI-000604'),
  'общий родитель НЕ скрывает предупреждение о несравнимых коллекциях',
  `в находке: ${linkedUnverified || '(пусто)'}`)

// 5. Гашение идёт от РАЗМЕТКИ, а не от сломанных ссылок: в этой фикстуре
//    иерархия исправна, и собственные проверки иерархии молчат.
ok(itemsOf(linked, 'parent_dangling').length === 0,
  'в фикстуре со связями нет висячих родителей',
  `висячих: ${itemsOf(linked, 'parent_dangling').join(' ') || '(нет)'}`)
ok(byCode(linked, 'parent_cycle').length === 0,
  'и нет циклов')
/* А сами проверки цикла и висячей ссылки продолжают работать: это доказывает
   основная фикстура выше — parent_dangling ровно один, parent_cycle найден. */

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

// ── Публикация: пустая карточка и неодобренный текст ────────────────────────
/* Почему эта фикстура появилась 25.08.2026.
   Проверки публикации до сих пор не проверялись НИКОГДА: дамп текстовых
   полей не нёс, loadFixture их обнулял, и обе проверки уходили в SKIP. Под
   этим прикрытием `checkEmptyOnLive` читала поле «Description Override»,
   которого не рендерит никто: и сайт (src/lib/airtable.ts), и админка
   (RouteStopsEditor) работают с «Stop Description Override Approved (RU)».
   Остановка с заполненным одобренным override объявлялась пустой карточкой.
   Нашлось это при подготовке 10e-E2: три новые связи дали бы три ложные
   ПОЛОМКИ уже ПОСЛЕ необратимых записей.

   Фикстура разводит все четыре источника текста по одному случаю на каждый,
   поэтому ни одно утверждение ниже не проходит «заодно». */
const pub = run('tests/fixtures/poi-integrity-publication')
const pubItems = (code) => itemsOf(pub, code).join(' ')

ok(pub.findings.every((f) => f.code !== 'no_content_fields'),
  'дамп с текстовыми полями больше не пропускает проверки публикации',
  JSON.stringify(pub.findings.filter((f) => f.code === 'no_content_fields')))

ok(itemsOf(pub, 'empty_on_live').length === 1,
  'пустой объявлена ровно одна остановка из пяти',
  `список: ${pubItems('empty_on_live') || '(пусто)'}`)
ok(pubItems('empty_on_live').includes('POI-000201'),
  'остановка, у которой текста нет нигде, ловится',
  pubItems('empty_on_live'))
ok(!pubItems('empty_on_live').includes('POI-000202'),
  'остановка с одобренным override НЕ пустая — это поле и рендерит сайт',
  pubItems('empty_on_live'))
ok(!pubItems('empty_on_live').includes('POI-000203'),
  'остановка со старым override тоже не пустая — покрытие легаси-поля сохранено',
  pubItems('empty_on_live'))
ok(!pubItems('empty_on_live').includes('POI-000204'),
  'остановка, у которой описание лежит в самой записи POI, не пустая',
  pubItems('empty_on_live'))

ok(itemsOf(pub, 'unapproved_on_live').length === 1
  && pubItems('unapproved_on_live').includes('POI-000205'),
  'неодобренный текст в живом маршруте ловится ровно один раз',
  pubItems('unapproved_on_live'))

/* Фикстура выше проверяет ПОВЕДЕНИЕ при заданном descriptionOverride, но не
   то, из какого поля Airtable он берётся, — а сломалось именно это. Рантайм-шва
   тут нет: имя поля живёт строкой в двух файлах. Поэтому связь закрепляется
   по исходникам, и утверждение сформулировано как инвариант: сторож обязан
   читать то же поле, что и рендер. */
const gateSource = readFileSync('scripts/check-poi-integrity.mjs', 'utf8')
const rendererSource = readFileSync('src/lib/airtable.ts', 'utf8')
const rendererField = /descriptionOverride: \(r\.fields\['([^']+)'\]/.exec(rendererSource)?.[1] ?? null

ok(rendererField !== null,
  'поле описания остановки в рендере найдено', 'изменился mapRouteStopRecord в src/lib/airtable.ts')
ok(rendererField === 'Stop Description Override Approved (RU)',
  'рендер по-прежнему читает одобренный override', `нашлось: ${rendererField}`)
ok(gateSource.includes(`'${rendererField}',`),
  'сторож запрашивает у Airtable то же поле, что рендерит сайт',
  `рендер читает «${rendererField}»; если это изменилось, поправьте список полей в loadLive`)
ok(new RegExp(`descriptionOverride: text\\(r\\.fields, '${rendererField.replace(/[()]/g, '\\$&')}'\\)`).test(gateSource),
  'сторож берёт descriptionOverride в первую очередь из поля рендера',
  'иначе «пустая карточка» снова будет определяться не по тому, что увидит гость')

// ── Политика координат ─────────────────────────────────────────────────────
/* Пустая политика у координатированных legacy-записей допустима на время
   миграции. Но пустая или неизвестная политика не оправдывает отсутствие
   координат. Единственное именованное исключение — notApplicable, и оно не
   маскирует половину координатной пары. */
const coordinatePolicy = run('tests/fixtures/poi-coordinate-policy')
const coordinatePolicyUnknown = itemsOf(coordinatePolicy, 'coords_policy_unknown').join(' ')
const coordinatePolicyMismatch = itemsOf(coordinatePolicy, 'coords_policy_mismatch').join(' ')
const coordinatePolicyHalf = itemsOf(coordinatePolicy, 'coords_half').join(' ')
const coordinatePolicyMissing = byCode(coordinatePolicy, 'coords_missing')[0]?.detail ?? ''

ok(itemsOf(coordinatePolicy, 'coords_policy_unknown').length === 1,
  'неизвестная политика координат даёт отдельный FAIL',
  coordinatePolicyUnknown || '(ничего)')
ok(coordinatePolicyUnknown.includes('POI-000902') && coordinatePolicyUnknown.includes('centroid'),
  'отказ называет запись и неизвестное значение политики',
  coordinatePolicyUnknown || '(ничего)')
ok(byCode(coordinatePolicy, 'coords_policy_unknown')[0]?.level === 'FAIL',
  'неизвестная политика отвергается fail-closed',
  byCode(coordinatePolicy, 'coords_policy_unknown')[0]?.level ?? '(находки нет)')
ok(coordinatePolicyMissing.includes('3 из 10'),
  'пустая и неизвестная политика не исключают записи из coords_missing',
  coordinatePolicyMissing || '(находки нет)')
ok(!coordinatePolicyMissing.includes('4 из 10'),
  'notApplicable исключает только законно бескоординатную запись',
  coordinatePolicyMissing || '(находки нет)')
ok(coordinatePolicyHalf.includes('POI-000904'),
  'notApplicable не маскирует половину координатной пары',
  coordinatePolicyHalf || '(ничего)')
ok(!coordinatePolicyUnknown.includes('POI-000905'),
  'пустая политика у координатированной legacy-записи допустима',
  coordinatePolicyUnknown || '(ничего)')
ok(!coordinatePolicyUnknown.includes('POI-000906') && !coordinatePolicyUnknown.includes('POI-000907'),
  'exactObjectPoint и representativePoint входят в закрытый список',
  coordinatePolicyUnknown || '(ничего)')
ok(itemsOf(coordinatePolicy, 'coords_policy_mismatch').length === 4,
  'каждое противоречие известной политики данным даёт отдельный FAIL',
  coordinatePolicyMismatch || '(ничего)')
ok(coordinatePolicyMismatch.includes('POI-000904')
  && coordinatePolicyMismatch.includes('POI-000908')
  && coordinatePolicyMismatch.includes('POI-000909')
  && coordinatePolicyMismatch.includes('POI-000910'),
  'пойманы notApplicable с точкой и обе точечные политики без полной пары',
  coordinatePolicyMismatch || '(ничего)')
ok(byCode(coordinatePolicy, 'coords_policy_mismatch')[0]?.level === 'FAIL',
  'противоречие политики данным отвергается fail-closed',
  byCode(coordinatePolicy, 'coords_policy_mismatch')[0]?.level ?? '(находки нет)')
ok(!coordinatePolicyMismatch.includes('POI-000903')
  && !coordinatePolicyMismatch.includes('POI-000906')
  && !coordinatePolicyMismatch.includes('POI-000907'),
  'три согласованных варианта политики проходят',
  coordinatePolicyMismatch || '(ничего)')
ok(gateSource.includes("'Coordinate Policy',"),
  'живой сторож запрашивает Coordinate Policy у Airtable',
  'поле отсутствует в списке loadLive')
ok(gateSource.includes("coordinatePolicy: text(r.fields, 'Coordinate Policy')"),
  'живой сторож передаёт Coordinate Policy в проверку координат',
  'поле запрошено, но не попало в модель POI')

// ── Схема таксономии v2 (10f-P, P04.3) ──────────────────────────────────────
/* Сторож читает ту же связь реестр↔схема, что и preflight writeRun. Три
   исхода: полей нет — предупреждение (L3 не выполнена, писатель сам стоит);
   дрейф — поломка; схемы в дампе нет — пропуск вслух. */
ok(byCode(report, 'taxonomy_schema_drift').length === 0 && byCode(report, 'taxonomy_schema_missing').length === 0
  && byCode(report, 'taxonomy_schema_unchecked').length === 0,
  'точная схема таксономии не даёт ни поломки, ни предупреждения, ни пропуска',
  report.findings.filter((f) => f.code.startsWith('taxonomy')).map((f) => f.code).join(' ') || '(нет)')
ok(byCode(noIds, 'taxonomy_schema_unchecked').length === 1,
  'дамп без schema.json — проверка схемы пропущена вслух')
const drift = run('tests/fixtures/poi-integrity-taxonomy-drift')
ok(byCode(drift, 'taxonomy_schema_drift').length === 1 && byCode(drift, 'taxonomy_schema_drift')[0].level === 'FAIL',
  'дрейф опций — ПОЛОМКА', JSON.stringify(byCode(drift, 'taxonomy_schema_drift')))
ok(itemsOf(drift, 'taxonomy_schema_drift').join(' ') === 'POI Type: нет опций: market',
  'дрейф назван полем и кодом', itemsOf(drift, 'taxonomy_schema_drift').join(' '))
ok(byCode(drift, 'taxonomy_schema_missing').length === 1 && byCode(drift, 'taxonomy_schema_missing')[0].level === 'WARN',
  'отсутствующее поле — предупреждение, не поломка')
ok(itemsOf(drift, 'taxonomy_schema_missing').join(' ') === 'Taxonomy Version',
  'отсутствующее поле названо', itemsOf(drift, 'taxonomy_schema_missing').join(' '))
ok(gateSource.includes("from '../src/lib/poi-taxonomy-airtable.ts'"),
  'сторож читает связь реестр↔схема из того же модуля, что и писатель')
ok(gateSource.includes('/v0/meta/bases/${BASE_ID}/tables'),
  'живой сторож читает схему через Meta API')

// ── Итог ─────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n❌ Провалено ${failures.length} из ${failures.length + passed}:\n`)
  failures.forEach((f) => console.error('  • ' + f))
  process.exit(1)
}
console.log(`✓ целостность POI: ${passed} проверок пройдено`)
