/**
 * Контракт файла --names для коллектора порталов.
 *
 * Зачем. 11.08.2026 в --names уехал tests/fixtures/poi-names.json — список
 * уже существующих POI вида {id, ru, en}, а не карта sourceKey → имя. Файл
 * принялся молча, ноль ключей совпало, все 130 кандидатов ушли в очередь
 * «имя не собралось», и прогон выглядел так, будто у портала нет имён.
 * Тихо принятый неверный файл хуже отсутствующего: он подменяет причину.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertNameCoverage, describeNameCoverage, loadNames } from '../scripts/poi-portals/lib/names-file.mjs'
import { writeRun } from '../scripts/poi-portals/collect-pois.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}

const dir = await mkdtemp(path.join(tmpdir(), 'names-'))
let n = 0
const withFile = async (body) => {
  const file = path.join(dir, `f${n++}.json`)
  await writeFile(file, typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
  return file
}
const boom2 = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }
const failure = async (body) => {
  try { await loadNames(await withFile(body)); return '(без ошибки)' } catch (e) { return e.message }
}

// ── Отклоняется всё, что не карта имён ──────────────────────────────────
t('массив отклонён', /ожидается объект/.test(await failure([{ id: 'POI-1', ru: 'Тест' }])), true)
t('и сказано, что получен массив', /получен массив/.test(await failure([])), true)
t('пустой объект отклонён', /файл пуст/.test(await failure({})), true)
t('строка вместо имён отклонена', /не объект с именами/.test(await failure({ 'p:1': 'строка' })), true)
t('null вместо имён отклонён', /не объект с именами/.test(await failure({ 'p:1': null })), true)
t('битый JSON отклонён', /--names/.test(await failure('{не json')), true)

/* Именно этот случай прошёл молча: ключи чужие, поля чужие. Проверка
   верхнего уровня его не ловила — объект и значения-объекты налицо. */
t('чужие поля отклонены', /неизвестные поля/.test(await failure({ 'wrong-key': { id: 'x' } })), true)
t('и они перечислены', /«id»/.test(await failure({ 'wrong-key': { id: 'x' } })), true)
t('нестроковое имя отклонено', /не строка/.test(await failure({ 'p:1': { nameRu: 5 } })), true)

// ── Правильный файл принимается со статистикой ──────────────────────────
const good = await loadNames(await withFile({
  'bodik-osaka-tourism:OSAKA0000047': { nameRu: 'Музей Фудзита', nameEn: 'Fujita Museum' },
  'bodik-osaka-tourism:OSAKA0000048': { nameEn: 'Nakanoshima Museum' },
  'bodik-osaka-tourism:OSAKA0000049': { nameRu: 'Дотонбори', siteCity: 'osaka' },
}))
t('имена прочитаны', Object.keys(good.names).length, 3)
t('всего записей', good.stats.entries, 3)
t('из них с русским именем', good.stats.withNameRu, 2)
t('файл назван в статистике', typeof good.stats.file, 'string')

t('без файла статистики нет', (await loadNames(null)).stats, null)
t('и имён тоже', Object.keys((await loadNames(undefined)).names).length, 0)


// ── Пустая запись пользы не приносит ────────────────────────────────────
/* Значение {} или {nameRu: " "} формально проходило контракт. Совпав
   с кандидатом, оно подняло бы matched выше нуля и выключило защиту от
   файла не того портала. */
t('пустая запись отклонена', /нет ни одного непустого/.test(await failure({ 'p:1': {} })), true)
t('запись из пробелов отклонена', /нет ни одного непустого/.test(await failure({ 'p:1': { nameRu: '   ' } })), true)
t('запись только с siteCity проходит контракт файла',
  Object.keys((await loadNames(await withFile({ 'p:1': { siteCity: 'osaka' } }))).names).length, 1)

// ── Покрытие ────────────────────────────────────────────────────────────
const stats = { file: 'f.json', entries: 3, withNameRu: 1 }
const cov = describeNameCoverage(stats, new Set(['a', 'b']), { a: { nameRu: 'Имя' }, b: { siteCity: 'osaka' } })
t('совпавших ключей', cov.matched, 2)
t('неиспользованных', cov.unused, 1)
t('из совпавших принесли имя', cov.matchedWithName, 1)
t('английское имя тоже считается именем',
  describeNameCoverage(stats, new Set(['a']), { a: { nameEn: 'Name' } }).matchedWithName, 1)

const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }
t('ноль совпадений — ошибка',
  /ни один из 3 ключей не совпал/.test(boom(() => assertNameCoverage({ ...stats, matched: 0, unused: 3, matchedWithName: 0 }))), true)
t('совпало, но без имён — тоже ошибка',
  /ни один не принёс имени/.test(boom(() => assertNameCoverage({ ...stats, matched: 2, unused: 1, matchedWithName: 0 }))), true)
t('нормальное покрытие ошибки не даёт',
  boom(() => assertNameCoverage({ ...stats, matched: 2, unused: 1, matchedWithName: 1 })), '(без ошибки)')
t('без файла проверять нечего', boom(() => assertNameCoverage(null)), '(без ошибки)')

// ── Порядок: покрытие проверяется ДО записи ─────────────────────────────
/* Обе ветки раньше обходили проверку: при нуле собранных имён writeRun
   возвращался раньше неё, а при части собранных запись успевала пройти. */
const portalWith = (rows) => ({ portals: [{ portalId: 'bodik-osaka-tourism', source: { url: 'https://x' }, writable: rows }] })
const named = await withFile({ 'other-portal:1': { nameRu: 'Чужой' } })

const noNames = await boom2(() => writeRun(portalWith([
  { sourceKey: 'bodik-osaka-tourism:1', nameJa: '大阪城', nameKana: null, nameEn: '', siteCity: 'osaka' },
]), { names: named }))
t('ноль собранных имён не прячет неверный файл', /ни один из 1 ключей не совпал/.test(noNames), true)

const machineNamed = await boom2(() => writeRun(portalWith([
  { sourceKey: 'bodik-osaka-tourism:2', nameJa: '大阪城', nameKana: 'オオサカジョウ', nameEn: '', siteCity: 'osaka' },
]), { names: named }))
t('машинное имя не даёт дойти до store', /ни один из 1 ключей не совпал/.test(machineNamed), true)
t('и до сети дело не дошло', /AIRTABLE|fetch|ENOTFOUND/.test(machineNamed), false)

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ файл имён: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
