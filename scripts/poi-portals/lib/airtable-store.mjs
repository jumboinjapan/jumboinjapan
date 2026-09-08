/**
 * PoiStore поверх Airtable для .mjs-скриптов.
 *
 * Почему отдельный файл, а не импорт из src/lib/poi-intake.ts: там store
 * завязан на `@/lib/airtable-retry` и `@/lib/airtable-schema`, а алиас `@/`
 * резолвится только внутри Next. Обычный Node его не понимает.
 *
 * РЕШЕНИЯ здесь нет ни одного. Дубли, канон, что писать в поля — всё это
 * в src/lib/poi-ingest.ts, единственной точке приёма. Этот файл умеет
 * только читать таблицу, выдавать следующий номер, создавать запись и —
 * с 10h-B — обновлять названные поля существующей записи по её id.
 */

import { toPoiLike } from '../../../src/lib/poi-matching.ts'
import { verifyTaxonomySchemaTables } from '../../../src/lib/poi-taxonomy-airtable.ts'
import { POI_TABLE_ID } from '../../../src/lib/airtable-schema.ts'
import { EXCHANGE_DEADLINE_MS, fetchJsonResponse } from './network-boundary.mjs'
import { UPDATE_PROTECTED_FIELDS } from './update-journal.mjs'

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
export function createAirtablePoiStore({ token, baseId, dryRun = false, fetchImpl = globalThis.fetch, deadlineMs = EXCHANGE_DEADLINE_MS }) {
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN и AIRTABLE_BASE_ID обязательны для записи POI')
  }
  const fetch = (url, init) => fetchJsonResponse(fetchImpl, url, init, deadlineMs)
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
     * ЧТЕНИЕ НАЗВАННЫХ ПОЛЕЙ ВСЕХ ЗАПИСЕЙ — мимо кэша, только GET (10h-C, U3).
     * Для отчёта «что изменилось бы»: снимок `POI ID`, `Source Key`, `Working
     * Hours` и т. п. Сырые поля отдаются как есть; кэш снимка не читается и не
     * наполняется. Решений здесь нет.
     */
    async readAllFields(fieldNames) {
      const wanted = [...new Set((Array.isArray(fieldNames) ? fieldNames : []).filter((f) => typeof f === 'string' && f))]
      if (!wanted.length) throw new Error('Airtable POI read: список полей пуст')
      const rows = await fetchAll(wanted)
      return rows.map((row) => ({ recordId: row.id, fields: row.fields ?? {} }))
    },
    /**
     * НЕЗАВИСИМОЕ ЧТЕНИЕ ПО ИДЕНТИФИКАТОРУ ЗАПИСИ (10h-B, DAG 2.8) — мимо
     * кэша, одним GET по адресу записи. Тождество для обновления — `recordId`:
     * по нему идёт PATCH, и по нему же доказывается исход. Ответ обязан нести
     * запрошенный id — иначе это ответ не на тот вопрос. `null` — записи нет
     * (404). Возвращаются сырые поля: снимочные, тождество и названные
     * вызывающим.
     */
    async readFreshByRecordId(recordId, fieldNames = []) {
      if (typeof recordId !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
        throw new Error(`Airtable POI read: ${JSON.stringify(recordId)} — не идентификатор записи`)
      }
      const url = new URL(`${endpoint}/${recordId}`)
      const wanted = [...new Set(['POI ID', 'Source Key', ...fieldNames.filter((f) => typeof f === 'string' && f)])]
      for (const f of wanted) url.searchParams.append('fields[]', f)
      const res = await fetch(url, { headers: auth, cache: 'no-store' })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Airtable POI read: ${res.status} ${await res.text()}`)
      const row = await res.json()
      if (row?.id !== recordId) throw new Error(`Airtable POI read: запрошена запись ${recordId}, в ответе ${JSON.stringify(row?.id ?? null)} — результат не доказывает тождество`)
      return { recordId: row.id, poiId: text(row.fields ?? {}, 'POI ID') || null, sourceKey: text(row.fields ?? {}, 'Source Key') || null, fields: row.fields ?? {} }
    },
    /**
     * ОБНОВЛЕНИЕ СУЩЕСТВУЮЩЕЙ ЗАПИСИ (10h-B, DAG 2.8) — один PATCH ровно
     * с переданными полями. Решений здесь нет: какие поля и какими значениями
     * — называет карточка обновления за границей `withVerifiedUpdates`; защищённые
     * поля (тождество, координатный контур — P07) этим путём не обновляются. Перед PATCH хранилище объявляет
     * эффект наблюдателю с ТОЧНОЙ нагрузкой и дожидается его; отказ
     * наблюдателя отменяет эффект. Ответ PATCH — заявка, не доказательство:
     * исход устанавливает независимое чтение по id.
     *
     * Production-потребителя у метода пока нет (пилот автообновлений — режим
     * «только отчёт» по решению I‑2.1); первый — писатель часов пилота.
     */
    async update(recordId, fields, { onEffect = null } = {}) {
      if (typeof recordId !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
        throw new Error(`Airtable POI update: ${JSON.stringify(recordId)} — не идентификатор записи`)
      }
      if (typeof fields !== 'object' || fields === null || Array.isArray(fields) || !Object.keys(fields).length) {
        throw new Error('Airtable POI update: нагрузка обязана быть непустым объектом полей')
      }
      /* ПРОВЕРЯЕТСЯ ТО, ЧТО УЙДЁТ В СЕТЬ, а не то, что передано (10h-B R1,
         находка 01). `JSON.stringify(fields)` исполнял бы пользовательский
         `toJSON` входа, и тот мог подменить нагрузку — в том числе вписать
         защищённые поля, которых у входа как собственных ключей не было.
         Поэтому нагрузка собирается заново из СОБСТВЕННЫХ data-свойств входа
         (без геттеров и без `toJSON` самого объекта), сериализуется ровно
         один раз, и защищённые ключи ищутся в РАЗОБРАННОМ тексте — в тех
         байтах, что отправляются. Тело PATCH — этот же текст. */
      const copy = {}
      for (const key of Object.keys(fields)) {
        const slot = Object.getOwnPropertyDescriptor(fields, key)
        if (!slot || !('value' in slot)) throw new Error(`Airtable POI update: поле ${JSON.stringify(key)} задано не значением — такая нагрузка не принимается`)
        copy[key] = slot.value
      }
      const wire = JSON.stringify({ fields: copy })
      const parsed = JSON.parse(wire)
      const payload = parsed?.fields
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || !Object.keys(payload).length) {
        throw new Error('Airtable POI update: сериализованная нагрузка пуста или не объект полей')
      }
      const foreign = Object.keys(payload).filter((key) => !Object.prototype.hasOwnProperty.call(copy, key))
      if (foreign.length) throw new Error(`Airtable POI update: сериализация добавила поля (${foreign.join(', ')}) — нагрузка не совпадает с переданной`)
      /* Защищённые поля — тождество и координатный контур (P07) — отвергаются
         здесь, в хранилище, до любого сетевого вызова: даже вызов мимо границы
         не откроет этим путём канал в координаты. */
      for (const key of UPDATE_PROTECTED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) throw new Error(`Airtable POI update: защищённое поле ${key} (тождество или координатный контур) этим путём не обновляется`)
      }
      if (dryRun) return { recordId, dryRun: true }
      if (onEffect) await onEffect({ step: 'update', recordId, payload: JSON.parse(JSON.stringify(payload)) })
      const res = await fetch(`${endpoint}/${recordId}`, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: wire,
      })
      if (!res.ok) throw new Error(`Airtable POI update: ${res.status} ${await res.text()}`)
      const data = await res.json()
      /* Кэш снимка мог нести обновлённые поля — он больше не актуален. */
      cache = null
      return { recordId: typeof data?.id === 'string' ? data.id : null }
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
