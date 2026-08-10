/**
 * Путь приёма из Telegram: разбор ответа исследователя.
 *
 * До 10.08.2026 тестов тут не было вовсе — модуль импортировал '@/lib/...',
 * а прогон идёт голым node без резолвера алиасов, и файл просто не грузился.
 * Отсутствие тестов было не решением, а следствием одной строки импорта.
 */
import { parseResearchJson, findParentCandidate, POI_CATEGORIES_RU } from '../src/lib/poi-intake.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  actual === expected ? ok++ : bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const j = (o) => JSON.stringify(o)

// ── Статус работы: асимметричное правило ────────────────────────────────
//
// Закрытие и сезонность модель ЧИТАЕТ — с таблички, из новости, с сайта.
// «Работает» же нигде не написано: это вывод из того, что обратного не
// нашлось, и модель делает его охотно. Единственный статус, проходящий
// без замечаний, обязан приходить из проверяемого источника — от Google.
t('закрытие принимается', parseResearchJson(j({nameRu:'Т', operatingStatus:'Закрыт навсегда'})).operatingStatus, 'Закрыт навсегда')
t('сезонность принимается', parseResearchJson(j({nameRu:'Т', operatingStatus:'Сезонный'})).operatingStatus, 'Сезонный')
t('«Работает» подрезается', parseResearchJson(j({nameRu:'Т', operatingStatus:'Работает'})).operatingStatus, '')
t('«Не проверено» тоже подрезается', parseResearchJson(j({nameRu:'Т', operatingStatus:'Не проверено'})).operatingStatus, '')
t('мусор подрезается', parseResearchJson(j({nameRu:'Т', operatingStatus:'открыто вроде'})).operatingStatus, '')
t('пусто остаётся пустым', parseResearchJson(j({nameRu:'Т'})).operatingStatus, '')
t('регистр не мешает', parseResearchJson(j({nameRu:'Т', operatingStatus:'закрыт временно'})).operatingStatus, 'Закрыт временно')

// ── Разбор ответа ───────────────────────────────────────────────────────
t('имя обязательно', (() => { try { parseResearchJson(j({nameRu:''})); return 'без ошибки' } catch { return 'ошибка' } })(), 'ошибка')
t('markdown-обёртка снимается', parseResearchJson('```json\n{"nameRu":"Храм"}\n```').nameRu, 'Храм')
t('город в нижний регистр', parseResearchJson(j({nameRu:'Т', siteCity:'Kyoto'})).siteCity, 'kyoto')
t('категорий не больше трёх', parseResearchJson(j({nameRu:'Т', categoriesRu:['Музей','СПА','Шоппинг','Ресторан']})).categoriesRu.length, 3)
t('otherLocations без имён отбрасываются', parseResearchJson(j({nameRu:'Т', otherLocations:[{nameRu:'',nameEn:'',siteCity:'x'},{nameRu:'Есть',nameEn:'',siteCity:'y'}]})).otherLocations.length, 1)

// ── Категории берутся из канона, а не из копии ──────────────────────────
//
// Своя копия списка тут была и разошлась с каноном в день, когда в него
// добавили «Знаковый вид»: applyCanon категорию принимал, а бот о ней
// не знал и предложить не мог.
t('канон категорий один', POI_CATEGORIES_RU.includes('Знаковый вид'), true)

// ── Родитель линкуется только при уверенном совпадении ──────────────────
//
// Требование строже, чем у дедупликации: заглушки-родители раньше
// создавались в обход проверок и были основным источником дублей.
const rec = (id, ru, en, city) => ({ id, fields: { 'POI ID': id, 'POI Name (RU)': ru, 'POI Name (EN)': en, 'Site City': city } })
const pool = [
  rec('POI-000001', 'Святилище Фусими Инари', 'Fushimi Inari Shrine', 'kyoto'),
  rec('POI-000002', 'Храм Киёмидзудэра', 'Kiyomizudera Temple', 'kyoto'),
]
const parent = (ru, en, city) => findParentCandidate({ parentNameRu: ru, parentNameEn: en, siteCity: city }, pool)
t('точное имя находит родителя', parent('Святилище Фусими Инари', '', 'kyoto')?.hint?.poiId ?? 'нет', 'POI-000001')
t('чужое имя родителя не даёт', parent('Замок Химэдзи', '', 'himeji')?.hint?.poiId ?? 'нет', 'нет')
t('пустое имя родителя не даёт', parent('', '', 'kyoto')?.hint?.poiId ?? 'нет', 'нет')
t('английское имя тоже находит', parent('', 'Fushimi Inari Shrine', 'kyoto')?.hint?.poiId ?? 'нет', 'POI-000001')

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ приём POI: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
