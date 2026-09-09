/**
 * ОБЩИЕ ФИКСТУРЫ КОНВЕЙЕРА JAPAN GUIDE — ОДИН ИСТОЧНИК НА ДВА НАБОРА.
 *
 * Ими пользуются `tests/poi-japan-guide-dry-run.mjs` (JA-6/JA-7) и
 * `tests/poi-canary-japan-guide-intake.mjs` (приём в память). Отдельный модуль
 * заведён не ради краткости: пока сборка отчётов жила в каждом наборе своя,
 * canary мог незаметно проверять конвейер другой формы, чем тот, который
 * приняли, — и зелёный результат ничего бы не значил.
 *
 * Данных Japan Guide здесь нет. Имена — настоящие названия настоящих объектов,
 * которые распознают правила классификации; всё остальное собрано этими
 * функциями. Выгрузку портала в репозиторий класть нельзя, и она тут не нужна:
 * предмет проверки — путь, а не корпус.
 *
 * Отчёты подписываются ТОЙ ЖЕ формулой, что у своих контрактов, а опознанное
 * место собирается НАСТОЯЩЕЙ проекцией `storablePlace`: фикстура, собранная
 * руками, доказывала бы исправность фикстуры.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { canonicalJsonBytes } from '../../scripts/lib/canonical-contract.mjs'
import { sha256Bytes } from '../../scripts/lib/byte-digest.mjs'
import { AIRTABLE_EXPORT_SPEC } from '../../scripts/poi-portals/lib/discovery-airtable-match.mjs'
import { storablePlace } from '../../scripts/poi-portals/lib/place-identification.mjs'
import { loadNames } from '../../scripts/poi-portals/lib/names-file.mjs'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '../../src/lib/airtable-schema.ts'
import { canonicalPrefecture } from '../../src/lib/prefectures.ts'

export const NOW = '2026-09-09T10:00:00.000Z'
export const TODAY = NOW.slice(0, 10)

/** Подпись отчёта — формулой его собственного контракта. */
export const sign = (raw, spec) => {
  const body = { ...raw }
  delete body.reportDigest
  return { ...body, reportDigest: sha256Bytes(canonicalJsonBytes({ ...body, createdAt: null }, spec)) }
}

/** Байтовый отпечаток отчёта — тот же способ, что у писателя и CLI. */
export const fileDigestOf = (report) => sha256Bytes(Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8'))

export const fact = (field, value, place = 0) => ({
  field, value, place, sourceUrl: 'https://site.jp/', observedAt: NOW,
  locator: 'jsonld:Place', confidence: 'unverified', verifiedAt: null,
})

export const queueRow = (key, nameEn) => ({
  sourceKey: key, nameEn, url: `https://www.japan-guide.com/e/${key.split(':')[1]}.html`,
})

export const queuesOf = (rows) => sign({
  spec: 'poi-japan-guide-queues/v1', createdAt: NOW,
  counts: { candidate: rows.length },
  queues: { candidate: rows, review: [] },
}, 'poi-japan-guide-queues/v1')

export const enrichmentOf = (rows, extra = {}) => sign({
  spec: 'poi-enrichment/v1', createdAt: NOW, rows, ...extra,
}, 'poi-enrichment/v1')

export const identificationOf = (rows, extra = {}) => sign({
  spec: 'poi-place-identification/v1', createdAt: NOW, rows, ...extra,
}, 'poi-place-identification/v1')

export const enrichedRow = (key, nameEn, facts, outcome = 'enriched') => ({
  sourceKey: key, nameEn, sourceUrl: `https://www.japan-guide.com/e/${key.split(':')[1]}.html`,
  outcome, detail: 'фикстура', review: false, facts, omissions: [], conflicts: [], hint: 'https://site.jp/',
})

/**
 * Строка опознания. Место собирает НАСТОЯЩАЯ `storablePlace`: срок годности
 * координат, состав разрешённого к хранению и отсутствие имён Google — её
 * предмет, и подменять её здесь значило бы проверять свою копию правила.
 */
export const identifiedRow = (key, { placeId, lat, lon, prefecture = 'Kyoto', observedOn = TODAY, businessStatus = 'OPERATIONAL' }) => ({
  sourceKey: key,
  outcome: 'resolved',
  detail: 'исход резолвера: resolved',
  place: storablePlace({ placeId, businessStatus, prefecture: canonicalPrefecture(prefecture), lat, lon }, observedOn),
  alternatives: [],
  review: false,
  called: true,
  calledAt: NOW,
})

export const exportBytesOf = (records) => Buffer.from(JSON.stringify({
  contractVersion: AIRTABLE_EXPORT_SPEC, note: 'фикстура', baseId: AIRTABLE_BASE_ID, tableId: POI_TABLE_ID,
  fetchedAt: '2026-09-06', fields: ['isSystem', 'nameEn', 'nameRu', 'poiId', 'sourceKey', 'website'],
  totalRecordCount: records.length, records,
}), 'utf8')

/**
 * Настоящие японские названия: правила классификации их распознают, и кандидат
 * проходит НАСТОЯЩУЮ оценку. Подставлять сюда «寺1» значило бы проверять путь
 * на строке, которую реестр не разбирает, и получить отказ не по делу.
 */
export const NAMES = ['清水寺', '大原美術館', '伏見稲荷大社', '姫路城', '東大寺', '金閣寺', '銀閣寺', '厳島神社']

/** Русские имена тех же объектов — как их назвал бы владелец в файле имён. */
export const NAMES_RU = ['Киёмидзу-дэра', 'Музей Охара', 'Фусими Инари', 'Замок Химэдзи', 'Тодай-дзи', 'Кинкаку-дзи', 'Гинкаку-дзи', 'Ицукусима']

export const GOOD_NAMED = (i) => [
  fact('nameJa', NAMES[i % NAMES.length]),
  fact('address', `京都府京都市${i}`),
  fact('lat', `34.${900 + i}`),
  fact('lon', `135.${700 + i}`),
]

/**
 * Файл проверенных имён владельца — НАСТОЯЩИМ загрузчиком и через настоящий
 * файл: контракт файла имён (`names-file.mjs`) проверяет состав полей и
 * подписывает байты, и обходить его в фикстуре нельзя.
 */
export async function ownerNames(map) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jg-names-'))
  const file = path.join(dir, 'names.json')
  await writeFile(file, JSON.stringify(map, null, 2), 'utf8')
  return loadNames(file)
}
