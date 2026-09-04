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
 *   placeId    string | null                  — ПОДГОТОВЛЕНО, см. ниже
 *   sourceKey  string | null, непустые уникальны — идемпотентность приёма
 *
 * `placeId` в формате есть, но портальный путь эту ось НЕ исполняет:
 * гейт в poi-ingest сравнивает `request.poi.resolved.placeId` со снимком,
 * а коллектор `resolved` не наполняет — доверенный resolvePlace к нему не
 * подключён. Поле лежит готовым к тому моменту, когда подключат; обещать
 * проверку по нему сейчас нельзя.
 *
 * Чего снимок НЕ делает: не заменяет живую базу и не обновляется сам.
 * Записи, «созданные» в прогоне, живут только в памяти этого процесса.
 */

import { createMemoryPoiStore } from '../../../src/lib/poi-memory-store.ts'

/** Поля строки снимка. Единственный источник состава — этот список. */
export const SNAPSHOT_ROW_FIELDS = [
  'poiId', 'recordId', 'nameRu', 'nameEn', 'siteCity', 'lat', 'lon', 'placeId', 'sourceKey',
]

const DECLARED = new Set(SNAPSHOT_ROW_FIELDS)
const NULLABLE_STRINGS = ['recordId', 'nameEn', 'siteCity', 'placeId', 'sourceKey']

/** Форма идентификатора POI. Та же, по которой store выдаёт следующий номер. */
const POI_ID_SHAPE = /^POI-\d{6}$/

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

  if (typeof row.poiId !== 'string' || !POI_ID_SHAPE.test(row.poiId)) {
    problems.push(`${at}: poiId «${row.poiId}» не формы POI-000000`)
  }
  // Пустое имя не даёт гейту дублей ничего сравнивать, а по отчёту такая
  // запись неотличима от нормальной.
  if (!isFilled(row.nameRu)) problems.push(`${at}: nameRu пуст или не строка`)
  // Идентификатор либо отсутствует честно (null), либо содержателен.
  // Пробельная строка — это «поле заполнено» на вид и пусто по сути.
  for (const field of NULLABLE_STRINGS) {
    const v = row[field]
    if (!(field in row) || v === null) continue
    if (typeof v !== 'string') problems.push(`${at}: ${field} не строка и не null`)
    else if (!isFilled(v)) problems.push(`${at}: ${field} — пустая или пробельная строка; отсутствие пишется как null`)
  }
  const RANGE = { lat: 90, lon: 180 }
  for (const field of ['lat', 'lon']) {
    const v = row[field]
    if (!(field in row) || v === null) continue
    if (!(typeof v === 'number' && Number.isFinite(v))) {
      problems.push(`${at}: ${field} не число и не null`)
      continue
    }
    // Ноль живое хранилище считает ОТСУТСТВИЕМ координаты (poi-matching.ts,
    // toPoiLike: нулевая широта — точка в Атлантике). Снимок обязан говорить
    // то же самое тем же способом, иначе гейт на снимке и на базе разойдутся.
    if (v === 0) problems.push(`${at}: ${field} равен нулю; живое хранилище считает это отсутствием координаты — пишите null`)
    else if (Math.abs(v) > RANGE[field]) problems.push(`${at}: ${field} ${v} вне допустимого диапазона ±${RANGE[field]}`)
  }
  // Половина координаты хуже её отсутствия: гейт молча перестаёт сравнивать
  // расстояние, а по отчёту это неотличимо от «координат нет».
  const latSet = typeof row.lat === 'number'
  const lonSet = typeof row.lon === 'number'
  if (latSet !== lonSet) problems.push(`${at}: координата задана наполовину (lat ${row.lat}, lon ${row.lon})`)

  return problems
}

/**
 * Единственная проверка набора строк. Через неё проходит и файл, и любые
 * строки, отданные хранилищу напрямую: пока валидатор вызывался только из
 * loadBaseSnapshot, публичный путь в обход него оставался открытым — строки
 * можно было передать мимо файла, и прогон принимал их без единого вопроса.
 */
export function assertSnapshotRows(rows, where) {
  if (!Array.isArray(rows)) {
    throw new Error(
      `${where}: ожидается массив строк снимка, получен ${rows === null ? 'null' : typeof rows}. `
      + `Каждая строка объявляет ${SNAPSHOT_ROW_FIELDS.join(', ')}.`,
    )
  }
  if (!rows.length) {
    throw new Error(`${where}: снимок пуст. Пустая база и снимок не той выгрузки различаются только по этому файлу.`)
  }

  const problems = []
  for (const [i, row] of rows.entries()) problems.push(...snapshotRowProblems(row, i))

  const seen = { poiId: new Set(), sourceKey: new Set(), recordId: new Set() }
  for (const [i, row] of rows.entries()) {
    if (row === null || typeof row !== 'object') continue
    for (const field of ['poiId', 'sourceKey', 'recordId']) {
      const v = row[field]
      if (!isFilled(v)) continue
      if (seen[field].has(v)) problems.push(`строка ${i}: ${field} «${v}» повторяется`)
      seen[field].add(v)
    }
  }

  if (problems.length) {
    const shown = problems.slice(0, 10).map((p) => `  ${p}`).join('\n')
    throw new Error(
      `${where}: ${problems.length} нарушений формы.\n${shown}`
      + (problems.length > 10 ? `\n  … и ещё ${problems.length - 10}` : '')
      + `\nОжидается массив строк, каждая объявляет ${SNAPSHOT_ROW_FIELDS.join(', ')}.`,
    )
  }
  return rows
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

  assertSnapshotRows(parsed, `--base-snapshot ${file}`)

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
export function createSnapshotStore(rows, options = {}) {
  assertSnapshotRows(rows, 'createSnapshotStore')
  /* Снимок — хранилище в памяти ПО ТОЖДЕСТВУ фабрики writer'а (10f-P R2):
     writer узнаёт его не по объявлению, а по тому, что объект и его методы
     выданы createMemoryPoiStore. Наблюдение — через options.observe. */
  return createMemoryPoiStore(
    rows.map((row) => ({ ...toPoiLike(row), sourceKey: isFilled(row.sourceKey) ? row.sourceKey : null })),
    options,
  )
}
