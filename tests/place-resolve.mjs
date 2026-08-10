/**
 * Опознание места: проверки гейта на подставном Google.
 *
 * Сеть тут не нужна и вредна: тест обязан падать от логики, а не от того,
 * что Google сегодня переименовал объект.
 */
import { resolvePlace, namesAgree } from '../src/lib/place-resolve.ts'
import { canonicalPrefecture, PREFECTURES } from '../src/lib/prefectures.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  actual === expected ? ok++ : bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}

// ── Префектуры ──────────────────────────────────────────────────────────
t('всех сорок семь', PREFECTURES.length, 47)
t('английское имя', canonicalPrefecture('Kyoto')?.ru, 'Киото')
// Ровно тот случай, из-за которого таблица и заведена: Google при
// languageCode=en иногда отдаёт японское название, и шесть записей
// уехали с «京都府» в английском поле.
t('японское имя приводится к паре', canonicalPrefecture('京都府')?.en, 'Kyoto')
t('с суффиксом Prefecture', canonicalPrefecture('Tokyo Prefecture')?.ru, 'Токио')
t('несуществующая отвергается', canonicalPrefecture('Мордор'), null)
t('пустая отвергается', canonicalPrefecture(''), null)

// ── Сверка имён ─────────────────────────────────────────────────────────
t('одно и то же', namesAgree('Fushimi Inari Shrine', 'Fushimi Inari Taisha Shrine'), true)
t('разные места', namesAgree('Numa-no-Daira Plateau', 'Daisetsuzan National Park'), false)
t('короткое не сходится', namesAgree('Mt', 'Mount Fuji'), false)

// ── Гейт ────────────────────────────────────────────────────────────────
const google = (places) => async () => ({ ok: true, json: async () => ({ places }) })
const place = (id, name, lat, lon, pref, status = 'OPERATIONAL') => ({
  id, displayName: { text: name }, location: { latitude: lat, longitude: lon },
  businessStatus: status,
  addressComponents: pref ? [{ types: ['administrative_area_level_1'], longText: pref }] : [],
})
const run = (places, input = {}) =>
  resolvePlace({ nameEn: 'Fushimi Inari Shrine', siteCity: 'kyoto', ...input },
    { apiKey: 'k', fetchImpl: google(places) })

const good = await run([place('PID1', 'Fushimi Inari Taisha', 34.967, 135.772, 'Kyoto')])
t('совпадение принимается', good.place?.placeId, 'PID1')
t('префектура приводится', good.place?.prefecture?.ru, 'Киото')

// Имя проверяется ВСЕГДА. Без этого «тот же регион, недалеко» пропускал
// совершенно другой объект — так «Numa-no-Daira Plateau» однажды принял
// «Daisetsuzan National Park».
const wrongName = await run([place('PID2', 'Daisetsuzan National Park', 34.97, 135.77, 'Kyoto')])
t('чужое имя отвергается', wrongName.place, null)

const abroad = await run([place('PID3', 'Fushimi Inari Shrine', 48.85, 2.35, null)])
t('вне Японии отвергается', abroad.place, null)

const wrongPref = await run([place('PID4', 'Fushimi Inari Shrine', 34.7, 135.5, 'Osaka')], { prefectureEn: 'Kyoto' })
t('чужая префектура отвергается', wrongPref.place, null)

// Первый кандидат негоден, второй годен — берём второй, а не сдаёмся.
const second = await run([
  place('BAD', 'Some Ramen Shop', 34.9, 135.7, 'Kyoto'),
  place('GOOD', 'Fushimi Inari Shrine', 34.967, 135.772, 'Kyoto'),
])
t('перебирает кандидатов', second.place?.placeId, 'GOOD')

const empty = await run([])
t('пустой ответ — не падение', empty.place, null)
t('и с причиной', empty.reason.length > 0, true)

const noName = await resolvePlace({ nameEn: '' }, { apiKey: 'k', fetchImpl: google([]) })
t('без имени искать нечем', noName.place, null)

const failing = await resolvePlace({ nameEn: 'X Temple' },
  { apiKey: 'k', fetchImpl: async () => { throw new Error('сеть легла') } })
t('падение сети не роняет приём', failing.place, null)

t('статус доезжает', good.place?.businessStatus, 'OPERATIONAL')

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ опознание места: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
