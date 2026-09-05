/**
 * ФИКСТУРА РАЗРЕШЕНИЯ ВЛАДЕЛЬЦА для сюит с живой записью (10f-S R1).
 *
 * Зачем отдельным модулем. После R1 подстановки готового разрешения в код нет:
 * `collect-pois` читает НАСТОЯЩИЙ файл по имени из `--allow`, разбирает его,
 * сверяет с эталоном и эксклюзивно отмечает исполнение. Значит, каждой сюите,
 * которая доходит до живой записи, нужен настоящий файл разрешения — и делать
 * его в четырёх местах по-разному значило бы завести четыре редакции формата.
 *
 * Что фикстура НЕ делает. Она не ослабляет ни одной проверки: файл кладётся по
 * тому же относительному пути (`tmp/poi-write-approvals/<имя>.json`), какой
 * собирает production-код, а отпечаток эталона считается из БАЙТОВ того самого
 * файла `--monitor`, который получит прогон. Подставляется только КОРЕНЬ
 * каталога (`deps.approvalRoot`): среда исполнения не может удалять файлы
 * внутри рабочего дерева, и сюита, писавшая бы разрешения в канонический
 * каталог репозитория, оставляла бы их там навсегда. Полный канонический путь
 * — с корнем настоящего репозитория — проверяет `tests/poi-write-approval.mjs`
 * в песочнице-копии production-дерева.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { sha256Bytes } from '../../scripts/lib/byte-digest.mjs'
import { WRITE_APPROVAL_ROOT_SEGMENTS, WRITE_APPROVAL_SPEC } from '../../scripts/poi-portals/lib/write-approval.mjs'

/**
 * Кладёт разрешение в `<root>/tmp/poi-write-approvals/<name>.json`.
 *
 * @param options.root       корень, который сюита передаст как `deps.approvalRoot`
 * @param options.name       имя разрешения для `--allow` (без расширения)
 * @param options.portal     портал прогона
 * @param options.sourceKeys поимённый состав разрешённых строк
 * @param options.reference  путь к эталонному отчёту (`--monitor`) — его байты подписываются
 * @param options.now        момент прогона: срок строится вокруг него
 * @param options.maxCreates потолок создания (по умолчанию — число названных строк)
 * @param options.maxRenames потолок внутренних PATCH переименования номера
 */
export async function writeApprovalFixture({
  root, name, portal, sourceKeys, reference, now,
  maxCreates = null, maxRenames = 0, scopeId = 'poi-parser-v1', note = null,
  overrides = {},
}) {
  const dir = path.join(root, ...WRITE_APPROVAL_ROOT_SEGMENTS)
  await mkdir(dir, { recursive: true })
  /* Эталон, который сюита СПЕЦИАЛЬНО сделала нечитаемым (случаи
     `referenceMissing`/`referenceInvalid`), подписывается отпечатком пустых
     байтов: разрешение в таком прогоне до применимости не доходит — ворота
     останавливают его раньше и точнее. Молча подставлять «совпадающий»
     отпечаток нельзя, поэтому здесь именно заведомо чужой. */
  const referenceDigest = await readFile(reference).then(sha256Bytes, () => sha256Bytes(new Uint8Array()))
  const moment = now instanceof Date ? now.getTime() : Date.parse(String(now))
  const keys = [...new Set(sourceKeys)].sort()
  /* Имя входит в текст разрешения намеренно. Тождество разрешения — его
     ЦЕННОСТЬ: два побайтно разных файла с одинаковым содержанием суть одно и то
     же разрешение и исполняются один раз. Сюите же нужны РАЗНЫЕ разрешения на
     разные случаи, и различать их обязано содержание, а не имя файла. */
  const approval = {
    spec: WRITE_APPROVAL_SPEC,
    scopeId,
    portal,
    issuedAt: new Date(moment - 60_000).toISOString(),
    expiresAt: new Date(moment + 3_600_000).toISOString(),
    referenceDigest,
    sourceKeys: keys,
    maxCreates: maxCreates ?? keys.length,
    maxRenames,
    note: note ?? `фикстура сюиты: ${name}`,
    ...overrides,
  }
  const file = path.join(dir, `${name}.json`)
  await writeFile(file, `${JSON.stringify(approval, null, 2)}\n`, 'utf8')
  return { file, name, approval, referenceDigest }
}
