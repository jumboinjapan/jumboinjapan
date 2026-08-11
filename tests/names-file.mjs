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
import { loadNames } from '../scripts/poi-portals/lib/names-file.mjs'

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

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ файл имён: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
