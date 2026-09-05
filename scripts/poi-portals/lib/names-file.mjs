/**
 * Файл имён для коллектора: карта `sourceKey → {nameRu, nameEn, siteCity}`.
 *
 * Отдельный модуль, потому что проверку контракта надо уметь запускать без
 * сети. Пока разбор жил в collect-pois.mjs, до него в офлайне не доходило
 * управление: скрипт сначала идёт в портал, а файл читает уже на этапе
 * записи. Проверить контракт было нечем — а именно он 11.08.2026 молча
 * принял файл другого формата.
 */
import { readFile } from 'node:fs/promises'
import { fileIdentity } from './run-manifest.mjs'

/**
 * Поля файла. Только имена и туристический слаг.
 *
 * Часов работы и описаний здесь нет намеренно: они не входят в контракт
 * файла имён и обрабатываются своими конвейерами. Пока writeRun читал
 * отсюда workingHours и descriptionRu, код обещал две разные формы файла
 * сразу — схема разрешала одно, чтение допускало другое.
 */
export const NAME_FILE_FIELDS = new Set(['nameRu', 'nameEn', 'siteCity'])

/** Поля, ради которых файл вообще имеет смысл: имя на одном из языков. */
const NAME_FIELDS = ['nameRu', 'nameEn']

const filled = (value) => typeof value === 'string' && value.trim().length > 0

export async function loadNames(file) {
  if (!file) return { names: {}, stats: null, identity: null }
  /* Байты читаются РОВНО ОДИН РАЗ и здесь же подписываются: тождество файла в
     манифесте прогона и содержимое, которым пользуется writer, обязаны быть
     одним и тем же чтением (10f-Q R1). Второе чтение того же пути открывало бы
     окно подмены между подписью и применением. */
  let bytes
  let parsed
  try {
    bytes = await readFile(file)
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`--names ${file}: ${error.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `--names ${file}: ожидается объект «sourceKey → {nameRu, nameEn, siteCity}», получен ${
        Array.isArray(parsed) ? 'массив' : typeof parsed
      }`,
    )
  }

  const entries = Object.entries(parsed)
  if (!entries.length) throw new Error(`--names ${file}: файл пуст`)

  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`--names ${file}: значение ключа «${key}» не объект с именами`)
    }
    const unknown = Object.keys(value).filter((field) => !NAME_FILE_FIELDS.has(field))
    if (unknown.length) {
      throw new Error(
        `--names ${file}: у ключа «${key}» неизвестные поля ${unknown.map((f) => `«${f}»`).join(', ')}. `
        + `Ожидаются ${[...NAME_FILE_FIELDS].join(', ')}. Похоже, это файл другого формата.`,
      )
    }
    for (const [field, fieldValue] of Object.entries(value)) {
      if (fieldValue !== undefined && typeof fieldValue !== 'string') {
        throw new Error(`--names ${file}: поле «${field}» ключа «${key}» не строка`)
      }
    }
    // Пустая запись формально проходила бы контракт и при этом ничего не
    // давала. Хуже: совпав с кандидатом, она подняла бы matched выше нуля
    // и выключила защиту от файла не того портала.
    if (!Object.values(value).some(filled)) {
      throw new Error(`--names ${file}: у ключа «${key}» нет ни одного непустого значения`)
    }
  }

  return {
    /* Подпись ТЕХ ЖЕ байтов, из которых разобраны имена. */
    identity: fileIdentity(file, bytes),
    names: parsed,
    stats: {
      file,
      entries: entries.length,
      withNameRu: entries.filter(([, v]) => filled(v.nameRu)).length,
    },
  }
}

/**
 * Покрытие файла кандидатами прогона.
 *
 * matched считает совпавшие ключи, matchedWithName — только те из них, что
 * действительно принесли имя. Второе число важнее: ключ, совпавший записью
 * с одним siteCity, покрытием имён не является, а matched выше нуля уже
 * выключил бы проверку файла.
 */
export function describeNameCoverage(stats, usedKeys, names) {
  if (!stats) return null
  const used = [...usedKeys]
  return {
    ...stats,
    matched: used.length,
    unused: stats.entries - used.length,
    matchedWithName: used.filter((key) => NAME_FIELDS.some((field) => filled(names[key]?.[field]))).length,
  }
}

/**
 * Файл передан, но ни один ключ не совпал — это ошибка, а не «имён просто
 * нет». Проверять её обязательно ДО записи и до раннего возврата: иначе
 * неверный файл принимается молча, а разбор уходит не туда.
 */
export function assertNameCoverage(coverage) {
  if (!coverage) return
  if (coverage.matched === 0) {
    throw new Error(
      `--names ${coverage.file}: ни один из ${coverage.entries} ключей не совпал с кандидатами портала. `
      + 'Похоже, файл от другого источника: ключ имеет вид «<портал>:<ключ в источнике>».',
    )
  }
  if (coverage.matchedWithName === 0) {
    throw new Error(
      `--names ${coverage.file}: совпало ${coverage.matched} ключей, но ни один не принёс имени. `
      + 'Файл покрывает кандидатов и при этом бесполезен — проверьте поля nameRu и nameEn.',
    )
  }
}
