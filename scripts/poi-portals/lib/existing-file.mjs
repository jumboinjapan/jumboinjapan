/**
 * Файл существующих POI для коллектора: `--existing`.
 *
 * Отдельный модуль по той же причине, что и `names-file.mjs`: проверку
 * контракта надо уметь запускать без сети. Пока разбор жил в
 * `collect-pois.mjs`, до него не доходило управление в офлайне — скрипт
 * сначала идёт в портал и только потом читает файл.
 *
 * ЗАЧЕМ ЭТОТ МОДУЛЬ ПОЯВИЛСЯ. Прежний `loadExisting` ловил любую ошибку,
 * печатал её в stderr и возвращал пустой массив. Дальше `matchAgainstExisting`
 * не вызывался вовсе, `matchedExistingBase` оставался нулём, прогон завершался
 * успешно и записывал артефакт. Воспроизведено через настоящий CLI на пяти
 * входах: каталог вместо файла, отсутствующий файл, невалидный JSON, объект без
 * `records`, массив не объектов. Во всех пяти случаях результат неотличим от
 * корректного файла, в котором просто нет совпадений, — а это два совершенно
 * разных факта о базе.
 *
 * ФОРМА. Массив записей либо объект `{records: [...]}`. Запись — обычный
 * объект; поля берутся те же, что читает `matchAgainstExisting`:
 *
 *   sourceKey  string, непустой, уникальный  — тождество по ключу источника
 *   nameJa | nameEn | nameRu  string          — сравнение имён
 *   lat, lon   number, только парой           — сравнение расстояния
 *
 * ФОРМА ПРОВЕРЯЕТСЯ ТА ЖЕ, В КОТОРОЙ КЛЮЧ ЧИТАЕТ МАТЧЕР. Круг 10f-M R1: первая
 * редакция проверяла подрезанные копии, а матчер читает сырые значения, и между
 * ними открылась щель. Воспроизведено композицией `loadExistingBase` →
 * `matchAgainstExisting`:
 *
 *   — `sourceKey` вида « bodik:1 » контракт считал заполненным, потому что
 *     смотрел на `trim()`. Матчер сравнивает строки через `===` без всякой
 *     нормализации — файл принимался, ключ на вид был тот самый, а
 *     идемпотентность по нему не срабатывала: `verdict = new`;
 *   — поле имени недопустимого типа контракт не проверял вовсе: он спрашивал
 *     «есть ли хоть одно заполненное строковое поле», а типы остальных не
 *     смотрел. `nameEn: ['Tsutenkaku']` приводится матчером к строке и даёт
 *     точное совпадение — ложный `name_1.00` и `verdict = likely`.
 *
 * Поэтому проверяется каждый ключ, который матчер читает, и проверяется по
 * тому правилу, по которому матчер его использует: `sourceKey` — как строка,
 * сравниваемая посимвольно, имена — как вход нормализующего сравнения,
 * координаты — как числа для расстояния.
 *
 * ПРИГОДНОСТЬ ИМЕНИ СЧИТАЕТСЯ ПОСЛЕ НОРМАЛИЗАЦИИ, А НЕ ПО СЫРОЙ ДЛИНЕ. Круг
 * 10f-M R2: `[{ "nameEn": "   " }]` принимался, `withName` показывал единицу, а
 * матчер по этому имени возвращал `verdict = new` — `normalizeName` оставляет
 * от такой строки пустоту. То же с «—·—» и «- - -», которые `trim()` не ловит.
 * Предикат один и он вызывает саму нормализацию матчера.
 *
 * КРАЕВЫЕ ПРОБЕЛЫ В `sourceKey` ОТВЕРГАЮТСЯ, А НЕ ПОДРЕЗАЮТСЯ МОЛЧА. Подрезка
 * означала бы, что мы решили за источник, какой у записи ключ; ключ — это
 * тождество, и чинить его догадкой нельзя. Имена подрезать не нужно и не
 * нужно отвергать: их сравнение само нормализует пробелы.
 *
 * ЧУЖИЕ ПОЛЯ НЕ ЗАПРЕЩЕНЫ, и это осознанная разница с контрактом `--names`.
 * Туда кладут файл, который пишем мы сами, и закрытый список полей там уместен.
 * Сюда кладут выгрузку базы — с `poiId`, `recordId`, `siteCity`, `placeId` и чем
 * угодно ещё. Запретить лишнее значило бы сломать нормальный путь ради
 * симметрии. Проверяется не отсутствие лишнего, а НАЛИЧИЕ того, по чему запись
 * вообще может совпасть: запись, у которой нет ни ключа, ни имени, ни пары
 * координат, не совпадёт ни с чем никогда и лишь разбавляет счёт.
 */
import { readFile } from 'node:fs/promises'
/* Та же самая функция, которую матчер применяет к имени перед сравнением —
   не копия правила. Своя реализация здесь означала бы второе определение
   «содержательного имени», и разошлись бы они молча. */
import { normalizeName } from '../../../src/lib/poi-matching.ts'
import { fileIdentity } from './run-manifest.mjs'

/** Поля, ради которых запись имеет смысл: хоть одно обязано быть заполнено. */
export const EXISTING_MATCHABLE_FIELDS = Object.freeze(['sourceKey', 'nameJa', 'nameEn', 'nameRu'])

/**
 * Ключи, которые матчер действительно читает, и правило, по которому он их
 * использует. Список закрыт: ключ, которого здесь нет, матчер не смотрит, и
 * проверять его — значит обещать гарантию, которой нет.
 *
 *   exactString — сравнивается посимвольно, без нормализации;
 *   name        — идёт в nameSimilarity, которая пробелы и регистр нормализует;
 *   coordinate  — идёт в haversineMeters как число.
 */
export const EXISTING_CONSUMED_KEYS = Object.freeze({
  sourceKey: 'exactString',
  nameJa: 'name',
  nameEn: 'name',
  nameRu: 'name',
  lat: 'coordinate',
  lon: 'coordinate',
})

/** Поля имён — те, что матчер сравнивает через nameSimilarity. */
export const EXISTING_NAME_FIELDS = Object.freeze(['nameJa', 'nameEn', 'nameRu'])

/**
 * Имя содержательно, если после ТОЙ ЖЕ нормализации, что применяет матчер, от
 * него что-то остаётся.
 *
 * Круг 10f-M R2: пригодность считалась по сырой длине, `value.length > 0`.
 * `normalizeName` вычищает всё, кроме букв и цифр, поэтому строка из пробелов,
 * из пунктуации или из разделителей сырую проверку проходила, а после
 * нормализации становилась пустой. Воспроизведено композицией: контракт
 * принимал файл и считал `withName = 1`, а `matchAgainstExisting` по этому
 * имени возвращал `verdict = new` и ноль совпадений.
 *
 * Одного `trim()` мало: он снимает пробелы, но «—·—» и «- - -» оставляет
 * непустыми, а матчер их обнуляет. Поэтому предикат один и он вызывает саму
 * нормализацию, а не воспроизводит её условия.
 *
 * Краевые пробелы у содержательного имени препятствием НЕ являются:
 * нормализация их снимает, и «  Osaka Castle  » совпадает как обычно.
 */
const meaningfulName = (value) => typeof value === 'string' && normalizeName(value).length > 0

/** Значение задано, если ключ есть и он не пуст по значению. */
const given = (record, key) => key in record && record[key] !== null && record[key] !== undefined
/** Непустая строка БЕЗ подрезки: ровно то, что увидит сравнение через ===. */
const nonEmptyString = (value) => typeof value === 'string' && value.length > 0
const finite = (value) => typeof value === 'number' && Number.isFinite(value)

/**
 * Читает и проверяет файл существующих POI.
 *
 * Бросает при любом недостоверном входе. Возвращает `{records: [], stats: null}`
 * ТОЛЬКО когда файл не запрошен вовсе: отсутствие аргумента — это не ошибка,
 * а другой режим работы, и он остаётся прежним.
 */
export async function loadExistingBase(file) {
  if (!file) return { records: [], stats: null, identity: null }

  /* Байты читаются как есть: тождество файла для манифеста прогона считается
     по ним, а не по перекодированной строке. Разбор идёт по тем же байтам. */
  let bytes
  try {
    bytes = await readFile(file)
  } catch (error) {
    throw new Error(`--existing ${file}: файл не прочитан — ${error.message}`)
  }
  const raw = bytes.toString('utf8')

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`--existing ${file}: не разбирается как JSON — ${error.message}`)
  }

  let records
  if (Array.isArray(parsed)) {
    records = parsed
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.records)) {
    records = parsed.records
  } else {
    throw new Error(
      `--existing ${file}: ожидается массив записей либо объект «{records: [...]}», получен ${
        parsed === null ? 'null' : Array.isArray(parsed) ? 'массив' : typeof parsed
      }. Похоже, это файл другого формата.`,
    )
  }

  // Пустой список и файл не той выгрузки различаются только по этому файлу.
  // Принять пустой значило бы объявить «в базе никого нет» на основании того,
  // что нам дали не тот файл, — ровно то, чем и был прежний fail-open.
  if (!records.length) {
    throw new Error(
      `--existing ${file}: список пуст. Пустая база и файл не той выгрузки различаются `
      + 'только по этому файлу, и сверка с пустым списком ничего не проверяет.',
    )
  }

  const seenSourceKeys = new Map()
  records.forEach((record, i) => {
    const at = `запись №${i + 1}`
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(
        `--existing ${file}: ${at} не объект, а ${
          record === null ? 'null' : Array.isArray(record) ? 'массив' : typeof record
        }.`,
      )
    }

    // Каждый ключ, который читает матчер, проверяется по своему правилу —
    // и только заданный: отсутствие ключа это не ошибка, а другая запись.
    for (const [key, kind] of Object.entries(EXISTING_CONSUMED_KEYS)) {
      if (!given(record, key)) continue
      const value = record[key]
      if (kind === 'exactString') {
        if (typeof value !== 'string') {
          throw new Error(
            `--existing ${file}: ${at}: ${key} задан, но это ${
              Array.isArray(value) ? 'массив' : typeof value
            }, а сравнивается он как строка.`,
          )
        }
        if (value.length === 0) throw new Error(`--existing ${file}: ${at}: ${key} задан, но пуст.`)
        if (value !== value.trim()) {
          throw new Error(
            `--existing ${file}: ${at}: ${key} «${value}» с краевыми пробелами. `
            + 'Ключ сравнивается посимвольно и с пробелами не совпадёт ни с чем; '
            + 'подрезать его молча нельзя — это тождество записи, а не оформление.',
          )
        }
      } else if (kind === 'name') {
        if (typeof value !== 'string') {
          throw new Error(
            `--existing ${file}: ${at}: ${key} задан, но это ${
              Array.isArray(value) ? 'массив' : typeof value
            }, а не строка. Сравнение имён приводит любое значение к строке, `
            + 'и нестроковое поле даёт совпадение, которого нет.',
          )
        }
      } else if (!finite(value)) {
        throw new Error(`--existing ${file}: ${at}: ${key} не конечное число.`)
      }
    }

    if (given(record, 'sourceKey')) {
      // Ключ запоминается СЫРЫМ: именно его матчер и сравнивает.
      if (seenSourceKeys.has(record.sourceKey)) {
        throw new Error(
          `--existing ${file}: ${at}: ключ источника «${record.sourceKey}» уже встречался в записи №${
            seenSourceKeys.get(record.sourceKey) + 1
          }. Две записи с одним ключом делают ответ об идемпотентности неоднозначным.`,
        )
      }
      seenSourceKeys.set(record.sourceKey, i)
    }

    const hasLat = finite(record.lat)
    const hasLon = finite(record.lon)
    if (hasLat !== hasLon) {
      throw new Error(
        `--existing ${file}: ${at}: записана одна координата из двух. `
        + 'Половина пары не даёт расстояния и на карту не ставится.',
      )
    }
    // Ключ источника и имя судятся по-разному, потому что по-разному
    // используются: ключ сравнивается посимвольно и нормализации не проходит,
    // имя проходит. Общая проверка «непустая строка» врала бы про имя.
    const matchable = nonEmptyString(record.sourceKey)
      || EXISTING_NAME_FIELDS.some((field) => meaningfulName(record[field]))
      || (hasLat && hasLon)
    if (!matchable) {
      throw new Error(
        `--existing ${file}: ${at}: нет ни ключа источника, ни имени, ни пары координат — `
        + 'совпасть с кандидатом такая запись не может ни при каких условиях.',
      )
    }
  })

  return {
    /* Тождество файла для манифеста прогона — SHA-256 прочитанных байтов. */
    identity: fileIdentity(file, bytes),
    records,
    stats: {
      file,
      total: records.length,
      withSourceKey: records.filter((r) => nonEmptyString(r.sourceKey)).length,
      withName: records.filter((r) => EXISTING_NAME_FIELDS.some((f) => meaningfulName(r[f]))).length,
      withCoords: records.filter((r) => finite(r.lat) && finite(r.lon)).length,
    },
  }
}

/** Строка для stderr — та же форма, что у снимка базы. */
export function describeExistingBase(stats) {
  if (!stats) return null
  return `[poi-portals] существующие POI ${stats.file}: ${stats.total} записей, `
    + `с ключом источника ${stats.withSourceKey}, с именем ${stats.withName}, с координатами ${stats.withCoords}`
}
