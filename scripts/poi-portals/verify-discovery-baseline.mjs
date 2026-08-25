#!/usr/bin/env node
/**
 * СВЕРКА BASELINE: МАНИФЕСТ ПРОТИВ АРТЕФАКТА, ЛЕЖАЩЕГО В РЕПОЗИТОРИИ.
 *
 *   node scripts/poi-portals/verify-discovery-baseline.mjs \
 *     docs/poi-intake/baselines/japan-guide-v3-2026-08-25.json
 *
 * Сети не касается. Порядок проверок — от того, что можно доказать байтами, к
 * тому, что требует разбора:
 *
 *   1. форма манифеста — точная, с указанием пути каждого расхождения;
 *   2. архив прочитан, распакован ПОД ПОТОЛКОМ;
 *   3. оба представления сверены с манифестом — сжатое и распакованное;
 *   4. отчёт разобран, портал выбран ПОИМЁННО;
 *   5. снимок проверен производственным контрактом;
 *   6. и только теперь описание сверяется с манифестом.
 *
 * ОТСУТСТВИЕ АРТЕФАКТА — ПОРЧА РЕПОЗИТОРИЯ. Прежде он лежал в `tmp/`, и код
 * возврата 3 означал «сверка не выполнялась» — законное состояние. Теперь файл
 * версионируется вместе с манифестом, и его отсутствие означает, что клон
 * неполон: это отказ, а не пропуск.
 *
 *   0  сошлось;
 *   1  расхождение, отказ контракта или отсутствующий артефакт.
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDiscoverySnapshot } from './lib/discovery-contract.mjs'
import {
  BASELINE_DIR,
  DISCOVERY_BASELINE_SPEC,
  artefactDifferences,
  assertDiscoveryBaseline,
  baselineDifferences,
  describeDiscoveryBaseline,
  readCanonicalGzip,
  selectPortalSnapshot,
} from './lib/discovery-baseline.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Полная сверка. Возвращает список расхождений; бросает, если сверять НЕЧЕГО
 * или снимок не проходит контракт — это разные исходы, и смешивать их с
 * «не сошлось» нельзя.
 */
export function verifyDiscoveryBaseline(manifest, { compressed }) {
  assertDiscoveryBaseline(manifest)
  const decompressed = readCanonicalGzip(compressed)
  const byteProblems = artefactDifferences(manifest, { compressed, decompressed })
  /* Разбирать байты, не сошедшиеся с манифестом, незачем: дальше обсуждался бы
     не тот файл. Отказ здесь ранний и полный. */
  if (byteProblems.length) return byteProblems

  const report = JSON.parse(decompressed.toString('utf8'))
  const snapshot = selectPortalSnapshot(report, manifest.artefact.portalId)
  assertDiscoverySnapshot(snapshot)
  /*
   * ВЕРСИЯ ИЗ АРХИВА СВЯЗЫВАЕТСЯ С ОБЪЯВЛЕННОЙ.
   *
   * Манифест уже пришит к единственному поддерживаемому формату
   * (`assertBaselineSnapshotVersion` внутри `assertDiscoveryBaseline`), но
   * САМ АРХИВ до сих пор не был ни к чему пришит. Аудит 25.08 упаковал
   * настоящий снимок `v1` каноническим gzip, пересчитал все три отпечатка и
   * оставил манифесту заявление `v3`: байты сошлись, контракт снимок принял, и
   * сверка дошла до описания, которого для `v1` не существует, — падение было
   * сырым. Отказ обязан быть здесь: после контракта и ДО описания.
   */
  if (snapshot.contractVersion !== manifest.snapshot.contractVersion) {
    throw new TypeError(
      `${DISCOVERY_BASELINE_SPEC}.artefact: манифест объявляет `
      + `${JSON.stringify(manifest.snapshot.contractVersion)}, а в архиве лежит снимок `
      + `${JSON.stringify(snapshot.contractVersion)} — отпечатки сошлись, но это другой формат`)
  }
  return [
    ...artefactDifferences(manifest, { compressed, decompressed, snapshot }),
    ...baselineDifferences(
      {
        snapshot: manifest.snapshot,
        counters: manifest.counters,
        rejected: manifest.rejected,
        topology: manifest.topology,
        integrity: manifest.integrity,
        uncovered: manifest.uncovered,
      },
      describeDiscoveryBaseline(snapshot),
    ),
  ]
}

/**
 * Артефакт по манифесту. Отсутствие файла — отказ, а не пустой результат.
 *
 * МАНИФЕСТ ПРОВЕРЯЕТСЯ ЗДЕСЬ ЖЕ, до чтения файла: раньше сверка звала эту
 * функцию аргументом, то есть ЧИТАЛА файл прежде, чем узнавала, годен ли
 * манифест. Порядок был fail-open: путь `../../outside.json.gz` уводил чтение
 * за пределы репозитория ещё до валидации.
 *
 * Разрешённый путь судится ВТОРОЙ РАЗ — уже файловой системой: символьная
 * ссылка внутри каталога baseline уводит чтение наружу, оставаясь для
 * `assertDiscoveryBaseline` безупречной строкой.
 */
export function loadBaselineArtefact(manifest, repo = REPO) {
  assertDiscoveryBaseline(manifest)
  const file = path.resolve(repo, manifest.artefact.path)
  if (!existsSync(file)) {
    throw new TypeError(
      `${manifest.artefact.path}: артефакта baseline нет в репозитории. Он версионируется вместе `
      + 'с манифестом, поэтому его отсутствие — порча клона, а не «локально не скачан»')
  }
  /* Разрешённый путь судится ВТОРОЙ РАЗ — уже после файловой системы. Строка
     манифеста законна, а файл под ней может оказаться символьной ссылкой на
     что угодно: `assertDiscoveryBaseline` об этом не знает и знать не может. */
  const real = realpathSync.native(file)
  if (path.dirname(real) !== realpathSync.native(path.resolve(repo, BASELINE_DIR))) {
    throw new TypeError(
      `${manifest.artefact.path}: файл разрешается в ${real} — за пределы ${BASELINE_DIR}/; `
      + 'сверка читала бы чужой файл под видом baseline')
  }
  return { compressed: readFileSync(file) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2]
  if (!arg) {
    console.error('нужен путь к манифесту baseline')
    process.exit(2)
  }
  try {
    const manifest = JSON.parse(readFileSync(path.resolve(arg), 'utf8'))
    const problems = verifyDiscoveryBaseline(manifest, loadBaselineArtefact(manifest))
    if (problems.length) {
      console.error(`BASELINE НЕ СОШЁЛСЯ: расхождений ${problems.length}`)
      for (const line of problems) console.error(`  ✗ ${line}`)
      process.exit(1)
    }
    console.log(`baseline «${manifest.label}» сошёлся: архив в репозитории, оба представления `
      + `совпали по байтам и отпечаткам, контракт принял снимок, все утверждения сошлись `
      + `(${manifest.counters.recordsBuilt} записей, ${manifest.counters.networkRequests} обменов)`)
  } catch (error) {
    console.error(`BASELINE НЕ ПРОВЕРЕН: ${error.message}`)
    process.exit(1)
  }
}
