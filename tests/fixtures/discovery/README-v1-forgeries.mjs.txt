/**
 * СТРОИТ ПОДДЕЛКИ v1 — внутренне согласованные, с настоящими отпечатками v1.
 *
 * Зачем. Отрицательный тест «v1 отвергает состояние v2» ничего не стоит,
 * если подделка отвергается ОТПЕЧАТКОМ: тогда снятие версионной проверки
 * ничего не меняет, а тест всё равно краснеет — на другой строке. Чтобы
 * проверка версии была единственным, что стоит между v1 и приёмом, подделка
 * обязана сойтись по всем отпечаткам.
 *
 * Как. Для каждого варианта берётся КОПИЯ распакованного bd8ebe6 и в неё
 * вносится ОДНА точечная заплата: в перечисление v1 добавляется состояние,
 * которого у настоящего v1 не было. Дальше снимок строится СОБСТВЕННЫМИ
 * строителями этой копии — значит отпечатки посчитаны доменами v1
 * (`poi-discovery-record/v1#record` и прочими), а не текущими.
 *
 * Копии лежат вне репозитория. Репозиторий не изменяется.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const V1 = path.resolve(process.env.HOME, 'v1build')
const OUT = path.resolve(process.env.HOME, 'v1forge')
const CONTRACT = 'scripts/poi-portals/lib/discovery-contract.mjs'
const FETCH = 'scripts/poi-portals/lib/html-fetch.mjs'

/*
 * Заплата для кода отказа страницы — ТРИ места, а не одно.
 *
 * Мало добавить код в перечисление: v1 выводит причину неполноты из кода и
 * всё неизвестное относит к `targetFetchFailed`, а текущий читатель тот же
 * код относит к `targetStructureMismatch`. Снимок, согласованный только по
 * v1, текущий читатель отверг бы НЕ ПО ВЕРСИИ, а по расхождению причин — и
 * отрицательный тест доказывал бы не то. Поэтому вывод причины в копии
 * приводится к текущему, и единственное, что остаётся против подделки, —
 * проверка версии.
 */
const pageRolePatch = (code) => [
  {
    file: CONTRACT,
    find: 'export const PAGE_REJECTION_CODES = Object.freeze([\n',
    replace: `export const PAGE_REJECTION_CODES = Object.freeze([\n  '${code}',\n`,
  },
  {
    file: CONTRACT,
    find: '      (row) => row.code !== STRUCTURE_CODE && row.code !== UNSUPPORTED_SHAPE_CODE).length,',
    replace: `      (row) => row.code !== STRUCTURE_CODE && row.code !== '${code}'`
      + ' && row.code !== UNSUPPORTED_SHAPE_CODE).length,',
  },
  {
    file: CONTRACT,
    find: '    targetStructureMismatch: targets.filter((row) => row.code === STRUCTURE_CODE).length,',
    replace: '    targetStructureMismatch: targets.filter('
      + `(row) => row.code === STRUCTURE_CODE || row.code === '${code}').length,`,
  },
]

/*
 * Заплаты семейства `legacySuffix` — ОДИН набор на два варианта.
 *
 * Подделка записи и подделка свидетельства цели требуют одного и того же:
 * копия `v1` должна уметь РАЗОБРАТЬ такой адрес. Две копии этого списка
 * разошлись бы молча.
 */
const LEGACY_SUFFIX_PATCHES = [
      {
        file: FETCH,
        find: "export const URL_FAMILIES = Object.freeze(['legacy', 'destinationRoot', 'destinationNested'])",
        replace: "export const URL_FAMILIES = Object.freeze(['legacy', 'legacySuffix', 'destinationRoot', 'destinationNested'])",
      },
      {
        file: FETCH,
        find: "const LEGACY_PATH = new RegExp('^/e/(e\\\\d+[a-z]?)\\\\.html$')",
        replace: "const LEGACY_PATH = new RegExp('^/e/(e\\\\d+[a-z]?)\\\\.html$')\n"
          + "const LEGACY_SUFFIX_PATH = new RegExp('^/e/(e\\\\d+_(?:[a-z]+|\\\\d{3}))\\\\.html$')",
      },
      {
        file: FETCH,
        find: "  if (LEGACY_PATH.test(path)) return { url: url.href, family: 'legacy' }",
        replace: "  if (LEGACY_PATH.test(path)) return { url: url.href, family: 'legacy' }\n"
          + "  if (LEGACY_SUFFIX_PATH.test(path)) return { url: url.href, family: 'legacySuffix' }",
      },
      /* Матрица «семейство → допустимые роли» тоже закрыта перечислением:
         без новой строки свидетельство страницы падало бы на неизвестном
         семействе, а не строилось. */
      {
        file: CONTRACT,
        find: "  legacy: Object.freeze(['collection', 'poi']),",
        replace: "  legacy: Object.freeze(['collection', 'poi']),\n"
          + "  legacySuffix: Object.freeze(['poi']),",
      },
      {
        file: FETCH,
        find: '  const legacy = path.match(LEGACY_PATH)\n',
        replace: '  const legacySuffix = path.match(LEGACY_SUFFIX_PATH)\n'
          + '  if (legacySuffix) return `japan-guide:${legacySuffix[1]}`\n'
          + '  const legacy = path.match(LEGACY_PATH)\n',
      },
]

const VARIANTS = [
  /*
   * ЕДИНСТВЕННЫЙ ЗАКОННЫЙ ВАРИАНТ — без заплат.
   *
   * Коды отказа карточек у `v1` и `v2` совпадают, подделывать нечего. Зато
   * без такого снимка поле `cardRejectionCodes` в политике `v1` не читается
   * ни одной проверкой: его можно опустошить, и ни один тест не покраснеет.
   * Этот снимок текущий читатель ОБЯЗАН принять — на нём поле и держится.
   */
  { name: 'cardRejected', why: 'ЗАКОННЫЙ v1 с отвергнутой карточкой', verdict: 'accept', patches: [] },
  /*
   * ЧЕТЫРЕ СНИМКА БЕЗ ЕДИНОЙ ЗАПЛАТЫ.
   *
   * Опубликованный `v1` принимал их сам: поля, где от страницы остался один
   * ключ, он не проверял ничем, кроме формы строки. Это не подделки версии,
   * а дыры в связности, и текущий читатель обязан закрыть их для обоих
   * форматов.
   */
  {
    name: 'orderLegacySuffix',
    why: 'ключ нового семейства в orderRecord.order[], записи для него нет',
    verdict: 'reject',
    patches: [],
  },
  {
    name: 'failedTargetLegacySuffix',
    why: 'ключ нового семейства в rejected.targets[].ref',
    verdict: 'reject',
    patches: [],
  },
  {
    name: 'orphanCardRejection',
    why: 'отказ карточки у коллекции, которой снимок не наблюдал',
    verdict: 'reject',
    patches: [],
  },
  {
    name: 'orphanPoiRejection',
    why: 'отказ объекта, которого нет ни в одном порядке; порядок несёт другой ключ',
    verdict: 'reject',
    patches: [],
  },
  {
    name: 'pageRoleAmbiguous',
    why: 'код отказа страницы, которого v1 не знал',
    patches: pageRolePatch('pageRoleAmbiguous'),
  },
  {
    name: 'pageRoleUnknown',
    why: 'код отказа страницы, которого v1 не знал',
    patches: pageRolePatch('pageRoleUnknown'),
  },
  {
    name: 'containerTopologyAmbiguous',
    why: 'код отказа страницы, которого v1 не знал',
    patches: pageRolePatch('containerTopologyAmbiguous'),
  },
  {
    name: 'unknownAdmissionLabel',
    why: 'код пропуска, которого v1 не знал',
    patches: [{
      file: CONTRACT,
      find: 'export const OMISSION_CODES = Object.freeze([\n',
      replace: "export const OMISSION_CODES = Object.freeze([\n  'unknownAdmissionLabel',\n",
    }],
  },
  {
    name: 'containerChild',
    why: 'вид размещения, которого v1 не знал',
    patches: [
      {
        file: CONTRACT,
        find: "export const PLACEMENT_KINDS = Object.freeze(['catalogueDirect', 'destinationRanking'])",
        replace: "export const PLACEMENT_KINDS = Object.freeze(['catalogueDirect', 'containerChild', 'destinationRanking'])",
      },
      /* Ранга у ребёнка контейнера нет — три поля обязаны быть `null` и в
         копии тоже, иначе подделку отверг бы не версия, а форма. */
      {
        file: CONTRACT,
        find: "  if (placement.kind === 'catalogueDirect') {\n    for (const field of RANKING_FIELDS) {",
        replace: "  if (placement.kind === 'catalogueDirect' || placement.kind === 'containerChild') {"
          + "\n    for (const field of RANKING_FIELDS) {",
      },
    ],
  },
  {
    name: 'targetEvidenceLegacySuffix',
    why: 'семейство адресов у СВИДЕТЕЛЬСТВА ЦЕЛИ, а не у записи',
    patches: LEGACY_SUFFIX_PATCHES,
  },
  {
    name: 'legacySuffix',
    why: 'семейство адресов, которого грамматика v1 построить не умела',
    patches: LEGACY_SUFFIX_PATCHES,
  },
  {
    name: 'collectionKind',
    why: 'поле порядка, которого в v1 не существовало',
    patches: [
      {
        file: CONTRACT,
        find: "const ORDER_KEYS = Object.freeze(['destinationSourceKey', 'sourcePageDigest', 'order', 'orderDigest'])",
        replace: "const ORDER_KEYS = Object.freeze(['destinationSourceKey', 'sourcePageDigest', 'collectionKind', 'order', 'orderDigest'])",
      },
      {
        file: CONTRACT,
        find: 'export function orderDigest(destinationSourceKey, sourcePageDigest, orderedSourceKeys) {',
        replace: 'export function orderDigest(destinationSourceKey, sourcePageDigest, orderedSourceKeys, collectionKind = null) {',
      },
      {
        file: CONTRACT,
        find: '    { destinationSourceKey, sourcePageDigest, order: [...orderedSourceKeys] },',
        replace: '    { destinationSourceKey, sourcePageDigest, collectionKind, order: [...orderedSourceKeys] },',
      },
      {
        file: CONTRACT,
        find: 'export function buildOrderRecord(destinationSourceKey, sourcePageDigest, order) {\n'
          + '  const record = {\n    destinationSourceKey,\n    sourcePageDigest,\n    order: [...order],\n'
          + '    orderDigest: orderDigest(destinationSourceKey, sourcePageDigest, order),\n  }',
        replace: 'export function buildOrderRecord(destinationSourceKey, sourcePageDigest, order, collectionKind = null) {\n'
          + '  const record = {\n    destinationSourceKey,\n    sourcePageDigest,\n    collectionKind,\n    order: [...order],\n'
          + '    orderDigest: orderDigest(destinationSourceKey, sourcePageDigest, order, collectionKind),\n  }',
      },
      {
        file: CONTRACT,
        find: '  if (record.orderDigest !== orderDigest(record.destinationSourceKey, record.sourcePageDigest, record.order)) {',
        replace: '  if (record.orderDigest !== orderDigest(record.destinationSourceKey, record.sourcePageDigest, record.order, record.collectionKind)) {',
      },
    ],
  },
]

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const variants = []
for (const variant of VARIANTS) {
  const dir = path.join(OUT, variant.name)
  mkdirSync(dir, { recursive: true })
  cpSync(path.join(V1, 'scripts'), path.join(dir, 'scripts'), { recursive: true })
  cpSync(path.join(V1, 'package.json'), path.join(dir, 'package.json'))
  symlinkSync(path.join(V1, 'node_modules'), path.join(dir, 'node_modules'))
  cpSync(path.join(V1, 'gen/forge-one.mjs'), path.join(dir, 'forge-one.mjs'))

  for (const patch of variant.patches) {
    const file = path.join(dir, patch.file)
    const source = readFileSync(file, 'utf8')
    const found = source.split(patch.find).length - 1
    if (found !== 1) {
      console.error(`ОСТАНОВ ${variant.name}: якорь в ${patch.file} найден ${found} раз`)
      console.error(`  якорь: ${JSON.stringify(patch.find.slice(0, 90))}`)
      process.exit(2)
    }
    /* Замена ФУНКЦИЕЙ, а не строкой: в строке замены `$'` и `$&` имеют
       особый смысл, и текст с `$')` — как раз конец регулярного выражения —
       молча размножил бы файл вместо вставки строки. */
    writeFileSync(file, source.replace(patch.find, () => patch.replace), 'utf8')
  }

  const run = spawnSync('node', ['forge-one.mjs', variant.name], { cwd: dir, encoding: 'utf8' })
  if (run.status !== 0) {
    console.error(`ОСТАНОВ ${variant.name}: строитель упал\n${run.stderr}`)
    process.exit(2)
  }
  console.log(`   ${run.stdout.trim()}`)
  const snapshot = JSON.parse(readFileSync(path.join(dir, `gen-${variant.name}.json`), 'utf8'))
  variants.push({
    name: variant.name,
    why: variant.why,
    /* `accept` — снимок обязан приниматься; `reject` — обязан отвергаться. */
    verdict: variant.verdict ?? 'reject',
    /* Была ли внесена заплата в копию коммита. `false` значит, что снимок
       собран НЕТРОНУТЫМ строителем bd8ebe6. */
    patched: variant.patches.length > 0,
    snapshot,
  })
}

if (!existsSync(path.join(V1, 'gen'))) mkdirSync(path.join(V1, 'gen'))
writeFileSync(path.join(V1, 'gen/v1-forgeries.json'), `${JSON.stringify({
  note: 'Снимки v1, построенные строителями bd8ebe6. У части (patched: true) в копию '
    + 'коммита внесена одна точечная заплата в перечисление v1 — отпечатки при этом '
    + 'настоящие и сходятся, и отвергнуть такой снимок может ТОЛЬКО проверка версии '
    + 'формата. Остальные (patched: false) опубликованный v1 принимал сам: это не '
    + 'подделки версии, а дыры в связности. Поле verdict говорит, что обязан сделать '
    + 'текущий читатель. Сгенерировано gen/make-v1-forgeries.mjs.',
  builtFrom: 'bd8ebe6',
  variants,
}, null, 2)}\n`, 'utf8')
console.log(`\nвариантов построено: ${variants.length}`)
