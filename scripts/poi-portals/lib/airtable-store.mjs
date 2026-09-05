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
import { verifyTaxonomySchemaTables } from '../../../src/lib/poi-taxonomy-airtable.ts'
import { POI_TABLE_ID } from '../../../src/lib/airtable-schema.ts'

/**
 * Таблица адресуется КАНОНИЧЕСКИМ ID (10f-P R1, находка 3): имя таблицы
 * изменяемо, и Meta-ответ, где под именем «POI» стоит чужая таблица, не
 * должен приниматься за целевую. Сверку имени и полей делает writer
 * (`verifyTaxonomySchemaTables`), хранилище отдаёт сырую схему.
 */
export { POI_TABLE_ID }
/** Meta API: живая схема базы. Требует у токена scope `schema.bases:read`. */
export const AIRTABLE_META_TABLES_PATH = '/v0/meta/bases/{baseId}/tables'

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
 * @param options.fetchImpl  подмена fetch для тестов; production не задаёт
 */
export function createAirtablePoiStore({ token, baseId, dryRun = false, fetchImpl = globalThis.fetch }) {
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN и AIRTABLE_BASE_ID обязательны для записи POI')
  }
  const fetch = fetchImpl
  const endpoint = `https://api.airtable.com/v0/${baseId}/${POI_TABLE_ID}`
  const metaEndpoint = `https://api.airtable.com${AIRTABLE_META_TABLES_PATH.replace('{baseId}', baseId)}`
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
    /**
     * Сырая живая схема базы (Meta API). Чтение, не запись. Решает не
     * хранилище, а writer: `verifyTaxonomySchemaTables` в связи реестр↔схема.
     * Отказ HTTP — исключение с кодом: без схемы запись остановлена, и токену
     * нужен scope schema.bases:read.
     */
    async readSchemaTables() {
      const res = await fetch(metaEndpoint, { headers: auth, cache: 'no-store' })
      if (!res.ok) {
        throw new Error(
          `Airtable schema read: ${res.status} ${await res.text()}. `
          + 'Схема таксономии не проверена — запись остановлена. Токену нужен scope schema.bases:read.',
        )
      }
      const data = await res.json()
      return Array.isArray(data?.tables) ? data.tables : []
    },
    /** Удобство для сторожей: та же проверка, что делает writer. */
    async assertTaxonomySchema() {
      return verifyTaxonomySchemaTables(await this.readSchemaTables())
    },
    async listExisting() {
      if (!cache) cache = await fetchAll(SNAPSHOT_FIELDS)
      return cache.map(toPoiLike)
    },
    async findBySourceKey(sourceKey) {
      if (!cache) await this.listExisting()
      const hit = cache.find((r) => text(r.fields, 'Source Key') === sourceKey)
      return hit ? toPoiLike(hit) : null
    },
    /**
     * НЕЗАВИСИМОЕ ЧТЕНИЕ ПО КЛЮЧУ ИСТОЧНИКА — мимо кэша (10f-R, P09.3).
     *
     * `findBySourceKey` отвечает из `cache`, а кэш наполняет тот же writer,
     * чей эффект проверяется: он положил туда запись сразу после POST, и
     * поиск подтверждал бы writer'а им самим. Здесь — свой запрос к базе,
     * кэш не читается и не обновляется.
     *
     * Возвращает МАССИВ: «ноль», «одна» и «больше одной» — три разных
     * исхода, и схлопывать их в «нашлось / не нашлось» нельзя.
     */
    async readFreshBySourceKey(sourceKey, fieldNames = []) {
      const escaped = String(sourceKey).replace(/'/g, "\\'")
      /* Запрашиваются и поля снимка, и те, что назвал вызывающий: сверка
         содержания (10f-R R1) сравнивает КАЖДОЕ обещанное поле, а не только
         проекцию снимка. Сырые поля отдаются как есть — без нормализации. */
      const wanted = [...new Set([...SNAPSHOT_FIELDS, ...fieldNames.filter((f) => typeof f === 'string' && f)])]
      const rows = await fetchAll(wanted, `{Source Key}='${escaped}'`)
      return rows.map((row) => ({ ...toPoiLike(row), recordId: row.id, fields: row.fields ?? {} }))
    },
    /**
     * НЕЗАВИСИМОЕ ЧТЕНИЕ ПО НОМЕРУ — постинвариант уникальности `POI ID`
     * (10f-R R3, находка аудита 1). Внутренняя проверка уникальности после
     * POST — обязательное постусловие writer'а; если она отказала, инвариант
     * «номер занят ровно одной записью» не установлен, и совпадение полей
     * созданной строки его не заменяет. Граница записи устанавливает его сама,
     * своим чтением мимо кэша. Возвращает ВСЕ записи с этим номером.
     */
    async readFreshByPoiId(poiId) {
      const escaped = String(poiId).replace(/'/g, "\\'")
      const rows = await fetchAll(['POI ID', 'Source Key'], `{POI ID}='${escaped}'`)
      return rows.map((row) => ({ recordId: row.id, poiId: text(row.fields, 'POI ID') || null, fields: row.fields ?? {} }))
    },
    /**
     * @param options.onEffect  наблюдатель ЭФФЕКТОВ (10f-R R2): вызывается и
     *   ДОЖИДАЕТСЯ перед КАЖДЫМ сетевым вызовом с эффектом — с точной
     *   полезной нагрузкой, которая уйдёт в базу (`{ step: 'create', payload }`
     *   перед POST, `{ step: 'rename', recordId, from, payload }` перед PATCH;
     *   `payload` — ровно тело запроса). Имена полей называет только
     *   хранилище: граница записи их не строит, а берёт из объявления. Так граница записи узнаёт
     *   полный ожидаемый итог, включая поля, которые добавляет само хранилище
     *   (`POI ID`, `POI Category (EN)`, `Last Seeded At`), и номер, в который
     *   запись переименовывается при коллизии. Без наблюдателя хранилище
     *   работает как прежде; за границей записи наблюдатель обязателен, и
     *   отказ наблюдателя отменяет эффект — он ещё не начат.
     */
    async create(fields, { onEffect = null } = {}) {
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

        /* НАМЕРЕНИЕ — ДО ЭФФЕКТА, с той самой нагрузкой, что уйдёт в POST. */
        if (onEffect) await onEffect({ step: 'create', payload: JSON.parse(JSON.stringify(payload)) })
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
          /* Переименование — второй эффект, и у него своё намерение ДО PATCH:
             ожидаемый итог записи теперь — НОВЫЙ номер, и граница обязана
             это знать раньше, чем PATCH мог отказать (10f-R R2). */
          const renamePayload = { 'POI ID': fresh }
          if (onEffect) await onEffect({ step: 'rename', recordId, from: poiId, payload: { ...renamePayload } })
          /* Исход PATCH проверяется (10f-R). Прежде ответ не читался вовсе:
             отказ переименования проходил молча, и запись оставалась с
             занятым номером — эффект внутри создания, потерянный без следа. */
          const renamed = await fetch(`${endpoint}/${recordId}`, {
            method: 'PATCH',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: renamePayload }),
          })
          if (!renamed.ok) {
            throw new Error(
              `Airtable POI rename: ${renamed.status} ${await renamed.text()}. `
              + `Запись ${recordId} создана с номером ${poiId}, который уже занят, и переименование не удалось.`,
            )
          }
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
