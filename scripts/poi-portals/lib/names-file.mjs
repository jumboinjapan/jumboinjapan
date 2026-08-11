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

/** Поля, которые имеет смысл держать в файле имён. */
export const NAME_FILE_FIELDS = new Set(['nameRu', 'nameEn', 'siteCity'])

export async function loadNames(file) {
  if (!file) return { names: {}, stats: null }
  let parsed
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
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
  }

  return {
    names: parsed,
    stats: {
      file,
      entries: entries.length,
      withNameRu: entries.filter(([, v]) => typeof v.nameRu === 'string' && v.nameRu.trim()).length,
    },
  }
}
