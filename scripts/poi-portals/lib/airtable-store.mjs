/**
 * PoiStore поверх Airtable для .mjs-скриптов.
 *
 * Почему отдельный файл, а не импорт из src/lib/poi-intake.ts: там store
 * завязан на `@/lib/airtable-retry` и `@/lib/airtable-schema`, а алиас `@/`
 * резолвится только внутри Next. Обычный Node его не понимает.
 *
 * РЕШЕНИЯ здесь нет ни одного. Дубли, канон, что писать в поля — всё это
 * в src/lib/poi-ingest.ts, единственной точке приёма. Этот файл умеет
 * только читать таблицу, выдавать следующий номер и создавать запись.
 */

import { toPoiLike } from '../../../src/lib/poi-matching.ts'

const POI_TABLE = 'POI'

/** Поля снимка: ровно то, что нужно гейту, и ничего лишнего. */
const SNAPSHOT_FIELDS = [
  'POI ID', 'POI Name (RU)', 'POI Name (EN)', 'Site City', 'Source Key',
  'Latitude', 'Longitude',
  // Читается ради паритета со снимком из файла и с store в src/lib: гейт
  // «один place_id — один POI» сравнивает входящий идентификатор с полем
  // существующих записей, и без него ось молча не работала бы на живой базе
  // так же, как она не работает на снимке. Портальный путь эту ось пока не
  // исполняет — он не наполняет request.poi.resolved.
  'Google Place ID',
]

const CATEGORY_RU_TO_EN = {
  'Синтоистское святилище': 'Shinto Shrine',
  'Буддийский храм': 'Buddhist Temple',
  'Архитектурный объект': 'Architectural Object',
  Музей: 'Museum',
  'Арт-пространство / Галерея': 'Art Venue',
  'Смотровая площадка': 'Viewing Spot',
  'Ландшафтный сад / Парк': 'Park/Garden',
  Достопримечательность: 'City Attraction',
  'Историческое место': 'Historical Location',
  Ресторан: 'Restaurant',
  'Японский отель': 'Ryokan',
  'Парк развлечений': 'Amusement Park',
  Шоппинг: 'Shopping',
  'Термальный Источник': 'Hot Spring',
  СПА: 'SPA',
  'Городской район': 'City District',
  'Транспортный узел': 'Transit Hub',
}

const text = (fields, key) => (typeof fields[key] === 'string' ? fields[key] : '')

/**
 * @param options.token   AIRTABLE_TOKEN
 * @param options.baseId  AIRTABLE_BASE_ID
 * @param options.dryRun  не создавать записи, только считать номера
 */
export function createAirtablePoiStore({ token, baseId, dryRun = false }) {
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN и AIRTABLE_BASE_ID обязательны для записи POI')
  }
  const endpoint = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(POI_TABLE)}`
  const auth = { Authorization: `Bearer ${token}` }
  let cache = null

  async function fetchAll(fields, filterByFormula) {
    const out = []
    let offset
    do {
      const url = new URL(endpoint)
      url.searchParams.set('pageSize', '100')
      for (const f of fields) url.searchParams.append('fields[]', f)
      if (filterByFormula) url.searchParams.set('filterByFormula', filterByFormula)
      if (offset) url.searchParams.set('offset', offset)
      const res = await fetch(url, { headers: auth, cache: 'no-store' })
      if (!res.ok) throw new Error(`Airtable POI read: ${res.status} ${await res.text()}`)
      const data = await res.json()
      out.push(...(data.records ?? []))
      offset = data.offset
      // Airtable держит лимит в 5 запросов в секунду на базу. Пакетный
      // прогон читает несколько страниц подряд и упирается в него первым.
      if (offset) await new Promise((r) => setTimeout(r, 220))
    } while (offset)
    return out
  }

  function nextPoiId(records) {
    let max = 0
    for (const record of records) {
      const m = text(record.fields, 'POI ID').match(/^POI-(\d{6})$/)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return `POI-${String(max + 1).padStart(6, '0')}`
  }

  // Выдача номера и запись — одна неделимая операция. Иначе два приёма
  // подряд успевают оба прочитать «максимум» до того, как первый записался.
  let queue = Promise.resolve()
  const serialize = (task) => {
    const run = queue.then(task, task)
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  return {
    async listExisting() {
      if (!cache) cache = await fetchAll(SNAPSHOT_FIELDS)
      return cache.map(toPoiLike)
    },
    async findBySourceKey(sourceKey) {
      if (!cache) await this.listExisting()
      const hit = cache.find((r) => text(r.fields, 'Source Key') === sourceKey)
      return hit ? toPoiLike(hit) : null
    },
    async create(fields) {
      return serialize(async () => {
        if (!cache) cache = await fetchAll(SNAPSHOT_FIELDS)
        const poiId = nextPoiId(cache)

        if (dryRun) {
          cache.push({ id: `dry-${poiId}`, fields: { ...fields, 'POI ID': poiId } })
          return { poiId, recordId: `dry-${poiId}` }
        }

        const categoriesRu = Array.isArray(fields['POI Category (RU)']) ? fields['POI Category (RU)'] : []
        const categoriesEn = categoriesRu.map((c) => CATEGORY_RU_TO_EN[c]).filter(Boolean)
        const payload = {
          'POI ID': poiId,
          ...fields,
          'POI Category (EN)': categoriesEn.length ? categoriesEn : undefined,
          'Last Seeded At': new Date().toISOString(),
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: [{ fields: payload }] }),
        })
        if (!res.ok) throw new Error(`Airtable POI create: ${res.status} ${await res.text()}`)
        const recordId = (await res.json()).records?.[0]?.id
        if (!recordId) throw new Error('Airtable вернул создание без id записи')

        // Коллизия между процессами: бот мог занять этот номер, пока шла
        // запись. Обнаружить можно только постфактум — уникальных
        // ограничений в Airtable нет.
        const clash = await fetchAll(['POI ID'], `{POI ID}='${poiId.replace(/'/g, "\\'")}'`)
        if (clash.length > 1) {
          cache = await fetchAll(SNAPSHOT_FIELDS)
          // Занятые номера подмешиваются в расчёт явно. Полагаться на то,
          // что перечитанный снимок уже содержит чужую запись, нельзя:
          // Airtable отдаёт список с задержкой, и тогда «свободный» номер
          // окажется тем же самым, PATCH станет пустой операцией, а
          // коллизия останется — молча.
          const fresh = nextPoiId(cache.concat(clash))
          await fetch(`${endpoint}/${recordId}`, {
            method: 'PATCH',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { 'POI ID': fresh } }),
          })
          console.warn(`[poi-store] коллизия ${poiId}, запись ${recordId} переименована в ${fresh}`)
          cache.push({ id: recordId, fields: { ...fields, 'POI ID': fresh } })
          return { poiId: fresh, recordId }
        }

        cache.push({ id: recordId, fields: { ...fields, 'POI ID': poiId } })
        await new Promise((r) => setTimeout(r, 220))
        return { poiId, recordId }
      })
    },
  }
}
