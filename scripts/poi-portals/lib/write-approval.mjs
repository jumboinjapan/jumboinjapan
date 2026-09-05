/**
 * РАЗРЕШЕНИЕ ВЛАДЕЛЬЦА НА ОГРАНИЧЕННУЮ ЖИВУЮ ЗАПИСЬ — `poi-write-approval/v2`
 * (10f-S, P10.2; версия поднята в R2 — см. раздел о версии ниже).
 *
 * Что здесь доказывается. P10.2 требует, чтобы ограниченный запуск записал
 * ТОЛЬКО явно разрешённые результаты. До 10f-S состав эффектов определяли
 * источник и позиционный `--limit`: ни одна строка не была названа заранее, а
 * максимальное число эффектов до исполнения было неизвестно
 * (`tmp/10f-s-repro-OLD-2026-09-05.log`). Разрешение закрывает ровно это: оно
 * НАЗЫВАЕТ каждый допустимый `Source Key` и объявляет потолок создания.
 *
 * Почему отдельный контракт, а не переиспользование `poi-model-approval/v1`.
 * То разрешение подписано планом модели: профиль провайдера, отпечаток
 * прайслиста, выборка кандидатов плана. Втащить в него живую запись значило бы
 * связать два несвязанных решения владельца одной подписью — и разрешение на
 * модель начало бы неявно разрешать запись. Форма и дисциплина хранения взяты
 * оттуда же (имя, а не путь; закрытый список ключей; срок; потолки).
 *
 * Чего разрешение НЕ делает. Оно не выдаёт себя само: файл создаёт владелец.
 * Оно не ослабляет ни один сторож: taxonomy, Coordinate Policy, matcher policy,
 * pre-write drift gate и проверяющая граница записи работают как прежде и
 * отвергают строку независимо от того, названа она в разрешении или нет.
 * Разрешение только СУЖАЕТ множество допустимых эффектов — расширить его оно
 * не может.
 *
 * ПРИВЯЗКА К РЕЗУЛЬТАТУ, КОТОРЫЙ ВИДЕЛ ВЛАДЕЛЕЦ (10f-S R1, находка 1).
 * Прежняя редакция привязывалась к сырым байтам выгрузки. Этого мало: имена
 * по-русски, файл существующих записей, снимок базы, версия кода и политики в
 * выгрузку не входят. Контрпример аудита воспроизведён
 * (`tmp/10f-s-r1-repro-OLD-2026-09-05.log`): подмена имён вместе с пересборкой
 * эталона проходила по ТОМУ ЖЕ разрешению и записывала другое имя.
 *
 * Теперь разрешение привязано к ОДНОМУ значению — `referenceDigest`, отпечатку
 * байтов эталонного отчёта (`--monitor`). Эталон — это и есть тот результат,
 * который владелец рассматривал: внутри него манифест со всеми значимыми
 * входами (сырые байты источника, канонический набор кандидатов, файл имён,
 * существующие записи, снимок базы, реестры, версия политики матчера, два
 * снимка кода, версия контракта приёма). Живой прогон обязан совпасть с этим
 * эталоном по pre-write drift gate, а разрешение обязано совпасть с эталоном
 * побайтово. Подменить что-либо значимое, не сменив эталон, невозможно;
 * сменить эталон — значит разойтись с разрешением.
 *
 * ОДНОРАЗОВОСТЬ. Разрешение исполняется один раз: перед первым платным
 * обращением и первым эффектом прогон ЭКСКЛЮЗИВНО создаёт файл-отметку рядом
 * с разрешением. Занятая отметка — именованный отказ и ноль новых эффектов.
 *
 * ПОЛНЫЙ ИНТЕРВАЛ. `issuedAt <= now < expiresAt`: разрешение, выданное
 * будущим числом, не действует.
 *
 * БЮДЖЕТ ЭФФЕКТОВ ЦЕЛИКОМ. `maxCreates` — потолок POST, `maxRenames` — потолок
 * внутренних PATCH переименования номера. Ноль означает: при коллизии номера
 * прогон останавливается ДО PATCH. Текст разрешения и контракт утверждают
 * одно и то же, потому что оба считают одни и те же два числа.
 */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  assertCanonicalInstant,
  assertExactKeys,
  assertInteger,
  assertNonEmptyString,
  assertSha256Value,
  canonicalJsonBytes,
  deepFreeze,
} from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { assertExistingRegularFile, assertPathContainment } from '../../lib/path-boundary.mjs'
/* ЦЕПОЧКА ДОЛГОВЕЧНОСТИ — ОДНА НА ПРОЕКТ (10f-S R2, находка 2). Отметка
   исполнения обязана пережить сбой питания так же, как строка журнала: fsync
   файла фиксирует байты, но не запись о новом ИМЕНИ в каталоге. Своя редакция
   этой процедуры разошлась бы с журнальной молча — и разошлась бы ровно там,
   где обе написаны для аварии. Поэтому берётся журнальная. */
import { DIRECTORY_IO, durable, ensureDurableDirectory } from './write-journal.mjs'
import { describeThrownSafely, thrownCode } from '../../../src/lib/thrown-value.ts'

/** Домен разрешения. Первое поле подписываемых байтов. */
export const WRITE_APPROVAL_SPEC = 'poi-write-approval/v2'
/**
 * ПРЕЖНИЕ ВЕРСИИ — ПОИМЁННО (10f-S R2, находка 3). Состав разрешения менялся
 * несовместимо: v1 нёс `rawPayloadDigest` и не знал ни `referenceDigest`, ни
 * `maxRenames`. Пока версия оставалась прежней, файл v1 отвергался как
 * ПОВРЕЖДЁННЫЙ текущий формат («нет обязательных полей»), и человек читал это
 * как испорченный файл, а не как документ прошлой эпохи. Версия названа, и
 * отказ по ней — отдельная причина.
 */
export const WRITE_APPROVAL_PRIOR_SPECS = Object.freeze(['poi-write-approval/v1'])
/** Каталог разрешений относительно корня репозитория. Параметра нет намеренно. */
export const WRITE_APPROVAL_ROOT_SEGMENTS = Object.freeze(['tmp', 'poi-write-approvals'])
export const WRITE_APPROVAL_ROOT_REL = path.join(...WRITE_APPROVAL_ROOT_SEGMENTS)
/**
 * Каталог ОТМЕТОК ИСПОЛНЕНИЯ. Отдельный от самих разрешений намеренно: отметка
 * именуется не файлом разрешения, а его неизменяемой идентичностью, и класть
 * её рядом под похожим именем значило бы приглашать читать одно за другое.
 */
export const WRITE_APPROVAL_USED_SEGMENT = 'used'
/** Точный состав разрешения — закрытый список. */
export const WRITE_APPROVAL_KEYS = Object.freeze([
  'spec', 'scopeId', 'portal', 'issuedAt', 'expiresAt', 'referenceDigest', 'sourceKeys', 'maxCreates', 'maxRenames', 'note',
])
/** Закрытый список причин отказа. Разбирать текст сообщения незачем. */
export const WRITE_APPROVAL_REFUSALS = Object.freeze([
  'writeApprovalMissing', 'writeApprovalVersion', 'writeApprovalShape', 'writeApprovalExpired',
  'writeApprovalNotYetValid', 'writeApprovalScope', 'writeApprovalPortal', 'writeApprovalReferenceDrift',
  'writeApprovalCeiling', 'writeApprovalAlreadyUsed', 'writeApprovalClaimFailed',
])

/** Отказ разрешения с ПРИЧИНОЙ из закрытого списка. */
export class WriteApprovalRefused extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'WriteApprovalRefused'
    if (!WRITE_APPROVAL_REFUSALS.includes(reason)) {
      throw new TypeError(`WriteApprovalRefused: причина ${JSON.stringify(reason)} не из закрытого списка ${WRITE_APPROVAL_REFUSALS.join(', ')}`)
    }
    this.reason = reason
  }
}

const refuse = (reason, message) => { throw new WriteApprovalRefused(reason, message) }
const isPlain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Канонический отпечаток разрешения — для отчёта и улики. */
export function writeApprovalDigest(approval) {
  return sha256Bytes(canonicalJsonBytes(approval, WRITE_APPROVAL_SPEC))
}

/**
 * Разбор и проверка ФОРМЫ. Ни срока, ни портала, ни источника здесь ещё нет:
 * форма проверяется отдельно от применимости, чтобы «файл сломан» и «файл
 * исправен, но не к этому прогону» никогда не путались.
 */
export function parseWriteApproval(raw, where = WRITE_APPROVAL_SPEC) {
  if (!isPlain(raw)) refuse('writeApprovalShape', `${where}: разрешение обязано быть объектом JSON`)
  /* ВЕРСИЯ — ПЕРВОЙ, ДО СОСТАВА ПОЛЕЙ (10f-S R2, находка 3). Селектор версии
     обязан отвергать ЧУЖУЮ ФОРМУ, а не спотыкаться об отсутствующее поле:
     иначе документ прошлой эпохи выглядит как повреждённый текущий. Значение
     читается собственным data-дескриптором — унаследованное или отданное
     getter'ом версией не считается. */
  const specSlot = Object.getOwnPropertyDescriptor(raw, 'spec')
  const spec = specSlot && 'value' in specSlot ? specSlot.value : undefined
  if (spec !== WRITE_APPROVAL_SPEC) {
    const prior = WRITE_APPROVAL_PRIOR_SPECS.includes(spec)
    refuse('writeApprovalVersion', prior
      ? `${where}: разрешение прежней версии ${spec} — состав полей с тех пор изменился несовместимо (появились referenceDigest и maxRenames, исчез rawPayloadDigest). `
        + `Читается только ${WRITE_APPROVAL_SPEC}; прежнее разрешение исполнению не подлежит`
      : `${where}.spec: ожидается ${WRITE_APPROVAL_SPEC}, получено ${JSON.stringify(spec)}`)
  }
  try {
    assertExactKeys(raw, WRITE_APPROVAL_KEYS, where)
    assertNonEmptyString(raw.scopeId, `${where}.scopeId`)
    assertNonEmptyString(raw.portal, `${where}.portal`)
    assertNonEmptyString(raw.note, `${where}.note`)
    assertCanonicalInstant(raw.issuedAt, `${where}.issuedAt`)
    assertCanonicalInstant(raw.expiresAt, `${where}.expiresAt`)
    if (Date.parse(raw.expiresAt) <= Date.parse(raw.issuedAt)) {
      throw new TypeError(`${where}.expiresAt: срок обязан быть позже выдачи`)
    }
    assertSha256Value(raw.referenceDigest, `${where}.referenceDigest`)
    if (!Array.isArray(raw.sourceKeys) || !raw.sourceKeys.length) {
      throw new TypeError(`${where}.sourceKeys: непустой список ключей источника обязателен — разрешение называет строки поимённо`)
    }
    raw.sourceKeys.forEach((key, i) => assertNonEmptyString(key, `${where}.sourceKeys[${i}]`))
    if (new Set(raw.sourceKeys).size !== raw.sourceKeys.length) {
      throw new TypeError(`${where}.sourceKeys: повтор ключа — состав разрешения обязан быть однозначным`)
    }
    if ([...raw.sourceKeys].sort().join(' ') !== raw.sourceKeys.join(' ')) {
      throw new TypeError(`${where}.sourceKeys: список обязан быть отсортирован — иначе два разрешения с одним составом дают разные отпечатки`)
    }
    assertInteger(raw.maxCreates, `${where}.maxCreates`, 1)
    if (raw.maxCreates < raw.sourceKeys.length) {
      throw new TypeError(`${where}.maxCreates ${raw.maxCreates} меньше числа названных строк ${raw.sourceKeys.length}: потолок обязан покрывать разрешённое`)
    }
    /* Потолок переименований — ЧАСТЬ бюджета, а не примечание. Ноль значит
       «при коллизии остановиться без PATCH»; больше числа создаваемых строк
       он быть не может: переименование бывает только у создаваемой записи. */
    assertInteger(raw.maxRenames, `${where}.maxRenames`, 0)
    if (raw.maxRenames > raw.maxCreates) {
      throw new TypeError(`${where}.maxRenames ${raw.maxRenames} больше потолка создания ${raw.maxCreates}: переименование бывает только у создаваемой записи`)
    }
  } catch (error) {
    if (error instanceof WriteApprovalRefused) throw error
    refuse('writeApprovalShape', error instanceof Error ? error.message : String(error))
  }
  return deepFreeze({ ...raw, sourceKeys: [...raw.sourceKeys] })
}

/**
 * Применимость разрешения К ЭТОМУ ПРОГОНУ. Вызывается ДО хранилища, до
 * резолвера и до первого эффекта; отказ — отказ прогона, а не предупреждение.
 */
export function assertWriteApprovalApplies(input) {
  const { approval, now, scopeId, portal, referenceDigest } = input
  const where = WRITE_APPROVAL_SPEC
  if (approval.scopeId !== scopeId) {
    refuse('writeApprovalScope', `${where}: разрешение выдано на область ${JSON.stringify(approval.scopeId)}, прогон идёт в ${JSON.stringify(scopeId)}`)
  }
  if (approval.portal !== portal) {
    refuse('writeApprovalPortal', `${where}: разрешение выдано на портал ${JSON.stringify(approval.portal)}, прогон идёт по ${JSON.stringify(portal)}`)
  }
  const moment = now instanceof Date ? now.getTime() : Date.parse(String(now))
  if (!Number.isFinite(moment)) refuse('writeApprovalShape', `${where}: момент прогона не разобран`)
  /* ПОЛНЫЙ ИНТЕРВАЛ: issuedAt <= now < expiresAt. */
  if (moment < Date.parse(approval.issuedAt)) {
    refuse('writeApprovalNotYetValid', `${where}: разрешение выдано ${approval.issuedAt}, прогон в ${new Date(moment).toISOString()} — оно ещё не действует`)
  }
  if (moment >= Date.parse(approval.expiresAt)) {
    refuse('writeApprovalExpired', `${where}: срок разрешения истёк ${approval.expiresAt}, прогон в ${new Date(moment).toISOString()}`)
  }
  if (approval.referenceDigest !== referenceDigest) {
    refuse('writeApprovalReferenceDrift',
      `${where}: разрешение выдано на эталонный прогон ${approval.referenceDigest}, а этот прогон сверяется с ${referenceDigest ?? '(эталона нет)'} — `
      + 'владелец видел другой результат')
  }
  return approval
}

/**
 * ОДНОРАЗОВОСТЬ — ПО НЕИЗМЕНЯЕМОЙ ИДЕНТИЧНОСТИ РАЗРЕШЕНИЯ (10f-S R2, находка 1).
 *
 * Прежняя редакция отмечала исполнение файлом `<имя>.used.json` рядом с
 * разрешением, то есть считала тождеством ИМЯ ФАЙЛА. Имя — свойство каталога,
 * а не документа: копия тех же байтов под другим именем исполнялась второй раз
 * и второй раз платила (`tmp/10f-s-r2-repro-OLD-2026-09-05.log`: код 0,
 * создано 1, обращений к Google 1 — при побайтно том же разрешении).
 *
 * Тождество разрешения — его КАНОНИЧЕСКИЙ ОТПЕЧАТОК: sha256 канонических байтов
 * разобранного значения (`writeApprovalDigest`). Он не зависит ни от имени
 * файла, ни от порядка ключей, ни от форматирования, и меняется от любого
 * значимого поля. Отметка называется этим отпечатком и лежит в отдельном
 * каталоге `used/`. Копия, переименование и переформатирование того же
 * разрешения дают ТОТ ЖЕ отпечаток и упираются в занятое имя; другое
 * разрешение — другой отпечаток и своё имя.
 *
 * ДОЛГОВЕЧНОСТЬ ДО ПЕРВОГО ПЛАТНОГО ОБРАЩЕНИЯ (10f-S R2, находка 2).
 * Доказательство потребления обязано пережить сбой питания РАНЬШЕ, чем прогон
 * потратит деньги или произведёт эффект. Поэтому здесь полная цепочка: каталоги
 * создаются по одному с синхронизацией родителя (`ensureDurableDirectory`),
 * байты отметки сбрасываются `fsync`, дескриптор закрывается, и после закрытия
 * синхронизируется КАТАЛОГ — иначе зафиксированные байты могут не существовать
 * по имени. Отказ любого шага — открытия, записи, sync или close — именованный
 * отказ прогона: непроверяемая отметка означает «исполнение не доказано», а не
 * «можно продолжать». Ни одно брошенное значение наружу не выходит.
 *
 * @param repoRoot корень, от которого собирается канонический каталог разрешений
 * @param approval РАЗОБРАННОЕ разрешение — источник тождества
 * @param claim    что записать в отметку (для человека и поздней сверки)
 * @param io       файловые операции цепочки — подменяются только для наблюдения
 */
export async function claimWriteApproval(repoRoot, approval, claim, io = {}) {
  const chain = { ...DIRECTORY_IO, ...io }
  let identity
  try {
    identity = writeApprovalDigest(approval)
  } catch (error) {
    refuse('writeApprovalClaimFailed', `${WRITE_APPROVAL_SPEC}: отпечаток разрешения не вычислен: ${describeThrownSafely(error)}`)
  }
  const hex = identity.slice(identity.indexOf(':') + 1)
  const usedDir = path.join(repoRoot, ...WRITE_APPROVAL_ROOT_SEGMENTS, WRITE_APPROVAL_USED_SEGMENT)
  const target = path.join(usedDir, `${hex}.json`)
  try {
    assertPathContainment(target, { insideDir: usedDir })
  } catch (error) {
    refuse('writeApprovalClaimFailed', `${WRITE_APPROVAL_SPEC}: отметка исполнения вне каталога разрешений: ${describeThrownSafely(error)}`)
  }
  try {
    await ensureDurableDirectory(usedDir, chain)
  } catch (error) {
    refuse('writeApprovalClaimFailed', `${WRITE_APPROVAL_SPEC}: каталог отметок исполнения не создан долговечно: ${describeThrownSafely(error)}`)
  }
  let handle
  try {
    handle = await chain.open(target, 'wx')
  } catch (error) {
    if (thrownCode(error) === 'EEXIST') {
      refuse('writeApprovalAlreadyUsed',
        `${WRITE_APPROVAL_SPEC}: разрешение ${identity} уже исполнено — отметка ${target} занята. `
        + 'Тождество разрешения — его отпечаток, а не имя файла: копия и переименование исполнению не подлежат')
    }
    refuse('writeApprovalClaimFailed', `${WRITE_APPROVAL_SPEC}: отметку исполнения не создать: ${describeThrownSafely(error)}`)
  }
  let failure = null
  try {
    await handle.writeFile(`${JSON.stringify({ ...claim, identity }, null, 2)}\n`, 'utf8')
    await durable(handle)
  } catch (error) {
    failure = `отметка исполнения не записана: ${describeThrownSafely(error)}`
  }
  try {
    await handle.close()
  } catch (error) {
    /* Закрытие — часть записи, а не уборка: отложенная ошибка всплывает именно
       здесь. Проглотить её значит объявить исполнение доказанным по файлу,
       содержимое которого неизвестно. Первичный отказ важнее вторичного. */
    failure = failure ?? `дескриптор отметки не закрыт: ${describeThrownSafely(error)}`
  }
  if (failure) refuse('writeApprovalClaimFailed', `${WRITE_APPROVAL_SPEC}: ${failure}`)
  try {
    await chain.durableDirectory(usedDir)
  } catch (error) {
    refuse('writeApprovalClaimFailed', `${WRITE_APPROVAL_SPEC}: каталог отметок не синхронизирован — имя отметки может не пережить сбой: ${describeThrownSafely(error)}`)
  }
  return { path: target, identity }
}

/**
 * Чтение файла разрешения ПО ИМЕНИ, а не по пути: путь собирается здесь, и
 * выйти за каталог разрешений именем нельзя. Файл читается РОВНО ОДИН РАЗ —
 * дальше по прогону ходит разобранное значение, а не имя файла (TOCTOU).
 *
 * CRASH-PROOF (10f-S R1, находка 5). Прежняя редакция звала
 * `assertNonEmptyString` и `assertPathContainment` ВНЕ try: на `--allow ""` и
 * на `--allow` не-строке наружу уходил сырой `TypeError` без поля `reason`
 * (`tmp/10f-s-r1-repro-OLD-2026-09-05.log`), то есть отказ разрешения переставал
 * быть отказом ИЗ ЗАКРЫТОГО СПИСКА и в отчёт попадал как падение процесса.
 * Теперь из этой функции наружу может выйти ТОЛЬКО `WriteApprovalRefused`:
 * каждое брошенное значение — включая враждебное — описывается общим
 * `describeThrownSafely`, а не чтением `.message`.
 */
export async function readWriteApprovalFile(repoRoot, name, io = { readFile }) {
  let target
  try {
    assertNonEmptyString(name, '--allow: имя файла разрешения')
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      refuse('writeApprovalShape', `--allow ${JSON.stringify(name)}: ожидается ИМЯ файла в ${WRITE_APPROVAL_ROOT_REL}/, а не путь`)
    }
    const root = path.join(repoRoot, ...WRITE_APPROVAL_ROOT_SEGMENTS)
    target = path.join(root, name.endsWith('.json') ? name : `${name}.json`)
    assertPathContainment(target, { insideDir: root })
  } catch (error) {
    if (error instanceof WriteApprovalRefused) throw error
    refuse('writeApprovalShape', `--allow: имя разрешения отвергнуто: ${describeThrownSafely(error)}`)
  }
  let text
  try {
    assertExistingRegularFile(target)
    text = await io.readFile(target, 'utf8')
  } catch (error) {
    refuse('writeApprovalMissing', `--allow: файл разрешения ${target} не прочитан: ${describeThrownSafely(error)}`)
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    refuse('writeApprovalShape', `${target}: не разбирается как JSON: ${describeThrownSafely(error)}`)
  }
  const approval = parseWriteApproval(raw, target)
  let digest
  try {
    digest = writeApprovalDigest(approval)
  } catch (error) {
    /* Отпечаток считается по уже разобранному значению, но канонизация — тоже
       код, и её отказ обязан остаться отказом разрешения, а не падением. */
    refuse('writeApprovalShape', `${target}: отпечаток разрешения не вычислен: ${describeThrownSafely(error)}`)
  }
  return { approval, file: target, digest }
}
