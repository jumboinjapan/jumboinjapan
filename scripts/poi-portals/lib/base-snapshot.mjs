/**
 * Контракт снимка базы для режима `--base-snapshot` — в одном месте.
 *
 * Зачем. Режим существует, чтобы прогнать весь путь записи против настоящей
 * базы, не имея права её испортить. До 12.08.2026 он этого не делал:
 * снимок читался как любой JSON, а хранилище поверх него на каждый запрос
 * `findBySourceKey` отвечало «не найдено». Из-за этого ветка идемпотентности
 * в `ingestPoi` не исполнялась ни разу, и прогон объявлял новыми записи,
 * которые в базе уже есть. Файл неверной формы принимался молча — та же
 * болезнь, что уже разбиралась на контракте `--names` (f239f6c, c48ab52).
 *
 * Поэтому здесь три вещи и только они: форма строки снимка, её проверка и
 * хранилище поверх проверенных строк.
 *
 * Форма строки. Все поля ниже обязаны БЫТЬ ОБЪЯВЛЕНЫ у каждой строки;
 * значение может быть null почти у всех. Объявление обязательно намеренно:
 * выгрузка, в которой поля нет вовсе, — это выгрузка другого формата, и
 * принять её значило бы выдать «ключей источника нет ни у кого» за факт о
 * базе, хотя факт только о файле (4dee24a: объявленная и всюду пустая
 * колонка уже принималась за данные).
 *
 *   poiId      string, непустой, уникальный   — тождество записи
 *   recordId   string | null                  — идентификатор записи в Airtable
 *   nameRu     string                         — гейт дублей сравнивает имена
 *   nameEn     string | null
 *   siteCity   string | null                  — гейт различает «тот же город»
 *   lat, lon   number | null, только парой     — гейт сравнивает расстояние
 *   placeId    string | null                  — ключ тождества сильнее имени
 *   sourceKey  string | null, непустые уникальны — идемпотентность приёма
 *
 * Чего снимок НЕ делает: не заменяет живую базу и не обновляется сам.
 * Записи, «созданные» в прогоне, живут только в памяти этого процесса.
 */

/** Поля строки снимка. Единственный источник состава — этот список. */
export const SNAPSHOT_ROW_FIELDS = [
  'poiId', 'recordId', 'nameRu', 'nameEn', 'siteCity', 'lat', 'lon', 'placeId', 'sourceKey',
]

const DECLARED = new Set(SNAPSHOT_ROW_FIELDS)
const NULLABLE_STRINGS = ['recordId', 'nameEn', 'siteCity', 'placeId', 'sourceKey']

const isFilled = (v) => typeof v === 'string' && v.trim().length > 0

/**
 * Проверяет одну строку. Возвращает список нарушений — пустой, если строка
 * годится. Списком, а не первой ошибкой: взаимоисключающие ветки уже прятали
 * одновременные нарушения (17c1ca5).
 */
export function snapshotRowProblems(row, index) {
  const at = `строка ${index}`
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return [`${at}: не объект`]
  }
  const problems = []

  const unknown = Object.keys(row).filter((f) => !DECLARED.has(f))
  if (unknown.length) {
    problems.push(`${at}: неизвестные поля ${unknown.map((f) => `«${f}»`).join(', ')}`)
  }
  const missing = SNAPSHOT_ROW_FIELDS.filter((f) => !(f in row))
  if (missing.length) {
    problems.push(`${at}: не объявлены поля ${missing.map((f) => `«${f}»`).join(', ')}`)
  }

  if (!isFilled(row.poiId)) problems.push(`${at}: poiId пуст или не строка`)
  if ('nameRu' in row && typeof row.nameRu !== 'string') problems.push(`${at}: nameRu не строка`)
  for (const field of NULLABLE_STRINGS) {
    if (field in row && row[field] !== null && typeof row[field] !== 'string') {
      problems.push(`${at}: ${field} не строка и не null`)
    }
  }
  for (const field of ['lat', 'lon']) {
    const v = row[field]
    if (field in row && v !== null && !(typeof v === 'number' && Number.isFinite(v))) {
      problems.push(`${at}: ${field} не число и не null`)
    }
  }
  // Половина координаты хуже её отсутствия: гейт молча перестаёт сравнивать
  // расстояние, а по отчёту это неотличимо от «координат нет».
  const latSet = typeof row.lat === 'number'
  const lonSet = typeof row.lon === 'number'
  if (latSet !== lonSet) problems.push(`${at}: координата задана наполовину (lat ${row.lat}, lon ${row.lon})`)

  return problems
}

/** Счётчики покрытия: что снимок реально может проверить, а что нет. */
export function describeSnapshot(rows) {
  const count = (fn) => rows.filter(fn).length
  return {
    total: rows.length,
    withSourceKey: count((r) => isFilled(r.sourceKey)),
    withCoords: count((r) => typeof r.lat === 'number' && typeof r.lon === 'number'),
    withSiteCity: count((r) => isFilled(r.siteCity)),
    withNameEn: count((r) => isFilled(r.nameEn)),
    withPlaceId: count((r) => isFilled(r.placeId)),
  }
}

/**
 * Читает и полностью проверяет снимок. Бросает при любом нарушении.
 *
 * Вызывается ДО обращения к порталу: нарушение контракта здесь — ошибка
 * входных данных, и узнавать о ней после долгой выгрузки незачем (87fc140).
 */
export async function loadBaseSnapshot(file, readFileFn) {
  if (!isFilled(file)) throw new Error('--base-snapshot: путь к файлу не задан')

  const read = readFileFn ?? (await import('node:fs/promises')).readFile
  let raw
  try {
    raw = await read(file, 'utf8')
  } catch (error) {
    throw new Error(`--base-snapshot ${file}: файл не прочитан — ${error.message}`)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`--base-snapshot ${file}: не разбирается как JSON — ${error.message}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `--base-snapshot ${file}: ожидается массив строк снимка, получен ${parsed === null ? 'null' : typeof parsed}. `
      + `Каждая строка объявляет ${SNAPSHOT_ROW_FIELDS.join(', ')}.`,
    )
  }
  if (!parsed.length) {
    throw new Error(`--base-snapshot ${file}: снимок пуст. Пустая база и снимок не той выгрузки различаются только по этому файлу.`)
  }

  const problems = []
  for (const [i, row] of parsed.entries()) problems.push(...snapshotRowProblems(row, i))

  const seenPoiId = new Set()
  const seenSourceKey = new Set()
  for (const [i, row] of parsed.entries()) {
    if (row && typeof row === 'object') {
      if (isFilled(row.poiId)) {
        if (seenPoiId.has(row.poiId)) problems.push(`строка ${i}: poiId ${row.poiId} повторяется`)
        seenPoiId.add(row.poiId)
      }
      if (isFilled(row.sourceKey)) {
        if (seenSourceKey.has(row.sourceKey)) problems.push(`строка ${i}: sourceKey «${row.sourceKey}» повторяется`)
        seenSourceKey.add(row.sourceKey)
      }
    }
  }

  if (problems.length) {
    const shown = problems.slice(0, 10).map((p) => `  ${p}`).join('\n')
    throw new Error(
      `--base-snapshot ${file}: ${problems.length} нарушений формы.\n${shown}`
      + (problems.length > 10 ? `\n  … и ещё ${problems.length - 10}` : '')
      + `\nОжидается массив строк, каждая объявляет ${SNAPSHOT_ROW_FIELDS.join(', ')}.`,
    )
  }

  return { rows: parsed, stats: describeSnapshot(parsed) }
}

const toPoiLike = (row) => ({
  poiId: row.poiId,
  nameRu: row.nameRu,
  nameEn: row.nameEn ?? undefined,
  siteCity: row.siteCity ?? undefined,
  recordId: row.recordId ?? undefined,
  placeId: row.placeId ?? undefined,
  lat: row.lat,
  lon: row.lon,
})

/**
 * Хранилище поверх ПРОВЕРЕННЫХ строк снимка. Ничего не пишет и не ходит
 * в сеть — весь конвейер прогоняется как есть, включая гейт дублей и
 * идемпотентность по ключу источника.
 *
 * Поиск по ключу настоящий: раньше метод отвечал `null` всегда, и ветка
 * `already_ingested` не исполнялась ни в одном прогоне.
 */
export function createSnapshotStore(rows) {
  const pool = rows.map(toPoiLike)
  const bySourceKey = new Map()
  for (const [i, row] of rows.entries()) {
    if (isFilled(row.sourceKey)) bySourceKey.set(row.sourceKey, pool[i])
  }
  let next = pool.reduce((max, p) => {
    const m = /^POI-(\d{6})$/.exec(p.poiId ?? '')
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)

  return {
    // Копия, а не сам пул: пакет ведёт свой список принятых записей, и общая
    // ссылка складывала бы каждую созданную запись дважды.
    async listExisting() { return [...pool] },

    async findBySourceKey(sourceKey) {
      // Пустой ключ не совпадает ни с чем. Иначе запись без ключа источника
      // объявила бы «уже принято» первой же записи без ключа в снимке.
      if (!isFilled(sourceKey)) return null
      return bySourceKey.get(sourceKey) ?? null
    },

    async create(fields) {
      next += 1
      const poiId = `POI-${String(next).padStart(6, '0')}`
      const entry = {
        poiId,
        nameRu: fields['POI Name (RU)'] ?? '',
        nameEn: fields['POI Name (EN)'] ?? undefined,
        siteCity: fields['Site City'] ?? undefined,
        placeId: fields['Google Place ID'] ?? undefined,
        lat: fields.Latitude ?? undefined,
        lon: fields.Longitude ?? undefined,
        recordId: `snapshot-${poiId}`,
      }
      pool.push(entry)
      // Ключ источника обязан попасть в индекс: иначе повтор того же ключа
      // внутри одного пакета создал бы вторую запись.
      const sourceKey = fields['Source Key']
      if (isFilled(sourceKey)) bySourceKey.set(sourceKey, entry)
      return { poiId, recordId: entry.recordId }
    },
  }
}
