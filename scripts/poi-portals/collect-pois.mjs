#!/usr/bin/env node
/**
 * Коллектор POI с туристических порталов и открытых данных Японии.
 *
 *   node scripts/poi-portals/collect-pois.mjs --portal bodik-osaka-tourism
 *   node scripts/poi-portals/collect-pois.mjs --portal bodik-kyoto-tourism --limit 300
 *   node scripts/poi-portals/collect-pois.mjs --all --out tmp/poi-run.json
 *   node scripts/poi-portals/collect-pois.mjs --portal ... --monitor tmp/prev.json
 *
 * Dry-run по умолчанию: без --write в Airtable не уходит ничего. Локальный
 * файл при этом создаётся — его пишет --out, и это выгрузка данных источника,
 * а не запись в базу.
 *
 * Запись идёт ТОЛЬКО через ingestPoiBatch из src/lib/poi-ingest.ts — канон,
 * идемпотентность по Source Key, гейт дублей, черновик. Собственного пути
 * записи у коллектора нет и быть не должно.
 *
 * Русское имя берётся из трёх источников по убыванию надёжности: файл --names
 * (владелец уже выбрал форму — она главнее всего), затем кана источника,
 * затем английское название. Два последних собираются транслитерацией по
 * Поливанову (src/lib/polivanov.ts): «Todai-ji Temple» → «Храм Тодайдзи».
 * Родовое слово переводится, ядро транслитерируется, заимствования остаются
 * латиницей — так же, как владелец пишет их сам.
 *
 * Каждое собранное имя помечается в Notes как машинное. Запись всё равно
 * черновик, но отличить «имя выбрал человек» от «имя собрал скрипт» потом
 * можно будет только по этой отметке — поэтому она ставится всегда.
 *
 * Имя из --names ПЕРЕОПРЕДЕЛЯЕТ машинное, но не является для записи
 * обязательным: собранного из каны или английского достаточно. Сверка
 * транслитератора с живой базой — npm run check:polivanov.
 *
 * Режим --monitor сравнивает прогон с предыдущим снимком и показывает, что
 * изменилось у источника: закрытия, смена часов, новые и пропавшие объекты.
 * Это и есть «мониторинг» — то, ради чего источник вообще подключается
 * повторно, а не один раз.
 */

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import nextEnv from '@next/env'
import { buildSourceKey, ensureTaxonomySchemaForWrite, ingestPoiBatch } from '../../src/lib/poi-ingest.ts'
import { coordinateDecisionSubjectVerdict, loadCoordinateDecisions } from '../../src/lib/poi-coordinate-decision.ts'
import { taxonomyRecordFields } from '../../src/lib/poi-taxonomy-airtable.ts'
import {
  canonicalPortalPlaceResolver,
  PORTAL_PLACE_SUBJECT_SPEC,
  resolvePortalPlace,
} from '../../src/lib/poi-portal-place.ts'
import { poiNameToRu, poiNameFromKana } from '../../src/lib/polivanov.ts'
import { resolveSiteCity } from '../../src/lib/jp-address.ts'
import { assertNameCoverage, describeNameCoverage, loadNames } from './lib/names-file.mjs'
import { describeExistingBase, loadExistingBase } from './lib/existing-file.mjs'
import { createSnapshotStore, loadBaseSnapshot } from './lib/base-snapshot.mjs'
import { createAirtablePoiStore } from './lib/airtable-store.mjs'
/* `ALL_SOURCES` — тот же массив, в котором ищет `getPortal`. Взят напрямую
   потому, что preflight обязан получить «портала нет» ЗНАЧЕНИЕМ: `getPortal`
   на неизвестном id бросает, и ворота P8 упали бы чужой ошибкой вместо
   собственного именованного исхода. */
import { activePortals, ALL_SOURCES, getPortal } from './registry.mjs'
import { RAW_FILE_BYTES_SPEC } from '../lib/byte-digest.mjs'
import { resolveProviderProfile } from './lib/provider-profile.mjs'
import { assertExclusiveJsonTarget, writeJsonReport } from '../lib/report-writer.mjs'
/* Единственная production-композиция CLI → исполнитель модели. Ссылка на сам
   `model-executor.mjs` живёт ТАМ и только там: набор недостижимости требует
   ровно одну, и вторая ссылка отсюда сделала бы её двумя. */
import { buildPlanEnvelope, envelopePathFor, PLAN_DIR_REL, runModelExecution } from './lib/model-run.mjs'
import { ARTIFACT_NAMES, assertExclusiveJsonTarget as assertExclusiveArtifactTarget } from '../lib/path-boundary.mjs'
import { PRODUCTION_HTTPS_REQUEST } from './lib/model-wire.mjs'
import {
  assertCodeIdentity,
  assertIdentity,
  assertPolicyShape,
  AWAITING_TERMINAL,
  buildModelPlan,
  buildPortalPlanFragment,
} from './lib/model-plan.mjs'
import { taxonomyVersion } from '../../src/lib/poi-taxonomy.ts'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'
import { collectFromOpenDataCsv } from './lib/opendata-csv.mjs'
import { collectJapanGuideDiscovery, diffDiscoverySnapshot } from './lib/japan-guide-html.mjs'
import { evaluatePoiCandidate } from './lib/scoring.mjs'
import {
  dedupeWithinBatch, matchAgainstExisting, MATCHER_POLICY_VERSION, matcherPolicyDigest,
} from './lib/dedupe.mjs'
import { CLASSIFY_SCHEMA, CLASSIFY_SYSTEM_PROMPT, estimateCascadeCost } from './lib/enrich.mjs'
/* Единственный разрешённый импорт моста совместимости: только здесь, только
   для подготовки полей старого Airtable. См. заголовок самого моста. */
import { legacyAirtableCategory } from './lib/legacy-airtable-category-bridge.mjs'
import { isRouteToPoi, poiWritableDecision, TERMINAL } from './lib/classification-contract.mjs'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

/** Границы регионов — грубые, задача только отловить координаты «не туда». */
const REGION_BBOX = {
  tokyo: { minLat: 35.5, maxLat: 35.9, minLon: 139.3, maxLon: 139.95 },
  osaka: { minLat: 34.2, maxLat: 35.1, minLon: 135.0, maxLon: 135.8 },
  kyoto: { minLat: 34.7, maxLat: 35.8, minLon: 134.8, maxLon: 136.1 },
  uji: { minLat: 34.7, maxLat: 35.0, minLon: 135.7, maxLon: 136.0 },
  nara: { minLat: 33.8, maxLat: 34.8, minLon: 135.6, maxLon: 136.2 },
  hakone: { minLat: 35.1, maxLat: 35.35, minLon: 138.9, maxLon: 139.15 },
  kamakura: { minLat: 35.28, maxLat: 35.36, minLon: 139.48, maxLon: 139.58 },
  nikko: { minLat: 36.6, maxLat: 37.2, minLon: 139.2, maxLon: 139.9 },
  kanazawa: { minLat: 36.4, maxLat: 36.7, minLon: 136.5, maxLon: 136.8 },
  hiroshima: { minLat: 34.0, maxLat: 34.9, minLon: 132.0, maxLon: 133.5 },
}

const ADAPTERS = {
  'opendata-csv': collectFromOpenDataCsv,
}

/**
 * Адаптеры DISCOVERY — отдельная таблица, а не запись в ADAPTERS.
 *
 * Разделение не косметическое. Всё, что лежит в ADAPTERS, попадает в
 * evaluatePortalCandidates, дедуп, очереди и запись: это конвейер КАНДИДАТОВ
 * в POI. Discovery-обход кандидатов не производит вовсе — он производит
 * записи poi-discovery-record/v2 с неподтверждёнными подсказками, которым в
 * том конвейере делать нечего. Одна общая таблица означала бы, что забытая
 * ветка молча отправит подсказки Japan Guide в Intake.
 */
const DISCOVERY_ADAPTERS = {
  'japan-guide-html': collectJapanGuideDiscovery,
}

/**
 * ЕДИНСТВЕННАЯ таблица опций CLI.
 *
 * Ею пользуются трое: `parseArgs`, генератор `--help` и `acceptedFlags()` для
 * `npm run check:docs`. Отдельного списка рядом нет и быть не должно —
 * разошлись бы они молча, а расходятся такие списки всегда: справка забыла
 * `--samples` и `--help` ровно потому, что жила отдельно от разбора.
 *
 * `apply` получает объект аргументов и функцию чтения следующего значения,
 * поэтому побочные эффекты флага (у `--dry-write` их два, у
 * `--base-snapshot` три) описаны там же, где и сам флаг.
 */
const CLI_OPTIONS = Object.freeze([
  {
    flags: ['--portal'],
    usage: '--portal <id>',
    help: ['прогнать один портал из реестра'],
    apply: (args, next) => { args.portal = next() },
  },
  {
    flags: ['--all'],
    usage: '--all',
    help: ['все активные порталы с реализованным адаптером'],
    apply: (args) => { args.all = true },
  },
  {
    flags: ['--limit'],
    usage: '--limit <n>',
    help: ['ограничить число записей (для обкатки)'],
    apply: (args, next) => { args.limit = Number(next()) },
  },
  {
    flags: ['--existing'],
    usage: '--existing <file>',
    help: ['JSON с текущей базой POI для сверки на дубли.',
      'Массив записей либо {records: [...]}. Недостоверный файл роняет прогон:'
      + ' сверка по нечитаемому или пустому списку ничего не проверяет.'],
    apply: (args, next) => { args.existing = next() },
  },
  {
    flags: ['--max-place-lookups'],
    usage: '--max-place-lookups <n>',
    help: ['потолок платных обращений к Google Places за прогон.',
      'Целое неотрицательное число. Считается ПОСЛЕ проверки Source Key:',
      'уже принятые строки к резолверу не идут и в бюджет не входят.',
      'Превышение останавливает прогон до первого запроса. Обязателен',
      'для production-резолвера; --dry-write и --base-snapshot его не отменяют.'],
    apply: (args, next) => {
      if (args.maxPlaceLookups !== null) {
        throw new Error('--max-place-lookups указан дважды: бюджет обязан быть один')
      }
      const raw = next()
      if (typeof raw !== 'string' || raw.trim() === '') {
        throw new Error('--max-place-lookups требует значения')
      }
      /* Строгая форма ДО сети: `Number('12abc')` даёт NaN, а `parseInt` — 12,
         и молча принять «12abc» как двенадцать значило бы согласиться с мусором
         в бюджете платных обращений. */
      if (!/^\d+$/.test(raw.trim())) {
        throw new Error(`--max-place-lookups: ожидается целое неотрицательное число, получено «${raw}»`)
      }
      const value = Number(raw.trim())
      if (!Number.isSafeInteger(value)) {
        throw new Error(`--max-place-lookups: число вне безопасного диапазона — «${raw}»`)
      }
      args.maxPlaceLookups = value
    },
  },
  {
    flags: ['--monitor'],
    usage: '--monitor <file>',
    help: ['сравнить с предыдущим снимком прогона'],
    apply: (args, next) => { args.monitor = next() },
  },
  {
    flags: ['--out'],
    usage: '--out <file>',
    help: ['записать полный отчёт JSON'],
    apply: (args, next) => { args.out = next() },
  },
  {
    flags: ['--names'],
    usage: '--names <file>',
    help: [
      'JSON: sourceKey → {nameRu, nameEn, siteCity};',
      'имя оттуда переопределяет машинное',
    ],
    apply: (args, next) => { args.names = next() },
  },
  {
    flags: ['--samples'],
    usage: '--samples <n>',
    help: ['сколько примеров решений попадёт в отчёт (по умолчанию 8)'],
    apply: (args, next) => { args.samples = Number(next()) },
  },
  {
    flags: ['--help', '-h'],
    usage: '--help, -h',
    help: ['эта справка'],
    apply: (args) => { args.help = true },
  },
  {
    /* Локальный план модельной классификации. Модель не вызывает, в базу не
       пишет, credentials не требует. Несовместимость с режимами записи
       проверяется в P0, до первого адаптера. */
    flags: ['--model-plan'],
    usage: '--model-plan',
    help: [
      'локальный диагностический план модельной классификации;',
      'требует --out в tmp/poi-model-plans/. Рядом с отчётом',
      'пишется исполняемый конверт <имя>.envelope.json. Модель не',
      'вызывается, в базу ничего не пишется, credentials не',
      'нужны. С --limit совместим: план v1 ничего не исполняет.',
    ],
    apply: (args) => { args.modelPlan = true },
  },
  {
    /* Профиль провайдера ТОЧНОЙ парой id@version. Ближайшей версии, отката и
       частичного совпадения нет: отпечаток плана обязан разрешаться в один
       профиль, а не в тот, который сегодня похож. */
    flags: ['--model-provider-profile'],
    usage: '--model-provider-profile <id>@<version>',
    help: [
      'точный профиль провайдера из канонического реестра;',
      'только вместе с --model-plan. СВЯЗЫВАЕТ локальный план v2',
      'с профилем — модель при этом не вызывается. Несовместим',
      'с --limit: ограничение корпуса не входит в привязанный',
      'отпечатком план, и повторный запуск источников его не',
      'воспроизведёт. executionPermitted остаётся false, пока',
      'policy источника запрещает обработку, а сегодня её',
      'запрещают все двенадцать источников.',
    ],
    apply: (args, next) => { args.providerProfileRef = next() },
  },
  {
    /* PRODUCTION-ИСПОЛНЕНИЕ МОДЕЛЬНОГО ПЛАНА. Единственный режим, способный
       дойти до платного обращения, и единственный, у которого путь к деньгам
       закрыт двенадцатью воротами preflight, а не отсутствием кода. */
    flags: ['--model-execute'],
    usage: '--model-execute',
    help: [
      'исполнить подписанный план модельной классификации;',
      'требует --model-plan-file и --model-approval. Ни один',
      'другой флаг с ним не совместим. До полного preflight',
      'ни секрет, ни сеть, ни журнал не трогаются, а при',
      'сегодняшней policy источников прогон останавливается',
      'на воротах и денег не тратит.',
    ],
    apply: (args) => {
      if (args.modelExecute) throw new Error('--model-execute указан дважды')
      args.modelExecute = true
    },
  },
  {
    flags: ['--model-plan-file'],
    usage: '--model-plan-file <name>',
    help: [
      'ИМЯ конверта плана <имя>.envelope.json в tmp/poi-model-plans/',
      '— не путь и не отчёт прогона. Разделители, «..» и ссылки',
      'не принимаются: конверт читается только из разрешённого',
      'каталога и только своим разбором.',
    ],
    apply: (args, next) => {
      if (args.planFileName !== null) throw new Error('--model-plan-file указан дважды')
      const raw = next()
      if (typeof raw !== 'string' || raw.trim() === '') {
        throw new Error('--model-plan-file требует значения')
      }
      args.planFileName = raw
    },
  },
  {
    flags: ['--model-approval'],
    usage: '--model-approval <name>',
    help: [
      'ИМЯ файла разрешения владельца в tmp/poi-model-approvals/.',
      'Читается только собственным store с фиксированным корнем;',
      'произвольный путь к разрешению не принимается.',
    ],
    apply: (args, next) => {
      if (args.approvalFileName !== null) throw new Error('--model-approval указан дважды')
      const raw = next()
      if (typeof raw !== 'string' || raw.trim() === '') {
        throw new Error('--model-approval требует значения')
      }
      args.approvalFileName = raw
    },
  },
  {
    flags: ['--write'],
    usage: '--write',
    help: ['записать корзину import через ingestPoiBatch'],
    apply: (args) => { args.write = true },
  },
  {
    /* Полный конвейер записи против настоящего снимка базы, но без создания
       записей: так видно реальные исходы гейта до первой правки. */
    flags: ['--dry-write'],
    usage: '--dry-write',
    help: ['прогнать запись против живой базы, ничего не создавая'],
    apply: (args) => { args.write = true; args.dryWrite = true },
  },
  {
    /* Снимок базы файлом. Прогон без записи не должен требовать ключей НА
       ЗАПИСЬ — иначе посмотреть, что сделает гейт, можно только имея право
       всё испортить. */
    flags: ['--base-snapshot'],
    usage: '--base-snapshot <file>',
    help: [
      'то же, но против снимка базы из файла, без токена;',
      'форма строки снимка — scripts/poi-portals/lib/base-snapshot.mjs',
    ],
    apply: (args, next) => { args.baseSnapshot = next(); args.dryWrite = true; args.write = true },
  },
])

const CLI_OPTION_BY_FLAG = new Map(
  CLI_OPTIONS.flatMap((option) => option.flags.map((flag) => [flag, option])),
)

/**
 * Множество принимаемых флагов — для сверки документации.
 *
 * Экспортируется намеренно: `check:docs` обязан получать его от самого
 * разбора, а не выуживать регулярным выражением из текста. Regex видит одно
 * написание условия и слепнет на эквивалентном.
 */
export function acceptedFlags() {
  return new Set(CLI_OPTION_BY_FLAG.keys())
}

/** Текст справки. Строится из той же таблицы, что и разбор. */
export function helpText() {
  const width = 18
  const lines = ['Коллектор POI с порталов Японии.', '']
  for (const option of CLI_OPTIONS) {
    const head = option.usage.length > width
      ? [`  ${option.usage}`, `  ${' '.repeat(width)} ${option.help[0]}`]
      : [`  ${option.usage.padEnd(width)} ${option.help[0]}`]
    lines.push(...head)
    for (const extra of option.help.slice(1)) lines.push(`  ${' '.repeat(width)} ${extra}`)
  }
  lines.push(
    '',
    'Без --write в Airtable не уходит ничего; локальный отчёт при этом всё',
    'равно пишется, если задан --out. С --write записываются кандидаты из',
    'корзины import, у которых собралось русское имя: из --names, из каны',
    'либо из английского названия.',
  )
  return lines.join('\n')
}

function parseArgs(argv) {
  const args = {
    portal: null,
    all: false,
    limit: null,
    write: false,
    dryWrite: false,
    baseSnapshot: null,
    out: null,
    monitor: null,
    existing: null,
    names: null,
    samples: 8,
    modelPlan: false,
    providerProfileRef: null,
    maxPlaceLookups: null,
    modelExecute: false,
    planFileName: null,
    approvalFileName: null,
  }
  /* ЧТО ИМЕННО ПЕРЕДАЛИ, а не что получилось. Сравнение значений с
     умолчаниями режимом не управляет: `--samples 8` меняет значение на такое
     же, и по значению его не отличить от «флага не было». Отличить можно
     только по факту передачи, поэтому он и запоминается. */
  const seen = []
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[(i += 1)]
    const option = CLI_OPTION_BY_FLAG.get(a)
    if (!option) throw new Error(`Неизвестный аргумент: ${a}`)
    seen.push(a)
    option.apply(args, next)
  }
  args.seenFlags = Object.freeze(seen)
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit < 1)) {
    throw new Error('--limit должен быть положительным числом')
  }
  return args
}

/**
 * Оценка кандидатов портала. Одна реализация на обычный прогон и на повторный
 * запуск в preflight: bbox и правило его отключения обязаны быть теми же, иначе
 * повторный прогон объявит расхождением собственную разницу в оценке.
 *
 * Один bbox на портал: у мультирегиональных источников проверка выключается,
 * там регион определяется на этапе привязки к городу.
 */
export function evaluatePortalCandidates(portal, candidates) {
  const bbox = portal.regionKeys.length === 1 ? (REGION_BBOX[portal.regionKeys[0]] ?? null) : null
  return candidates.map((candidate) => ({
    candidate,
    verdict: evaluatePoiCandidate(candidate, { bbox }),
  }))
}

/**
 * Повторный запуск production-адаптера портала по ПОЛНОМУ корпусу.
 *
 * Тот же адаптер, что и в обычном прогоне, и та же оценка — иначе повторный
 * набор кандидатов сравнивать не с чем. `limit` здесь отсутствует не по
 * умолчанию, а по контракту: план его не несёт, воспроизвести его нечем.
 */
export async function rerunPortalCandidates(portal, { adapters = ADAPTERS } = {}) {
  const adapter = adapters[portal.adapter]
  if (!adapter) {
    throw new Error(`${portal.id}: адаптер «${portal.adapter}» не реализован — повторить прогон нечем`)
  }
  const { candidates } = await adapter(portal, { limit: null })
  return evaluatePortalCandidates(portal, candidates)
}

async function runPortal(
  portal,
  args,
  adapters = ADAPTERS,
  planNow = null,
  providerProfile = null,
  discoveryAdapters = DISCOVERY_ADAPTERS,
) {
  /* Ветвление ДО evaluatePortalCandidates и до всего остального.
     Ниже по функции идут оценка кандидатов, дедуп, сверка с базой и сборка
     writable — ни одно из этого к discovery-записи не применимо, и попасть
     туда она не должна даже случайно. */
  const discoveryAdapter = discoveryAdapters[portal.adapter]
  if (discoveryAdapter) {
    const startedDiscovery = Date.now()
    const { discovery, meta } = await discoveryAdapter(portal, { limit: args.limit })
    return {
      portalReport: {
        portalId: portal.id,
        mode: 'discovery',
        ms: Date.now() - startedDiscovery,
        meta,
        discovery,
      },
      planFragment: null,
    }
  }

  const adapter = adapters[portal.adapter]
  if (!adapter) {
    return {
      portalReport: { portalId: portal.id, skipped: `адаптер «${portal.adapter}» ещё не реализован` },
      planFragment: null,
    }
  }

  const started = Date.now()
  const { candidates, meta } = await adapter(portal, { limit: args.limit })
  const evaluated = evaluatePortalCandidates(portal, candidates)

  /* Дедуп идёт по всему, что ещё может стать POI. Отклонённое по качеству,
     исключённое таксономией и уехавшее в чужой каталог в нём не участвует:
     это не наши записи, и совпадения с ними ничего не значат. */
  const STILL_OURS = new Set([TERMINAL.POI_ELIGIBLE, TERMINAL.AWAITING, TERMINAL.NEEDS_REVIEW])
  const { kept, collisions } = dedupeWithinBatch(
    evaluated.filter((e) => STILL_OURS.has(e.verdict.terminal)).map((e) => e.candidate),
  )

  /* Файл существующих POI прочитан и проверен в main() — ДО модели, записи,
     мониторинга и создания артефакта. Сюда приезжает уже проверенный массив.
     Отсутствие проверенного массива при заданном `--existing` — ошибка кода,
     а не данных: молча подставить пустой список значило бы вернуть тот самый
     fail-open, ради которого проверка и заведена. */
  if (args.existing !== null && !Array.isArray(args.existingRecords)) {
    throw new Error(
      '--existing задан, но файл не был проверен до прогона. Это ошибка порядка в коде, '
      + 'а не свойство входа: сверка с базой не выполняется по непроверенному файлу.',
    )
  }
  const existing = args.existingRecords ?? []
  const againstBase = existing.length
    ? kept.map((c) => ({ candidate: c, match: matchAgainstExisting(c, existing) }))
    : []

  /* Очереди по ТЕРМИНАЛЬНОМУ ИСХОДУ, а не по оценке качества. Раньше корзины
     строились на `decision`, который смотрел на факт совпадения шаблона и
     объявлял import вокзалу, рёкану и башне: маршрут реестра в это условие не
     входил. Отчёт, дедуп и счётчики были неверны, а фактическую запись
     останавливал только legacy-мост слоем ниже — случайная страховка. */
  const outcomes = Object.fromEntries(Object.values(TERMINAL).map((key) => [key, []]))
  for (const item of evaluated) {
    if (!outcomes[item.verdict.terminal]) {
      throw new Error(`Неизвестный терминальный исход ${item.verdict.terminal}`)
    }
    outcomes[item.verdict.terminal].push(item)
  }

  /* Исход по ключу: нужен очереди коллизий, чтобы называть фактическое
     состояние кандидата в новой модели, а не старую корзину import/review. */
  const terminalByKey = new Map(evaluated.map((e) => [e.candidate.sourceKey, e.verdict.terminal]))

  const queue = (key) =>
    outcomes[key].map(({ candidate, verdict }) => ({
      sourceKey: candidate.sourceKey,
      nameJa: candidate.nameJa,
      entityKind: verdict.classification?.entityKind ?? null,
      poiPrimaryType: verdict.classification?.poiPrimaryType ?? null,
      intakeDisposition: verdict.classification?.intakeDisposition ?? null,
      catalogTarget: verdict.classification?.catalogTarget ?? null,
      excludeReason: verdict.classification?.excludeReason ?? null,
      routeRuleId: verdict.classification?.routeRuleId ?? null,
      classificationSource: verdict.classification?.classificationSource ?? null,
      reason: verdict.terminalReason,
    }))

  // Записывать можно только то, что таксономия направила в POI И что прошло
  // дедуп внутри партии. Пересечение по sourceKey: списки хранят разные объекты.
  const eligibleKeys = new Set(
    outcomes[TERMINAL.POI_ELIGIBLE].map((e) => e.candidate.sourceKey),
  )

  // Город берётся из самой выгрузки, а не из реестра порталов.
  //
  // Раньше слаг ставился как единственный regionKey портала, а у Киото их
  // два («kyoto» и «uji») — слаг выходил пустым, и канон честно отверг все
  // 584 записи с «не указан город». Но и починить это подстановкой одного
  // из ключей было бы неверно: выгрузка идёт по ПРЕФЕКТУРЕ, и в ней лежит
  // всё от самого Киото до деревень Тангоского полуострова.
  // Коллизии дедупа, попавшие именно в корзину import. Общий счётчик
  // collisions смешивает import и review, и по нему нельзя ответить, куда
  // делись кандидаты корзины: 11.08.2026 из 381 import в трёх исходах
  // нашлось 377, а четыре просто исчезли.
  const poiDeduped = collisions.filter((c) => eligibleKeys.has(c.candidate.sourceKey))

  const outsideRegion = []
  const cityUnresolved = []
  const writable = kept
    .filter((c) => eligibleKeys.has(c.sourceKey))
    .filter((c) => {
      // Город берётся из выделенной колонки, а если её нет — из склеенного
      // адреса. У Осаки 所在地_市区町村 объявлена в заголовке и пуста во всех
      // 2012 строках: адрес целиком лежит в 所在地_連結表記. Пока разбирали
      // только колонку, все 381 кандидата корзины import отсеивались как
      // «вне региона», а сводка при этом рапортовала autoImportable: 381.
      // Три источника сразу, ни один не главнее по факту непустоты.
      // «中央区» в колонке при адресе в Осаке — это Осака, а не Токио.
      const place = resolveSiteCity({
        prefecture: c.prefectureJa,
        city: c.cityJa,
        address: c.address,
      })
      c.prefectureJa = c.prefectureJa || place.prefecture || null
      c.municipalityJa = place.municipality || null
      c.wardJa = place.ward || null

      // МУНИЦИПАЛИТЕТ НЕ РАСПОЗНАН — это не то же самое, что «вне региона».
      // Второе значит «знаем где, туда не едем»; первое — «не знаем где».
      // Догадаться по префектуре нельзя: 東京都 покрывает и Сибую, и острова
      // Огасавара в тысяче километров от неё. Такие идут человеку.
      if (!place.municipality) {
        cityUnresolved.push({
          sourceKey: c.sourceKey, nameJa: c.nameJa,
          cityJa: c.cityJa ?? null, address: c.address ?? null,
          conflict: place.conflict, reason: place.reason,
        })
        return false
      }

      // Место вне маршрутных городов портала. Это не брак данных — просто
      // туда никто не поедет, и в базе такая точка будет только мешать
      // поиску дублей и подбору под интересы гостя.
      if (!place.siteCity || !portal.regionKeys.includes(place.siteCity)) {
        outsideRegion.push({
          sourceKey: c.sourceKey,
          nameJa: c.nameJa, municipality: place.municipality, slug: place.siteCity || null,
        })
        return false
      }
      c.siteCity = place.siteCity
      return true
    })

  // ИНВАРИАНТ СУММЫ. Каждый кандидат корзины import обязан иметь ровно один
  // терминальный исход: запись, география, человек или дедуп. Пока проверки
  // не было, потеря четырёх записей выглядела как ничто — сводка сходилась
  // «на глаз», потому что складывать было нечего.
  const eligibleTerminal = writable.length + outsideRegion.length + cityUnresolved.length + poiDeduped.length
  if (eligibleTerminal !== eligibleKeys.size) {
    throw new Error(
      `Очередь poiEligible не сходится: ${eligibleKeys.size} кандидатов, терминальных исходов ${eligibleTerminal} `
      + `(writable ${writable.length} + география ${outsideRegion.length} + человек ${cityUnresolved.length} `
      + `+ дедуп ${poiDeduped.length}). Потерянные кандидаты означают, что часть выгрузки исчезла без следа.`,
    )
  }

  /* ФИНАЛЬНОЕ РЕШЕНИЕ. canAutoImport считается здесь и только здесь — по той
     же функции, что отобрала portal.writable. Раньше он стоял на вердикте
     кандидата, то есть до географии и дедупа: 336 объектов назывались
     автоимпортируемыми там, где до записи доходит 116. */
  const writableSet = new Set(writable.map((c) => c.sourceKey))
  const dedupedSet = new Set(poiDeduped.map((c) => c.candidate.sourceKey))
  const outsideSet = new Set(outsideRegion.map((r) => r.sourceKey))
  const unresolvedSet = new Set(cityUnresolved.map((r) => r.sourceKey))
  const finalDecision = (item) => poiWritableDecision({
    terminal: item.verdict.terminal,
    municipalityResolved: !unresolvedSet.has(item.candidate.sourceKey),
    insideRegion: !outsideSet.has(item.candidate.sourceKey),
    deduped: dedupedSet.has(item.candidate.sourceKey),
  })
  const autoImportKeys = new Set(
    evaluated.filter((item) => finalDecision(item).writable).map((item) => item.candidate.sourceKey),
  )
  if (autoImportKeys.size !== writableSet.size
    || [...autoImportKeys].some((key) => !writableSet.has(key))) {
    throw new Error(
      `canAutoImport разошёлся с portal.writable: ${autoImportKeys.size} против ${writableSet.size}. `
      + 'Условие обязано быть одно.',
    )
  }

  /* ГЛОБАЛЬНЫЙ ИНВАРИАНТ. Каждый кандидат обязан попасть ровно в один
     терминальный исход. needs_review, exclude и маршрут в чужой каталог
     writable называться не могут — раньше могли. */
  const outcomeTotal = Object.values(outcomes).reduce((sum, list) => sum + list.length, 0)
  if (outcomeTotal !== evaluated.length) {
    throw new Error(
      `Терминальные исходы не сходятся: кандидатов ${evaluated.length}, разложено ${outcomeTotal}.`,
    )
  }

  /* ПОЛНЫЙ ФИНАЛЬНЫЙ ИНВАРИАНТ. Раскладка poiEligible на четыре реальных
     исхода плюс остальные очереди обязана дать ровно число выгруженных
     записей. Именно эта сумма показывает, что «336 автоимпортируемых» было
     арифметически невозможно: до записи доходит только часть. */
  const finalTally = {
    poiWritable: writable.length,
    outsideRegion: outsideRegion.length,
    cityUnresolved: cityUnresolved.length,
    poiDeduped: poiDeduped.length,
    classificationNeedsReview: outcomes[TERMINAL.NEEDS_REVIEW].length,
    excludedByTaxonomy: outcomes[TERMINAL.EXCLUDED].length,
    routedElsewhere: outcomes[TERMINAL.ROUTED_ELSEWHERE].length,
    awaitingClassification: outcomes[TERMINAL.AWAITING].length,
    qualityRejected: outcomes[TERMINAL.QUALITY_REJECTED].length,
  }
  const finalTotal = Object.values(finalTally).reduce((a, b) => a + b, 0)
  if (finalTotal !== candidates.length) {
    throw new Error(
      `Финальная арифметика не сходится: выгружено ${candidates.length}, разложено ${finalTotal} — `
      + Object.entries(finalTally).map(([k, v]) => `${k} ${v}`).join(', '),
    )
  }

  const rejectReasons = {}
  for (const item of outcomes[TERMINAL.QUALITY_REJECTED]) {
    for (const reason of item.verdict.blockingReasons.length
      ? item.verdict.blockingReasons
      : ['below_threshold']) {
      rejectReasons[reason] = (rejectReasons[reason] ?? 0) + 1
    }
  }

  // Раскладка по КОДАМ реестра, а не по старым русским ярлыкам. Записи,
  // где шаблон совпал, но однозначного типа у него нет, считаются отдельно:
  // это очередь к человеку, а не «не определилось».
  const categories = {}
  for (const item of evaluated) {
    const c = item.verdict.classification
    const key = !c
      ? '(правила не разобрали)'
      : (c.poiPrimaryType ?? `${c.entityKind}/${c.intakeDisposition}`)
    categories[key] = (categories[key] ?? 0) + 1
  }

  const byKey = new Map(evaluated.map((e) => [e.candidate.sourceKey, e]))

  const sample = (items) =>
    items.slice(0, args.samples).map(({ candidate, verdict }) => ({
      name: candidate.nameJa,
      city: candidate.cityJa,
      entityKind: verdict.classification?.entityKind ?? null,
      poiPrimaryType: verdict.classification?.poiPrimaryType ?? null,
      intakeDisposition: verdict.classification?.intakeDisposition ?? null,
      score: verdict.score,
      coords: Number.isFinite(candidate.lat) ? [candidate.lat, candidate.lon] : null,
      blockers: verdict.blockingReasons,
      signals: verdict.signals
        .filter((s) => s.score !== 0)
        .map((s) => `${s.kind}:${s.code}:${s.score}`),
    }))

  const portalReport = {
    portalId: portal.id,
    label: portal.label,
    licence: portal.licence,
    source: meta,
    durationMs: Date.now() - started,
    // Финальная раскладка: сумма обязана равняться fetched, и это проверено
    // выше, а не «на глаз».
    finalTally,
    totals: {
      fetched: candidates.length,
      // Терминальные исходы таксономии. Старых корзин import/review/reject
      // здесь больше нет: они строились на смешанной категории, которую
      // реестр как раз и заменяет.
      // poiEligible — прошли таксономию и качество; poiWritable — ещё и
      // географию с дедупом. Второе и есть то, что уйдёт в запись.
      poiEligible: outcomes[TERMINAL.POI_ELIGIBLE].length,
      /* Раскладка НЕ переписывается второй раз, а разворачивается та же
         самая, чью сумму проверил инвариант. Две копии счётчиков разошлись бы
         молча — и первая же правка одной из них это и сделала бы. */
      ...finalTally,
      // Ровно portal.writable.length: инвариант выше это и проверяет.
      autoImportable: autoImportKeys.size,
      /* Общий счётчик коллизий, а не терминальный: он считает ВСЕ совпадения
         внутри партии, включая те, что и так не дошли бы до записи. Терминальный
         poiDeduped приходит из finalTally выше и здесь не повторяется — как и
         outsideRegion с cityUnresolved. */
      dedupedWithinBatch: collisions.length,
      matchedExistingBase: againstBase.filter((r) => r.match.verdict !== 'new').length,
      // Сколько записей придётся отдать LLM на категоризацию — прямая
      // оценка счёта за прогон.
      needsLlmCategory: outcomes[TERMINAL.AWAITING].length,
      // Записи, у которых часы/цена пришли из устаревшей выгрузки.
      // Импортировать можно, публиковать эти поля — нет.
      volatileFieldsUnverified: evaluated.filter(
        (e) => e.verdict.terminal !== TERMINAL.QUALITY_REJECTED && e.verdict.volatileFieldsUnverified,
      ).length,
    },
    rejectReasons,
    categories,
    // Стоимость AI-обработки считается по фактическому корпусу этого
    // прогона, а не по средней оценке «примерно столько-то за точку».
    aiCost: estimateCascadeCost(evaluated),
    samples: {
      poiEligible: sample(outcomes[TERMINAL.POI_ELIGIBLE]),
      classificationNeedsReview: sample(outcomes[TERMINAL.NEEDS_REVIEW]),
      excludedByTaxonomy: sample(outcomes[TERMINAL.EXCLUDED]),
      routedElsewhere: sample(outcomes[TERMINAL.ROUTED_ELSEWHERE]),
      qualityRejected: sample(outcomes[TERMINAL.QUALITY_REJECTED]),
    },
    /* Полные очереди, а не только примеры: по каждой видно sourceKey,
       маршрут, правило реестра и причину. */
    queues: {
      poiEligible: queue(TERMINAL.POI_ELIGIBLE),
      classificationNeedsReview: queue(TERMINAL.NEEDS_REVIEW),
      excludedByTaxonomy: queue(TERMINAL.EXCLUDED),
      routedElsewhere: queue(TERMINAL.ROUTED_ELSEWHERE),
      awaitingClassification: queue(TERMINAL.AWAITING),
    },
    // Полные списки, а не только примеры: на вопрос «почему эта точка не
    // прошла» нужно уметь отвечать без перезапуска прогона.
    outsideRegionSample: outsideRegion.slice(0, 20),
    // Неразобранная или противоречивая география — очередь к человеку.
    // Полный список уходит в --out: двадцати строк для разбора мало, а
    // в консоли от него остаётся счётчик, иначе сводка нечитаема.
    cityUnresolvedSample: cityUnresolved.slice(0, 20),
    cityUnresolvedQueue: cityUnresolved,
    // Полная очередь коллизий: что с чем сошлось и по каким признакам.
    collisionQueue: buildCollisionQueue(collisions, terminalByKey),
    // Кандидаты корзины import, пережившие дедуп внутри партии. Именно их
    // берёт --write; в stdout не печатаются, иначе консоль тонет.
    writable: writable.map((c) => ({
      sourceKey: c.sourceKey,
      nameJa: c.nameJa,
      // Чтение каной — главный вход для имени. В базу оно не попадает,
      // это промежуточная запись звучания: иероглифы читать нечем, а
      // английского названия японские открытые данные часто не дают
      // вовсе (у Осаки колонка объявлена и пуста во всех 2012 строках).
      nameKana: c.nameKana ?? '',
      nameEn: c.nameEn ?? '',
      cityJa: c.cityJa ?? '',
      // Полный адрес нужен человеку при разборе: по одним координатам не
      // отличить филиал от головного объекта и тёзку от тёзки, а карта
      // открывается по точке, которая у обоих одна.
      address: c.address ?? '',
      // Административные части — отдельно от туристического слага:
      // Site City это направление продукта, а не тип территории.
      prefectureJa: c.prefectureJa ?? '',
      municipalityJa: c.municipalityJa ?? '',
      wardJa: c.wardJa ?? '',
      lat: Number.isFinite(c.lat) ? c.lat : null,
      lon: Number.isFinite(c.lon) ? c.lon : null,
      workingHours: c.workingHours ?? '',
      website: c.website ?? '',
      // Классификация правилами: коды реестра и уже вычисленный маршрут.
      // Старое русское значение сюда не едет — сравнение «до/после» делает
      // baseline-файл, а не вторая колонка в этом отчёте.
      entityKind: byKey.get(c.sourceKey)?.verdict.classification?.entityKind ?? null,
      poiPrimaryType: byKey.get(c.sourceKey)?.verdict.classification?.poiPrimaryType ?? null,
      intakeDisposition: byKey.get(c.sourceKey)?.verdict.classification?.intakeDisposition ?? null,
      classificationSource: byKey.get(c.sourceKey)?.verdict.classification?.classificationSource ?? null,
      // Фасеты и версия реестра едут в запись ВМЕСТЕ с типом (10f-P, P04.3):
      // без них выход классификации терялся между отчётом и writer'ом молча.
      facets: byKey.get(c.sourceKey)?.verdict.classification?.facets ?? [],
      taxonomyVersion: byKey.get(c.sourceKey)?.verdict.classification?.taxonomyVersion ?? null,
      // Слаг проставлен выше по японскому названию муниципалитета.
      siteCity: c.siteCity ?? '',
    })),
    all: evaluated.map(({ candidate, verdict }) => ({
      sourceKey: candidate.sourceKey,
      nameJa: candidate.nameJa,
      lat: candidate.lat,
      lon: candidate.lon,
      workingHours: candidate.workingHours,
      website: candidate.website,
      qualityVerdict: verdict.qualityVerdict,
      terminal: verdict.terminal,
      terminalReason: verdict.terminalReason,
      score: verdict.score,
      entityKind: verdict.classification?.entityKind ?? null,
      poiPrimaryType: verdict.classification?.poiPrimaryType ?? null,
      intakeDisposition: verdict.classification?.intakeDisposition ?? null,
      classificationSource: verdict.classification?.classificationSource ?? null,
      blockers: verdict.blockingReasons,
      volatileFieldsUnverified: verdict.volatileFieldsUnverified,
    })),
  }

  /* P1. План строится ЗДЕСЬ, а не над отчётом: в portals[].all нет
     descriptionJa, и план, собранный из отчёта, дал бы маркер «поля нет»
     вместо значения — молча и с другим digest. Считается после инвариантов
     раскладки: план по неразложенному корпусу не имеет смысла. */
  const planFragment = planNow
    ? buildPortalPlanFragment({ portal, evaluated, now: planNow, providerProfile })
    : null

  return { portalReport, planFragment }
}

/** Диффует прогон с предыдущим снимком — это и есть режим мониторинга. */
/**
 * Сравнимы ли политики матчера двух отчётов. Прежний отчёт без записи о
 * политике — снят ДО её появления: сравнивать исходы с ним честно нельзя, и
 * это называется отдельным значением, а не тишиной.
 */
function matcherPolicyComparison(current, previous) {
  const cur = current.matcherPolicy ?? null
  const prev = previous.matcherPolicy ?? null
  if (!prev) return { comparable: false, reason: 'прежний отчёт не несёт политики матчера' }
  if (!cur) return { comparable: false, reason: 'текущий отчёт не несёт политики матчера' }
  if (cur.version !== prev.version || cur.digest !== prev.digest) {
    return {
      comparable: false,
      reason: `политика матчера изменилась: ${prev.version} (${String(prev.digest).slice(0, 19)}…) → `
        + `${cur.version} (${String(cur.digest).slice(0, 19)}…)`,
    }
  }
  return { comparable: true, reason: null }
}

function diffAgainstSnapshot(current, previous) {
  /* Смена terminal между прогонами читается двумя способами: изменились
     данные источника — либо изменилось НАШЕ решение. Пока политика одна и та
     же, второе исключено, и смена terminal честно называется переменой в
     данных. Когда политики разные, смена terminal переходит в отдельный
     список decisionDrift: приписать её источнику значило бы врать о нём. */
  const policy = matcherPolicyComparison(current, previous)
  const prevByKey = new Map()
  for (const portal of previous.portals ?? []) {
    for (const row of portal.all ?? []) prevByKey.set(row.sourceKey, row)
  }
  const curByKey = new Map()
  for (const portal of current.portals ?? []) {
    for (const row of portal.all ?? []) curByKey.set(row.sourceKey, row)
  }

  const added = []
  const removed = []
  const changed = []
  const decisionDrift = []

  for (const [key, row] of curByKey) {
    const before = prevByKey.get(key)
    if (!before) {
      added.push({ sourceKey: key, nameJa: row.nameJa, terminal: row.terminal })
      continue
    }
    const fields = []
    if ((before.workingHours ?? '') !== (row.workingHours ?? '')) {
      fields.push({ field: 'workingHours', from: before.workingHours, to: row.workingHours })
    }
    if ((before.website ?? '') !== (row.website ?? '')) {
      fields.push({ field: 'website', from: before.website, to: row.website })
    }
    if (before.terminal !== row.terminal) {
      if (policy.comparable) {
        fields.push({ field: 'terminal', from: before.terminal, to: row.terminal })
      } else {
        decisionDrift.push({ sourceKey: key, nameJa: row.nameJa, from: before.terminal, to: row.terminal })
      }
    }
    if (fields.length) changed.push({ sourceKey: key, nameJa: row.nameJa, fields })
  }
  for (const [key, row] of prevByKey) {
    if (!curByKey.has(key)) {
      // Пропал из выгрузки — возможное закрытие. Автоматически ничего не
      // архивируем: сначала человек смотрит список.
      removed.push({ sourceKey: key, nameJa: row.nameJa })
    }
  }

  return {
    comparedWith: previous.startedAt ?? null,
    matcherPolicy: {
      comparable: policy.comparable,
      reason: policy.reason,
      previous: previous.matcherPolicy ?? null,
      current: current.matcherPolicy ?? null,
    },
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    /* Смены terminal при РАЗНЫХ политиках. Не входят в changed: это не
       перемена в данных, а перемена в решении, и она считается отдельно. */
    decisionDrift: decisionDrift.length,
    details: {
      added: added.slice(0, 50),
      removed: removed.slice(0, 50),
      changed: changed.slice(0, 50),
      decisionDrift: decisionDrift.slice(0, 50),
    },
  }
}


/**
 * Очередь коллизий дедупа: что с чем сошлось, по каким признакам и в каком
 * состоянии находится сам кандидат.
 *
 * Вынесена отдельно и без замыканий намеренно. Прежняя версия строилась прямо
 * в сборщике отчёта и ссылалась на переменную, удалённую при переходе на
 * терминальные исходы: профильные тесты этого не заметили, потому что ветку
 * не исполняли, а падало бы на первом же прогоне с непустым дедупом.
 *
 * Поле называется candidateTerminal, а не bucket: корзин import и review
 * больше нет, и придумывать их обратно ради формата очереди незачем.
 *
 * @param collisions      [{ candidate, against, reasons }]
 * @param terminalByKey   Map<sourceKey, terminal>
 */
export function buildCollisionQueue(collisions, terminalByKey) {
  return collisions.map((c) => ({
    sourceKey: c.candidate.sourceKey,
    nameJa: c.candidate.nameJa,
    candidateTerminal: terminalByKey.get(c.candidate.sourceKey) ?? null,
    againstSourceKey: c.against?.sourceKey ?? null,
    againstNameJa: c.against?.nameJa ?? null,
    reasons: c.reasons ?? [],
  }))
}

/**
 * Запись прогона в базу — единственным разрешённым способом.
 *
 * Ничего не решает сама: собирает запросы и отдаёт их ingestPoiBatch.
 * Канон, идемпотентность по Source Key, поиск дублей и родителя, выбор
 * полей — всё там. Здесь только перевод кандидата источника в форму запроса
 * и разбор ответов по корзинам.
 */
export async function writeRun(report, args, deps = {}) {
  /* Зависимости подставляются КАЖДАЯ СВОЯ и по отдельности. Признаком
     «тестового режима» ни одна из них не служит: подстановка хранилища не
     смеет молча выключить опознание места, иначе отчёт напишет «ключа Google
     нет» там, где его никто и не спрашивал. Ровно на этом обжёгся Telegram-путь
     (см. комментарий к options.store в poi-intake.ts).

     РЕЗОЛВЕР ОБЯЗАН БЫТЬ НАЗВАН ЯВНО, и это не педантизм. Пока эта функция
     собирала его сама из `process.env`, любой её вызов уносил ключ из
     подхваченного `.env.local` в живой Google Places — включая вызов из
     `npm test`. Платный запрос из набора тестов не должен быть возможен по
     устройству, а не по осторожности автора фикстуры. Значение `null` —
     законный ответ («ключа нет»), отсутствие ключа в `deps` — ошибка кода. */
  if (!('placeResolver' in deps)) {
    throw new Error(
      'writeRun вызван без deps.placeResolver. Резолвер места называет вызывающий: '
      + 'production-точка входа собирает его из ключа, тест подставляет свой. '
      + 'Умолчания из окружения здесь нет — оно означало бы платный запрос из тестового прогона.',
    )
  }
  const placeResolver = deps.placeResolver
  const now = deps.now instanceof Date ? deps.now : new Date()
  /* РЕШЕНИЯ ВЛАДЕЛЬЦА О КООРДИНАТАХ — реестр под git, читается loader'ом без
     аргументов. Канала в `deps` НЕТ (10f-P R1, находка 1): подставить свой
     реестр вызывающий не может; тест композиции идёт в песочнице-копии дерева
     с фикстурным файлом по каноническому пути. Негодный реестр бросает здесь —
     до первого платного обращения. */
  const coordinateDecisions = loadCoordinateDecisions()
  /* PREFLIGHT. Маршрут проверяется по ВСЕМ входным строкам до чтения файла
     имён, до поиска имени, до транслитерации и до очереди unnamed. Раньше
     проверка стояла внутри цикла построения запросов, то есть уже после всей
     работы с именами: комментарий обещал «до», а код делал «после». */
  const inbound = report.portals.flatMap((portal) =>
    (portal.writable ?? []).map((row) => ({ portal, row })),
  )
  const notRouteToPoi = inbound
    .filter(({ row }) => !isRouteToPoi(row))
    .map(({ row }) => ({
      sourceKey: row.sourceKey,
      nameJa: row.nameJa,
      entityKind: row.entityKind ?? null,
      poiPrimaryType: row.poiPrimaryType ?? null,
      classificationSource: row.classificationSource ?? null,
    }))
  if (notRouteToPoi.length) {
    const sample = notRouteToPoi
      .slice(0, 10)
      .map((r) => `  ${r.sourceKey} «${r.nameJa}» — ${r.entityKind ?? '?'} / ${r.poiPrimaryType ?? 'без типа'} / ${r.classificationSource ?? '?'}`)
      .join('\n')
    throw new Error(
      `В запись пришло ${notRouteToPoi.length} строк из ${inbound.length}, которые реестр не маршрутизирует `
      + `в POI. Отбор в writable и повторная проверка разошлись — запись остановлена до чтения имён.\n${sample}`,
    )
  }
  /* ПРЕДСТАВИМОСТЬ ТАКСОНОМИИ — тем же preflight, по всем строкам и той же
     функцией, которой writer собирает поля (10f-P, P04.3). Отчёт, собранный
     под прошлой версией реестра, несёт коды прошлой версии: он останавливает
     весь прогон здесь, а не половину пакета в ingestPoi. */
  const taxonomyBlocked = inbound
    .map(({ row }) => ({
      row,
      verdict: taxonomyRecordFields({
        poiPrimaryType: row.poiPrimaryType,
        facets: row.facets ?? [],
        classificationSource: row.classificationSource,
        taxonomyVersion: row.taxonomyVersion,
      }),
    }))
    .filter(({ verdict }) => !verdict.ok)
  if (taxonomyBlocked.length) {
    const sample = taxonomyBlocked
      .slice(0, 10)
      .map(({ row, verdict }) => `  ${row.sourceKey} «${row.nameJa}» — ${verdict.issues.join('; ')}`)
      .join('\n')
    throw new Error(
      `Таксономия ${taxonomyBlocked.length} строк из ${inbound.length} не представима в схеме POI `
      + `(чужой код, источник или версия реестра). Запись остановлена до чтения имён.\n${sample}`,
    )
  }

  const { names, stats: nameStats } = await loadNames(args.names)
  const usedNameKeys = new Set()
  /* Черновики запросов, ещё БЕЗ места. Опознание идёт отдельной стадией ниже:
     весь контракт вызова обязан быть проверен до первой сети, а резолвер —
     это сеть и деньги. */
  const pending = []
  const unnamed = []
  /* Старое поле категории в Airtable умеет говорить только по-русски. Мост
     переводит код реестра в старое значение ТОЛЬКО там, где перевод точен;
     где старое значение шире или уже нового кода — возвращает null. Подобрать
     ближайшее значило бы вернуть ту самую смесь, ради разбора которой
     заводился реестр.

     До 10f-P непереводимый код останавливал запись: старое поле было
     ЕДИНСТВЕННЫМ носителем типа. Теперь тип едет кодом в `POI Type`, а старое
     поле — переходный мост для фильтров сайта (потребитель № 4 не начат):
     где перевод точен — заполняется, где нет — остаётся пустым, строка идёт
     в очередь отчёта и в Notes записи. Это не тихая потеря: пустое старое
     поле при заполненном `POI Type` читается как «мост не выражает», а не
     «не заполнили». */
  const legacyCategoryMissing = []

  for (const portal of report.portals) {
    for (const row of portal.writable ?? []) {
      // Имя из файла главнее машинного: если владелец уже выбрал форму,
      // транслитератор её не переписывает.
      // Три источника имени, по убыванию надёжности:
      //   1. --names   — владелец уже выбрал форму, она главнее всего;
      //   2. кана      — чтение из источника, прямой Поливанов;
      //   3. английское название — перевод, годится хуже: теряет звучание
      //      («Golden Pavilion» вместо «Кинкакудзи») и тащит заимствования.
      const named = names[row.sourceKey] ?? {}
      if (names[row.sourceKey]) usedNameKeys.add(row.sourceKey)
      let auto = null
      if (!named.nameRu && row.nameKana) auto = poiNameFromKana(row.nameJa, row.nameKana)
      // Английское имя из файла — такой же источник, как английское из
      // выгрузки, и он надёжнее: его выбрал человек. Пока учитывался только
      // row.nameEn, запись с nameEn в файле и без nameRu уходила в очередь
      // «имя не собралось», хотя собрать его было из чего.
      const englishSource = named.nameEn || row.nameEn
      if (!named.nameRu && !auto?.nameRu && englishSource) auto = poiNameToRu(englishSource)
      const nameRu = named.nameRu || auto?.nameRu || ''
      /* Имя и направление вычисляются ОДИН РАЗ и идут сразу в двух адресах:
         в запрос и в опознание места. Два независимых выражения одного и того
         же значения разошлись бы молча — и место опознавалось бы под именем
         выгрузки, а записывалось под именем из файла владельца. */
      const nameEnForRecord = named.nameEn || row.nameEn || ''
      const siteCityForRecord = named.siteCity || row.siteCity
      const sourcePointOk = Number.isFinite(row.lat) && Number.isFinite(row.lon)

      // Имени нет вовсе — это значит, что у источника не было английского
      // названия, а иероглифы транслитерировать нечем: нужна кана, которой
      // в выгрузке нет. Такие уходят в очередь, а не заводятся безымянными.
      if (!nameRu) {
        unnamed.push({
          sourceKey: row.sourceKey,
          nameJa: row.nameJa,
          nameEn: row.nameEn,
          reason: (auto?.warnings ?? []).join('; ')
            || (row.nameKana || row.nameEn ? 'имя не собралось' : 'нет ни чтения каной, ни английского названия'),
        })
        continue
      }
      const legacyCategory = legacyAirtableCategory(row.poiPrimaryType)
      if (!legacyCategory.value) {
        legacyCategoryMissing.push({
          sourceKey: row.sourceKey,
          nameJa: row.nameJa,
          poiPrimaryType: row.poiPrimaryType ?? null,
          reason: legacyCategory.reason,
        })
      }

      pending.push({
        subject: {
          contractVersion: PORTAL_PLACE_SUBJECT_SPEC,
          sourceKey: row.sourceKey,
          nameEn: nameEnForRecord,
          /* Японское имя — главный ключ поиска: у японских открытых данных
             английского названия нет вовсе. */
          nameJa: row.nameJa ?? '',
          siteCity: siteCityForRecord,
          prefectureJa: row.prefectureJa ?? '',
          /* Точка источника — предпочтение поиска и диагностика тождества, не
             данные для записи. Только полная конечная пара. */
          sourceLat: sourcePointOk ? row.lat : null,
          sourceLon: sourcePointOk ? row.lon : null,
        },
        request: {
          source: {
            kind: 'portal-collector',
            id: portal.portalId,
            // sourceKey из адаптера уже вида «<портал>:<id>», а buildSourceKey
            // приклеит id портала ещё раз. Снимаем префикс, иначе Source Key
            // выйдет «bodik-osaka:bodik-osaka:123» и идемпотентность сломается
            // при первом же переименовании портала.
            externalKey: row.sourceKey.startsWith(`${portal.portalId}:`)
              ? row.sourceKey.slice(portal.portalId.length + 1)
              : row.sourceKey,
            url: portal.source?.url ?? undefined,
          },
          poi: {
            nameRu,
            machineNamed: !named.nameRu,
            sourceName: [row.nameJa, row.nameKana].filter(Boolean).join(' / ') || row.nameEn,
            nameWarnings: auto?.warnings,
            nameEn: nameEnForRecord || undefined,
            siteCity: siteCityForRecord,
            categoriesRu: legacyCategory.value ? [legacyCategory.value] : [],
            // Канонические поля таксономии — из строки отчёта, той же формы,
            // что проверена preflight'ом выше; writer проверит её ещё раз.
            taxonomy: {
              poiPrimaryType: row.poiPrimaryType,
              facets: row.facets ?? [],
              classificationSource: row.classificationSource,
              taxonomyVersion: row.taxonomyVersion,
            },
            openQuestions: legacyCategory.value
              ? undefined
              : [`старое поле категории не выражает тип ${row.poiPrimaryType}: ${legacyCategory.reason}`],
            workingHours: row.workingHours,
            website: row.website || undefined,
            // Координат источника здесь НЕТ. Широту и долготу прислал тот же
            // вызывающий, что и всё остальное, и проверить их нечем; точка
            // приходит от резолвера ниже — иначе `exactObjectPoint` подтверждал
            // бы происхождение соседним полем, а не самой координатой.
            // Описание НЕ приходит ни из источника, ни из файла имён: тексты
            // пишутся свои, а право на переиспользование чужих не даёт ни один
            // из восьми порталов. Часы и описания в контракт файла имён не
            // входят и обрабатываются своими конвейерами. Пока writeRun читал
            // отсюда workingHours и descriptionRu, код обещал две разные формы
            // файла сразу: схема разрешала одно, чтение допускало другое.
            sources: portal.source?.url ? [portal.source.url] : undefined,
          },
          },
      })
    }
  }

  // ПОКРЫТИЕ ПРОВЕРЯЕТСЯ ЗДЕСЬ — до раннего возврата, до создания store и
  // до ingestPoiBatch. Раньше проверка стояла в конце, и обе ветки её
  // обходили: при нуле собранных имён функция возвращалась раньше, а при
  // части собранных запись в production успевала пройти, и о несовпадении
  // файла узнавали уже после неё.
  const nameCoverage = describeNameCoverage(nameStats, usedNameKeys, names)
  assertNameCoverage(nameCoverage)

  if (legacyCategoryMissing.length) {
    console.error(
      `[poi-portals] старое поле категории не выражает ${legacyCategoryMissing.length} из ${pending.length} строк; `
      + 'тип записан кодом в POI Type, старое поле пусто — см. write.legacyCategoryMissingQueue',
    )
  }

  /* ── ОПОЗНАНИЕ МЕСТА ────────────────────────────────────────────────────
     Первая сеть этой функции — здесь, и ни строкой выше. Всё, что можно было
     отвергнуть по контракту вызова (маршрут реестра, покрытие файла имён,
     представимость категории), уже отвергнуто: платить за работу, которая
     заведомо не понадобится, незачем.

     Кандидат идёт через ТОТ ЖЕ канонический `resolvePlace`, что и путь
     Telegram. Отказ — именованный, и он терминальный: кандидат в запись не
     попадает, хранилище по нему не создаётся и не опрашивается вовсе. Ровно
     это и есть разница между «место не опознали» и «завели запись без места»,
     которую портальный путь до сих пор не делал. */
  if (pending.length && !placeResolver) {
    console.error(
      `[poi-portals] резолвер места не задан: ${pending.length} кандидатов останутся `
      + 'без опознанного места и в запись не пойдут',
    )
  }
  /* ХРАНИЛИЩЕ СОЗДАЁТСЯ ДО ОПОЗНАНИЯ МЕСТА — и это про деньги, а не про порядок
     ради порядка. Пока проверка `Source Key` жила только внутри `ingestPoi`,
     каждая уже принятая строка успевала оплатить обращение к Google и вдобавок
     оседала в `placeUnresolved`, так и не получив своего `already_ingested`.
     Второго источника истины здесь нет: ключ считает тот же `buildSourceKey`,
     а `findBySourceKey` у обоих хранилищ обслуживается тем же кэшем, который
     потом возьмёт `ingestPoiBatch`, — лишнего чтения базы не появляется. */
  const snapshot = args.baseSnapshot ? await loadBaseSnapshot(args.baseSnapshot) : null
  const store = deps.store ?? (snapshot
    ? createSnapshotStore(snapshot.rows)
    : createAirtablePoiStore({
        token: process.env.AIRTABLE_TOKEN?.trim(),
        baseId: process.env.AIRTABLE_BASE_ID?.trim() || 'apppwhjFN82N9zNqm',
        dryRun: args.dryWrite,
      }))

  /* СХЕМА — ДО ПЕРВОГО ЧТЕНИЯ БАЗЫ, ДО РЕЗОЛВЕРА И ДО ПЕРВОЙ ЗАПИСИ. Хранилище,
     умеющее показать живую схему, обязано показать четыре поля таксономии в
     форме реестра; иначе значения ушли бы в несуществующие поля, и Airtable
     ответил бы отказом на первой записи — после оплаченных обращений к
     резолверу. Снимок базы схемы не имеет, и для него проверка честно
     названа пропущенной, а не пройденной. */
  /* Тот же сторож, что и в ingestPoiBatch, только раньше — до чтения базы
     и до резолвера. Ветка «схемы нет» открыта только хранилищу в памяти по
     тождеству фабрики; всё остальное отдаёт живую схему, и writer сверяет её
     сам (10f-P R2, находка 1). */
  const taxonomySchema = await ensureTaxonomySchemaForWrite(store, true)

  const alreadyIngested = new Set()
  for (const item of pending) {
    const key = buildSourceKey(item.request.source)
    if (!key) continue
    if (await store.findBySourceKey(key)) alreadyIngested.add(item)
  }
  const freshCount = pending.length - alreadyIngested.size

  /* БЮДЖЕТ — ДО ПЕРВОГО ЗАПРОСА. Считается по числу НОВЫХ строк: платить
     собираемся только за них. Превышение останавливает весь прогон, а не
     обрезает хвост молча: обрезанный прогон выглядит как полный. */
  if (placeResolver && args.maxPlaceLookups !== null && freshCount > args.maxPlaceLookups) {
    throw new Error(
      `Бюджет обращений к резолверу места превышен: новых строк ${freshCount}, `
      + `лимит --max-place-lookups=${args.maxPlaceLookups}. Прогон остановлен до первого запроса. `
      + `Уже принятых по Source Key: ${alreadyIngested.size} — они в бюджет не входят.`,
    )
  }

  const requests = []
  const placeUnresolved = []
  const decidedCoordinates = []
  const decisionRejected = []
  let placeLookups = 0
  let refusedBeforeLookup = 0
  for (const item of pending) {
    const { subject, request } = item
    /* Уже принятая строка к резолверу не идёт вовсе, но терминальный исход
       получает от production-приёма: `ingestPoi` ответит `already_ingested`
       раньше политики координат. Свой второй вердикт мы здесь не выносим. */
    if (alreadyIngested.has(item)) {
      requests.push(request)
      continue
    }
    /* РЕШЕНИЕ ВЛАДЕЛЬЦА — ДО РЕЗОЛВЕРА. Объект, у которого по решению нет
       одной точки (`notApplicable`) или точка названа человеком
       (`representativePoint`), к Google не идёт: точность резолвера ему не
       нужна и не оплачивается. Точка берётся из решения либо остаётся пустой;
       точка источника в запись не попадает и здесь же показана в отчёте.
       Согласие решения с записываемой парой перепроверяет `ingestPoi` тем же
       `classifyCoordinatePolicy`, что и машинный вывод, — второго вердикта
       коллектор не выносит. */
    const decision = coordinateDecisions.get(buildSourceKey(request.source))
    if (decision) {
      /* ПРЕДМЕТ РЕШЕНИЯ СВЕРЯЕТСЯ ДО ПРИМЕНЕНИЯ. Ключ строки у части порталов
         нестабилен (row-N): после перестановки под тем же ключом стоит другой
         объект. Решение о другом объекте — терминальный отказ строки, а не
         «решения нет» и не путь через резолвер: применить его значило бы
         перенести решение владельца на чужой POI. ingestPoi сверяет то же ещё
         раз по собранной записи. */
      const subjectVerdict = coordinateDecisionSubjectVerdict(decision.subject, {
        siteCity: request.poi.siteCity,
        nameJa: subject.nameJa,
        nameEn: subject.nameEn,
        nameRu: request.poi.nameRu,
      })
      if (!subjectVerdict.ok) {
        decisionRejected.push({
          sourceKey: subject.sourceKey,
          nameRu: request.poi.nameRu,
          decisionRef: decision.decisionRef,
          refusal: 'decisionSubjectMismatch',
          mismatched: subjectVerdict.mismatched,
          message: `решение ${decision.decisionRef} найдено по ключу, но описывает другой объект (не совпало: ${subjectVerdict.mismatched.join(', ')})`,
        })
        continue
      }
      decidedCoordinates.push({
        sourceKey: subject.sourceKey,
        nameRu: request.poi.nameRu,
        decision: decision.decision,
        decisionRef: decision.decisionRef,
        sourceLat: subject.sourceLat,
        sourceLon: subject.sourceLon,
      })
      requests.push({
        ...request,
        poi: {
          ...request.poi,
          ...(decision.point ? { lat: decision.point.lat, lon: decision.point.lon } : {}),
          openQuestions: [
            ...(request.poi.openQuestions ?? []),
            `координаты по решению владельца ${decision.decisionRef}: ${decision.decision}`,
          ],
        },
      })
      continue
    }
    /* Обращения считаются на самом вызове, а не по числу кандидатов: часть
       отказов граница выносит ДО обращения — слаг вне справочника, резолвера
       нет, — и записывать их в оплаченные было бы неправдой. */
    const lookupsBefore = placeLookups
    const counting = placeResolver
      ? async (query) => { placeLookups += 1; return placeResolver(query) }
      : null
    const place = await resolvePortalPlace(subject, { resolver: counting, now })
    if (!place.ok && placeLookups === lookupsBefore) refusedBeforeLookup += 1
    if (!place.ok) {
      placeUnresolved.push({
        sourceKey: subject.sourceKey,
        nameRu: request.poi.nameRu,
        nameEn: subject.nameEn,
        siteCity: subject.siteCity,
        refusal: place.refusal,
        message: place.message,
        /* Что сказал сам резолвер. Без этой строки «Place ID не появился»
           неотличимо от «его молча потеряли по дороге». */
        resolverReason: place.reason,
      })
      continue
    }
    requests.push({
      ...request,
      poi: {
        ...request.poi,
        lat: place.lat,
        lon: place.lon,
        resolved: place.resolved,
        /* Дописывается, а не заменяет: строка могла принести свой вопрос
           (например, что старое поле категории не выражает её тип). */
        openQuestions: [...(request.poi.openQuestions ?? []), place.reason],
      },
    })
  }

  /* ИНВАРИАНТ СУММЫ. Каждая строка, дошедшая до записи, обязана иметь ровно
     один терминальный исход: запись, отсутствие имени или неопознанное место.
     Пока проверки не было, потеря строки выглядела как ничто. */
  const writeTerminal = requests.length + unnamed.length + placeUnresolved.length + decisionRejected.length
  if (writeTerminal !== inbound.length) {
    throw new Error(
      `Запись не сходится: на входе ${inbound.length} строк, терминальных исходов ${writeTerminal} `
      + `(запросы ${requests.length} + без имени ${unnamed.length} + место не опознано ${placeUnresolved.length} `
      + `+ решение о другом предмете ${decisionRejected.length}).`,
    )
  }

  const placeSummary = {
    /* Объявленный лимит, фактически выполненные обращения, пропущенные как уже
       принятые и отказанные до обращения — четыре разных числа. Одним счётчиком
       их не заменить: «ноль обращений» одинаково читается и как «всё уже в базе»,
       и как «резолвер не задан». */
    placeBudget: {
      limit: args.maxPlaceLookups,
      performed: placeLookups,
      skippedAlreadyIngested: alreadyIngested.size,
      /* Строки с решением владельца о координатах: резолвер им не нужен. */
      skippedByCoordinateDecision: decidedCoordinates.length,
      refusedBeforeLookup,
    },
    placeLookups,
    /* Решения владельца, применённые в этом прогоне: какая строка, какое
       решение, чья ссылка, и какая точка источника при этом НЕ записана. */
    coordinateDecisions: {
      ledgerSize: coordinateDecisions.size,
      applied: decidedCoordinates.length,
      appliedQueue: decidedCoordinates.slice(0, 200),
      /* Решение по ключу найдено, но предмет не совпал: строка остановлена,
         резолвер не вызван, запись не создана. */
      rejected: decisionRejected.length,
      rejectedQueue: decisionRejected.slice(0, 200),
    },
    placeUnresolved: placeUnresolved.length,
    /* Раскладка по ИМЕНОВАННЫМ причинам: без неё «ноль записей» одинаково
       читается и как «ключа Google нет», и как «источник врёт про города». */
    placeRefusals: placeUnresolved.reduce((acc, row) => {
      acc[row.refusal] = (acc[row.refusal] ?? 0) + 1
      return acc
    }, {}),
    placeUnresolvedQueue: placeUnresolved.slice(0, 200),
    /* Схема таксономии: проверена ли живая схема перед записью и чем. */
    taxonomySchema,
    /* Старое поле категории: сколько строк оно не выражает. Тип у них
       записан кодом; здесь — что именно и почему осталось пустым. */
    legacyCategoryMissing: legacyCategoryMissing.length,
    legacyCategoryMissingQueue: legacyCategoryMissing.slice(0, 200),
  }

  if (!requests.length) {
    return {
      attempted: 0, names: nameCoverage,
      unnamed: unnamed.length, unnamedQueue: unnamed.slice(0, 200), outcomes: {},
      ...placeSummary,
    }
  }

  const results = await ingestPoiBatch(requests, store)

  const outcomes = {}
  const created = []
  const blocked = []
  for (const [i, r] of results.entries()) {
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1
    if (r.outcome === 'created') created.push(`${r.poiId} «${requests[i].poi.nameRu}»`)
    else if (r.outcome !== 'already_ingested') {
      blocked.push(`${requests[i].poi.nameRu} → ${r.explanation}`)
    }
  }

  return {
    attempted: requests.length,
    names: nameCoverage,
    unnamed: unnamed.length,
    unnamedQueue: unnamed.slice(0, 200),
    ...placeSummary,
    outcomes,
    created: created.slice(0, 100),
    notCreated: blocked.slice(0, 100),
    // Что именно этот снимок способен проверить. Без счётчиков «ноль
    // already_ingested» читается как «дублей нет», хотя может означать
    // «в снимке ни у одной записи нет ключа источника».
    baseSnapshot: snapshot ? { file: args.baseSnapshot, ...snapshot.stats } : null,
  }
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TAXONOMY_REL = 'config/poi-taxonomy.v2.json'
const PLAN_TTL_DAYS = 7
const PLAN_TTL_MS = PLAN_TTL_DAYS * 24 * 60 * 60 * 1000

/**
 * Читающее обращение к Git идёт с глобальной опцией, и только ПЕРЕД подкомандой.
 *
 * `git status` может выполнить необязательный refresh индекса и создать под
 * него `.git/index.lock`. Если среда не может удалить созданный lock после
 * завершения команды, читающая проверка оставляет его в репозитории, и
 * следующая запись в индекс упирается в границу, созданную самой проверкой
 * границ. `--no-optional-locks` запрещает именно этот необязательный refresh.
 * Флаг не обезвреживает уже существующий lock — это разные вещи, и одно
 * другим не заменяется.
 *
 * Позиция не косметическая: опция глобальная, и после подкоманды Git отвергает
 * её как неизвестную — `git status --no-optional-locks` завершается кодом 129
 * с `unknown option` (проверено на git 2.34.1).
 */
const GIT_READ_ONLY = '--no-optional-locks'

/**
 * Идентичность исполняемого кода для привязки плана.
 *
 * Untracked-файлы намеренно исключены: XLSX и черновики владельца лежат в
 * рабочем дереве постоянно и к исполняемому коду отношения не имеют.
 * Изменённые ОТСЛЕЖИВАЕМЫЕ файлы — другое дело: при них hash коммита кода
 * не описывает, и план, привязанный к такому отпечатку, хуже отсутствующего —
 * он выглядит проверяемым, не будучи им.
 */
/**
 * Идентичность кода настоящим Git. Экспортируется, потому что preflight обязан
 * снимать её ТЕМ ЖЕ способом: две реализации одного чтения разошлись бы молча,
 * а разошлись бы они на том, к чему привязан план.
 */
export function resolveCodeIdentityFromGit() {
  const run = (argv) =>
    execFileSync('git', [GIT_READ_ONLY, ...argv], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  return { commit: run(['rev-parse', 'HEAD']), dirty: run(['status', '--porcelain', '--untracked-files=no']).length > 0 }
}

/**
 * ФЛАГИ РЕЖИМА ИСПОЛНЕНИЯ — закрытый список, и сверяется он с ФАКТИЧЕСКИ
 * переданными флагами, а не с получившимися значениями.
 *
 * Прежняя редакция сравнивала значения с умолчаниями `parseArgs`, и на этом
 * ловилось не всё: `--samples 8` ставит ровно умолчание, разницы в значениях
 * нет, и флаг проходил в режим исполнения незамеченным. Аудит предъявил именно
 * этот вход. Теперь смотрим на то, что человек написал в командной строке.
 *
 * Список РАЗРЕШЁННОГО, а не перечень запрещённого: следующий флаг таблицы по
 * умолчанию несовместим, и чтобы это изменить, придётся написать это явно.
 * Сторож в наборе требует, чтобы каждый разобранный флаг был классифицирован —
 * либо здесь, либо в списке несовместимых; новый флаг без решения роняет набор.
 */
export const EXECUTION_MODE_FLAGS = Object.freeze([
  '--model-execute', '--model-plan-file', '--model-approval', '--help', '-h',
])

function assertExecutionModeIsolated(args) {
  const mixed = args.seenFlags.filter((flag) => !EXECUTION_MODE_FLAGS.includes(flag))
  if (mixed.length) {
    /* Повторы схлопываются: «несовместим с --limit, --limit» ничего не
       добавляет, а порядок сохраняется — он тот, в котором их написали. */
    const named = [...new Set(mixed)]
    throw new Error(
      `--model-execute несовместим с ${named.join(', ')}: исполнение идёт по подписанному плану, `
      + 'а сбор, discovery и режимы записи исполняют другой конвейер. Совмещать их нечем.',
    )
  }
}

/** Несовместимость режимов. Проверяется до любого ввода-вывода. */
function assertModeCompatibility(args) {
  if (args.modelExecute) {
    assertExecutionModeIsolated(args)
    if (args.planFileName === null || args.approvalFileName === null) {
      const missing = [
        args.planFileName === null ? '--model-plan-file' : null,
        args.approvalFileName === null ? '--model-approval' : null,
      ].filter(Boolean)
      throw new Error(
        `--model-execute требует ${missing.join(' и ')}: план и разрешение — предмет исполнения, `
        + 'и подставлять их умолчанием нечем.',
      )
    }
    return
  }
  if (args.planFileName !== null || args.approvalFileName !== null) {
    const orphan = args.planFileName !== null ? '--model-plan-file' : '--model-approval'
    throw new Error(
      `${orphan} имеет смысл только с --model-execute: вне режима исполнения читать план `
      + 'и разрешение незачем.',
    )
  }
  if (args.providerProfileRef !== null && !args.modelPlan) {
    throw new Error(
      '--model-provider-profile имеет смысл только с --model-plan: вне планового режима '
      + 'профиль не к чему прикреплять, а прогон он не исполняет.',
    )
  }
  /* Исполняемый план и --limit несовместимы. Ограничение корпуса в привязанный
     контракт плана не входит, поэтому повторный запуск адаптеров в preflight
     воспроизвести его не может: он получил бы другой набор кандидатов и объявил
     расхождение там, где его нет. Отказ fail-closed дешевле новой версии плана
     ради одного диагностического параметра. */
  if (args.providerProfileRef !== null && args.limit !== null) {
    throw new Error(
      '--model-provider-profile несовместим с --limit: ограничение корпуса не входит в привязанный '
      + 'план, и повторный запуск источников его не воспроизведёт. Исполняемый план строится '
      + 'по полному корпусу портала.',
    )
  }
  if (!args.modelPlan) return
  const conflict = args.baseSnapshot ? '--base-snapshot' : args.dryWrite ? '--dry-write' : args.write ? '--write' : null
  if (conflict) {
    throw new Error(
      `--model-plan несовместим с ${conflict}: план ничего не исполняет и не пишет, `
      + 'а режимы записи исполняют production Intake. Совмещать их нечем.',
    )
  }
}

/**
 * Идентичность кода: форма, чистота и — при повторе — неизменность.
 *
 * Проверяется дважды: до первого адаптера и после завершения порталов, до
 * чтения таксономии и отпечатка. Между этими точками идёт выгрузка, и если за
 * это время рабочее дерево изменилось, привязывать план не к чему: отпечаток уже не
 * описывает код, который его построил.
 */
function assertCleanCodeIdentity(codeIdentity, when, previous = null) {
  assertCodeIdentity(codeIdentity)
  if (codeIdentity.dirty) {
    throw new Error(
      `--model-plan: ${when} отслеживаемое рабочее дерево изменено, commit ${codeIdentity.commit} `
      + 'исполняемый код не описывает. План привязывается к идентичности кода, '
      + 'и одним отпечатком нельзя описать два разных состояния.',
    )
  }
  if (previous && previous.commit !== codeIdentity.commit) {
    throw new Error(
      `--model-plan: идентичность кода изменилась во время прогона — было ${previous.commit}, `
      + `стало ${codeIdentity.commit}. План не сохраняется.`,
    )
  }
  return codeIdentity
}

/** Портал, до которого дойдёт адаптер: и поддержан, и не пропущен. */
function isSelectablePortal(portal, adapters, discoveryAdapters = DISCOVERY_ADAPTERS) {
  return Boolean(adapters[portal.adapter] || discoveryAdapters[portal.adapter])
    && portal.licence?.factExtraction === true
    && portal.robots?.allowsUs !== false
    && portal.enabled !== false
}

/**
 * ГЛОБАЛЬНЫЙ P0 — один раз, до первого адаптера, вне per-portal try/catch.
 *
 * Смысл глобальности: битая policy второго портала обязана остановить
 * прогон ДО того, как первый успел сходить в сеть. Проверка в начале
 * runPortal этого не даёт.
 */
/**
 * Разрешение профиля по каноническому реестру. Ровно `id@version`, ровно один
 * разделитель: `id@1.0.0@x` и `id` без версии — отказ, а не догадка.
 *
 * Возвращает `null`, когда флага нет: тогда строится прежний диагностический
 * план v1.
 */
function resolveRequestedProfile(ref) {
  if (ref === null) return null
  if (typeof ref !== 'string' || ref.split('@').length !== 2) {
    throw new Error(
      `--model-provider-profile: ожидается ровно «id@version», получено ${JSON.stringify(ref)}`,
    )
  }
  const [id, version] = ref.split('@')
  /* Единственный путь к профилю — канонический реестр. Подставить свой список
     нечем: параметра для этого у резолвера нет. */
  return resolveProviderProfile(id, version)
}

/**
 * Границы discovery-портала. Проверяется ПЕРВЫМ и до первого сетевого запроса.
 *
 * Discovery-обход не производит кандидатов, не строит writable, не вызывает
 * ingestPoiBatch и Airtable и не участвует в плане модели. Поэтому любой
 * режим записи или планирования, ЗАТРАГИВАЮЩИЙ такой портал, отказывает
 * глобально — а не пропускает его молча внутри цикла. Молчаливый пропуск
 * выглядел бы как успешный прогон, в котором просто ничего не записалось.
 */
export function assertDiscoveryBoundary({ args, portals, discoveryAdapters = DISCOVERY_ADAPTERS }) {
  const discovery = portals.filter((portal) => discoveryAdapters[portal.adapter])
  if (!discovery.length) return
  const forbidden = []
  if (args.baseSnapshot) forbidden.push('--base-snapshot')
  else if (args.dryWrite) forbidden.push('--dry-write')
  else if (args.write) forbidden.push('--write')
  if (args.modelPlan) forbidden.push('--model-plan')
  if (args.providerProfileRef !== null) forbidden.push('--model-provider-profile')
  if (args.names !== null) forbidden.push('--names')
  if (args.existing !== null) forbidden.push('--existing')
  /* Сравнивать полный снимок с ограниченным нельзя: объекты за пределом
     выглядели бы исчезнувшими. Проверка стоит здесь, а не в общей
     совместимости режимов, чтобы не менять поведение порталов, которых
     это не касается. */
  if (args.monitor !== null && args.limit !== null) {
    throw new Error(
      '--monitor несовместим с --limit для discovery-портала: ограниченный обход не является снимком, '
      + 'и сравнение объявило бы исчезнувшими все объекты за пределом.',
    )
  }
  if (!forbidden.length) return
  throw new Error(
    `${forbidden.join(', ')}: несовместимо с discovery-порталом `
    + `${discovery.map((portal) => portal.id).join(', ')}. `
    + 'Discovery-обход собирает неподтверждённые подсказки, а не кандидатов в POI: '
    + 'записывать, сверять с базой и планировать по ним нечего.',
  )
}

function assertGlobalPreflight({
  args, portals, selectedPortals, adapters,
  discoveryAdapters = DISCOVERY_ADAPTERS,
  /* Корень артефактов — ОДИН на производителя и потребителя плана. Пока
     писатель проверял границу от `REPO_ROOT`, а читатель получал корень
     параметром, композицию «построили → прочитали» нельзя было исполнить
     нигде, кроме настоящего репозитория: писать было можно только туда.
     Умолчание production-путь не двигает. */
  repoRoot = REPO_ROOT,
}) {
  /* Первым — до assertIdentity, до разрешения профиля и до первого адаптера. */
  assertDiscoveryBoundary({ args, portals, discoveryAdapters })
  const ids = selectedPortals.map((portal) => portal.id)
  assertIdentity(ids, [...new Set(ids)], 'portalId выбранных порталов')

  if (!args.modelPlan) return

  if (AWAITING_TERMINAL !== TERMINAL.AWAITING) {
    throw new Error(
      `Расхождение контрактов: model-plan ждёт исход «${AWAITING_TERMINAL}», `
      + `реестр исходов отдаёт «${TERMINAL.AWAITING}».`,
    )
  }
  /* Форма policy проверяется у ВЫБРАННЫХ порталов, а не у всего реестра:
     битая запись источника, до которого этот прогон не дойдёт, останавливать
     его не должна. Полноту реестра — валидную deny-policy у всех двенадцати —
     проверяет профильный тест, а не рантайм. */
  for (const portal of selectedPortals) assertPolicyShape(portal)

  /* Профиль разрешается ЗДЕСЬ — до первого адаптера и до writer'а.
     Канонический профиль и таблица цены объявлены, поэтому пара
     `id@version` теперь может разрешиться. Разрешение профиля — не вызов
     модели: этот прогон строит локальный план и только его.
     `executionPermitted` остаётся false, пока policy источника запрещает
     обработку; исполнитель ни одним production-путём не вызывается;
     approval в репозитории отсутствует, и реальных журналов исполнения не
     существует. Проверяет всё перечисленное tests/poi-model-reachability.mjs. */
  const providerProfile = resolveRequestedProfile(args.providerProfileRef)

  const unsupported = portals.filter((portal) => !adapters[portal.adapter]
    && portal.licence?.factExtraction === true
    && portal.robots?.allowsUs !== false
    && portal.enabled !== false)
  if (unsupported.length) {
    throw new Error(
      `--model-plan: у порталов ${unsupported.map((p) => p.id).join(', ')} адаптер не реализован. `
      + 'План по порталу, который не выгружается, построить не из чего.',
    )
  }
  if (!selectedPortals.length) throw new Error('--model-plan: не выбрано ни одного портала')
  if (!args.out) {
    throw new Error(`--model-plan требует --out: отчёт и исполняемый конверт плана хранятся в ${PLAN_DIR_REL}/`)
  }
  /* Граница выходного файла целиком: каталог, расширение и занятость пути.
     Здесь, до первого адаптера, — потому что все три причины известны
     заранее и ни одна не требует выгрузки. Конверт — вторым файлом того же
     прогона, той же границей: занятое имя конверта останавливает прогон до
     адаптера так же, как занятое имя отчёта. */
  const insideDir = path.join(repoRoot, PLAN_DIR_REL)
  assertExclusiveJsonTarget(args.out, { insideDir })
  assertExclusiveArtifactTarget(envelopePathFor(args.out), { insideDir, names: ARTIFACT_NAMES.planEnvelope })
  return providerProfile
}

export async function main(argv = process.argv, deps = {}) {
  const adapters = deps.adapters ?? ADAPTERS
  const discoveryAdapters = deps.discoveryAdapters ?? DISCOVERY_ADAPTERS
  const injectedNow = deps.now ?? null
  const resolveCodeIdentity = deps.resolveCodeIdentity ?? resolveCodeIdentityFromGit
  const persistReport = deps.persistReport ?? writeJsonReport
  const args = parseArgs(argv)
  if (args.help) {
    console.log(helpText())
    return
  }

  /* Снимок базы читается и проверяется ПЕРВЫМ — до реестра порталов, до
     адаптера и до любой сети. Нарушение его формы известно заранее, и
     узнавать о нём после выгрузки в две тысячи строк незачем. Ошибка летит
     наружу: перехват здесь означал бы прогон против снимка, который не
     годится. */
  assertModeCompatibility(args)

  /* ── РЕЖИМ ИСПОЛНЕНИЯ — ПЕРВЫМ И ОТДЕЛЬНО ────────────────────────────────
     До реестра порталов, до снимка базы, до отчёта и до первого адаптера.
     Порядок не косметический: исполнение идёт по ПОДПИСАННОМУ плану, и
     собранный здесь отчёт к нему отношения не имеет — а собранный до отказа
     ворот выглядел бы как работа, которой не было.

     Сеть, секрет и журнал не трогаются ни на одной ветке отказа: их трогает
     транспорт внутри исполнителя, и только после того, как preflight принял
     все свои ворота. Возвращается результат исполнителя КАК ЕСТЬ — вместе с
     его кодом возврата, который процессу выставляет запуск внизу файла. */
  if (args.modelExecute) {
    const result = await runModelExecution({
      repoRoot: deps.repoRoot ?? REPO_ROOT,
      planFileName: args.planFileName,
      approvalFileName: args.approvalFileName,
      adapters,
      /* Портал берётся из ТОГО ЖЕ реестра, что и обычный прогон. «Портала
         нет» приходит значением, а не исключением: preflight обязан назвать
         это отдельным исходом ворот, а не упасть чужой ошибкой. */
      resolvePortal: (portalId) => ALL_SOURCES.find((portal) => portal.id === portalId) ?? null,
      rerunPortal: (portal, options) => rerunPortalCandidates(portal, options),
      resolveCodeIdentity,
      /* Часы отдают канонический момент строкой — той же формы, что читает
         исполнитель перед каждой записью журнала. */
      now: deps.now ? () => deps.now : () => new Date().toISOString(),
      request: deps.request ?? PRODUCTION_HTTPS_REQUEST,
      env: deps.env ?? process.env,
      promptText: CLASSIFY_SYSTEM_PROMPT,
      schemaObject: CLASSIFY_SCHEMA,
    })
    console.log(JSON.stringify({
      modelExecution: {
        state: result.state,
        exitCode: result.exitCode,
        executionId: result.preflight?.executionId ?? null,
        gates: result.preflight?.gates ?? null,
        failure: result.preflight?.failure ?? null,
        reportPath: result.reportPath ?? null,
      },
    }, null, 2))
    return { modelExecution: result }
  }

  if (args.baseSnapshot) {
    const { stats } = await loadBaseSnapshot(args.baseSnapshot)
    console.error(
      `[poi-portals] снимок базы ${args.baseSnapshot}: ${stats.total} записей, `
      + `с ключом источника ${stats.withSourceKey}, с координатами ${stats.withCoords}, `
      + `с городом ${stats.withSiteCity}, с place_id ${stats.withPlaceId}`,
    )
    if (!stats.withSourceKey) {
      console.error(
        '[poi-portals] ни одна запись снимка не несёт ключа источника — '
        + 'гейт идемпотентности на этом снимке ничего не найдёт по определению',
      )
    }
  }

  /* Read-only --all включает и discovery-порталы: отчёт по ним строится
     рядом с обычными. Любой режим записи с ними в наборе отказывает выше, в
     assertDiscoveryBoundary, до первого сетевого запроса. */
  const portals = args.all
    ? activePortals().filter((p) => adapters[p.adapter] || discoveryAdapters[p.adapter])
    : [getPortal(args.portal ?? 'bodik-osaka-tourism')]

  const selectedPortals = portals.filter((portal) => isSelectablePortal(portal, adapters, discoveryAdapters))
  const providerProfile = assertGlobalPreflight({
    args, portals, selectedPortals, adapters, discoveryAdapters, repoRoot: deps.repoRoot ?? REPO_ROOT,
  })
  /* Идентичность кода проверяется ДО первого адаптера: узнавать о грязном
     дереве после выгрузки в две тысячи строк незачем. */
  const codeIdentityBefore = args.modelPlan ? assertCleanCodeIdentity(resolveCodeIdentity(), 'до прогона') : null

  /* Файл существующих POI читается и проверяется ЗДЕСЬ: после границы
     discovery — она запрещает `--existing` для discovery-порталов, и её
     сообщение точнее, — но до отчёта, до первого адаптера, до модели, до
     записи, до мониторинга и до создания артефакта. Ошибка летит наружу:
     перехват здесь означал бы сверку с базой по файлу, который для неё
     не годится. Проверенный массив кладётся в args и дальше только читается. */
  const existingBase = await loadExistingBase(args.existing)
  if (existingBase.stats) console.error(describeExistingBase(existingBase.stats))
  args.existingRecords = existingBase.records

  const report = {
    /* Момент создания отчёта — здесь и только здесь, как было до появления
       планового режима. Инъекция времени в тестах production-путь не двигает. */
    startedAt: (injectedNow ?? new Date()).toISOString(),
    dryRun: true,
    /* ПОЛИТИКА МАТЧЕРА — В ОТЧЁТЕ, версией и отпечатком. Терминальные исходы
       ниже зависят от её порогов; без этой записи два прогона с разным исходом
       по одной строке не различают «изменились данные» и «изменилось наше
       решение». Читает это `diffAgainstSnapshot` (--monitor). */
    matcherPolicy: { version: MATCHER_POLICY_VERSION, digest: matcherPolicyDigest() },
    portals: [],
  }
  const planFragments = []
  const planNow = args.modelPlan ? (injectedNow ?? new Date()) : null

  for (const portal of portals) {
    // Коллектор пишет в базу ФАКТЫ, не чужой текст. Поэтому пропуск по
    // factExtraction, а не по праву на переиспользование текста: последнее
    // не разрешает ни один из зафиксированных источников, и это нормально —
    // русские тексты пишутся свои.
    if (portal.licence?.factExtraction !== true) {
      report.portals.push({
        portalId: portal.id,
        skipped: `извлечение фактов не разрешено однозначно: ${portal.licence?.factExtraction ?? 'не определено'}`,
      })
      continue
    }
    if (portal.robots?.allowsUs === false || portal.enabled === false) {
      report.portals.push({
        portalId: portal.id,
        skipped: `исключён: ${portal.blockedReason ?? 'robots'}`,
      })
      continue
    }
    try {
      const { portalReport, planFragment } = await runPortal(
        portal, args, adapters, planNow, providerProfile, discoveryAdapters,
      )
      /* Присоединение одной точкой и только после полного успешного
         завершения портала: наполовину собранного портала в отчёте нет. */
      report.portals.push(portalReport)
      if (planFragment) planFragments.push(planFragment)
    } catch (error) {
      /* В плановом режиме ошибка любого выбранного портала проваливает весь
         режим: частичный план хуже отсутствующего — он выглядит полным. */
      if (args.modelPlan) throw error
      report.portals.push({ portalId: portal.id, error: error.message })
      console.error(`[poi-portals] ${portal.id}: ${error.message}`)
    }
  }

  if (args.modelPlan) {
    /* Повторная проверка — после порталов и ДО чтения таксономии, отпечатка и
       сохранения. Порядок важен: план, привязанный к устаревшей идентичности,
       хуже отсутствующего. */
    const codeIdentity = assertCleanCodeIdentity(resolveCodeIdentity(), 'после прогона', codeIdentityBefore)
    /* Точные байты реестра таксономии читает оркестратор и передаёт вниз:
       model-plan.mjs файловой системы не касается и JSON не разбирает. */
    const taxonomyBytes = await readFile(path.join(REPO_ROOT, TAXONOMY_REL))
    report.modelPlan = buildModelPlan({
      fragments: planFragments,
      selectedPortalIds: selectedPortals.map((portal) => portal.id),
      meta: {
        planId: `plan-${randomUUID()}`,
        createdAt: planNow.toISOString(),
        deleteAfter: new Date(planNow.getTime() + PLAN_TTL_MS).toISOString(),
        codeIdentity,
        taxonomyVersion,
        taxonomyBytes,
        taxonomySpec: RAW_FILE_BYTES_SPEC,
        promptText: CLASSIFY_SYSTEM_PROMPT,
        schemaObject: CLASSIFY_SCHEMA,
        /* Разрешённый профиль или null. Модуль плана ему не доверяет: форму
           проверяет заново и отпечаток считает сам. */
        providerProfile,
      },
    })
  }

  if (args.write) {
    try {
      /* Единственное место, где ключ Google превращается в резолвер: это
         production-точка входа. Библиотечная функция окружение не читает. */
      const injectedResolver = 'placeResolver' in deps
      const placeResolver = injectedResolver
        ? deps.placeResolver
        : canonicalPortalPlaceResolver(process.env.GOOGLE_PLACES_API_KEY)
      /* Для PRODUCTION-резолвера бюджет обязателен. Подставленный резолвер
         денег не тратит, и требовать лимит от теста незачем; собранный из
         ключа тратит, и прогон без объявленного потолка — это прогон, у
         которого нет верхней границы счёта. */
      if (!injectedResolver && placeResolver && args.maxPlaceLookups === null) {
        throw new Error(
          'Резолвер места собран из GOOGLE_PLACES_API_KEY, но --max-place-lookups не задан. '
          + 'Платный прогон без объявленного потолка не запускается: укажите бюджет явно, '
          + 'например --max-place-lookups=20.',
        )
      }
      /* Стоимость называется там, где она известна: платит именно ЭТОТ
         резолвер, собранный из ключа. Подставленный резолвер о деньгах ничего
         не сообщает, и приписывать их ему было бы неправдой. `--dry-write`
         касается записи в Airtable и опознание места не отменяет. */
      if (!injectedResolver && placeResolver) {
        const candidates = report.portals.reduce((sum, portal) => sum + (portal.writable?.length ?? 0), 0)
        console.error(
          `[poi-portals] опознание места: до ${candidates} платных обращений к Google Places; `
          + '--dry-write их не отменяет',
        )
      }
      report.write = await writeRun(report, args, { ...deps, placeResolver })
      report.dryRun = Boolean(args.dryWrite)
    } catch (error) {
      report.write = { error: error.message }
      console.error(`[poi-portals] запись прервана: ${error.message}`)
    }
  }

  /* Причина, по которой прогон обязан завершиться ненулевым исходом.
     Присваивается здесь, а бросается ПОСЛЕ записи отчёта: снимок текущего
     прогона нужен человеку независимо от того, удалось ли сравнение. */
  let monitorFailure = null

  if (args.monitor) {
    const discoveryPortals = report.portals.filter((portalReport) => portalReport.mode === 'discovery')
    let previous = null
    try {
      previous = JSON.parse(await readFile(args.monitor, 'utf8'))
    } catch (error) {
      /* Негодный старый снимок — это отказ сравнения, а не строчка в
         отчёте. Для discovery он обязан быть виден исходом процесса:
         молчаливое «monitor.error» читается как «изменений нет». */
      if (discoveryPortals.length) {
        monitorFailure = `--monitor: снимок ${args.monitor} не читается или не разбирается: ${error.message}`
      }
      report.monitor = { error: `не удалось прочитать снимок: ${error.message}` }
    }
    if (previous) {
      report.monitor = diffAgainstSnapshot(report, previous)
      /* Отдельный диф для discovery. Общий diffAgainstSnapshot читает
         portal.all и сравнивает workingHours, website и terminal — у
         discovery-записи таких полей нет вовсе, и он молча вернул бы
         «изменений нет». Семантика, наблюдение и порядок разнесены. */
      const discoveryMonitor = {}
      for (const portalReport of report.portals) {
        if (portalReport.mode !== 'discovery') continue
        const before = (previous.portals ?? []).find(
          (row) => row.portalId === portalReport.portalId && row.mode === 'discovery',
        )
        const diff = diffDiscoverySnapshot(portalReport.discovery, before?.discovery ?? null)
        discoveryMonitor[portalReport.portalId] = diff
        if (!diff.comparable && !monitorFailure) {
          monitorFailure = `--monitor ${portalReport.portalId}: ${diff.refusal}`
        }
      }
      if (Object.keys(discoveryMonitor).length) report.discoveryMonitor = discoveryMonitor
    }
  }

  /* Режим записи выбирается здесь и передаётся явно: план не
     перезаписывается, обычный отчёт прогона — перезаписывается, как и до
     появления планового режима. */
  if (args.out) {
    await persistReport(args.out, report, { mode: args.modelPlan ? 'exclusive' : 'overwrite' })
  }
  /* ИСПОЛНЯЕМЫЙ КОНВЕРТ — ВТОРЫМ ФАЙЛОМ И ПОСЛЕ ОТЧЁТА. Отчёт — выгрузка
     данных источника и полномочий не несёт; исполняется только конверт:
     версия, отпечаток артефакта плана и сам подписанный план, ничего сверх.
     Порядок значим: конверт без отчёта — исполняемый артефакт без выгрузки, по
     которой его строили; отчёт без конверта всего лишь не исполняется. Тем же
     writer'ом и в том же эксклюзивном режиме: занятое имя — отказ. */
  if (args.modelPlan) {
    await persistReport(envelopePathFor(args.out), buildPlanEnvelope(report.modelPlan), {
      mode: 'exclusive',
      names: ARTIFACT_NAMES.planEnvelope,
    })
  }

  // В stdout — сводка без объёмных списков, иначе консоль тонет. Они уже
  // записаны в --out целиком; здесь от них остаются счётчики и примеры.
  // Поля удаляются с копии, а не отбрасываются деструктуризацией: та
  // заводит переменные, которыми никто не пользуется, и линтер справедливо
  // ругается на каждую.
  const BULKY_PORTAL_FIELDS = ['all', 'writable', 'cityUnresolvedQueue', 'collisionQueue', 'queues', 'discovery']
  const BULKY_WRITE_FIELDS = ['unnamedQueue', 'created', 'notCreated', 'placeUnresolvedQueue', 'legacyCategoryMissingQueue']
  const withoutFields = (source, fields) => {
    const copy = { ...source }
    for (const field of fields) delete copy[field]
    return copy
  }
  const summary = {
    ...report,
    portals: report.portals.map((portal) => withoutFields(portal, BULKY_PORTAL_FIELDS)),
    ...(report.write ? { write: withoutFields(report.write, BULKY_WRITE_FIELDS) } : {}),
  }
  console.log(JSON.stringify(summary, null, 2))

  /* После записи отчёта и печати сводки: отчёт сохранён, а исход прогона
     honest — сравнение не состоялось. */
  if (monitorFailure) throw new Error(monitorFailure)
}

// Запуск только как скрипт. Без этого импорт ради теста поднимал бы весь
// прогон: коллектор пошёл бы в сеть, а тест ждал бы портал.
/**
 * КОД ВОЗВРАТА ИСПОЛНИТЕЛЯ ДОХОДИТ ДО ПРОЦЕССА ТОЧНЫМ.
 *
 * Отказ ворот — не единица «что-то пошло не так»: у него свой номер, по
 * которому видно, на чём остановились. Превратить его в ноль значило бы
 * отчитаться успехом за прогон, который до модели не дошёл.
 *
 * Отдельной экспортируемой функцией, а не тремя строками внутри запуска: этот
 * же перевод обязан исполнять процессный набор, а копия условия в наборе
 * проверяла бы копию. `target` — не «тестовый режим», а тот объект, чей код
 * возврата выставляется; в production это `process`.
 */
export function applyModelExecutionExitCode(outcome, target = process) {
  if (outcome && typeof outcome.modelExecution?.exitCode === 'number') {
    target.exitCode = outcome.modelExecution.exitCode
  }
  return target.exitCode
}

/**
 * ЗАПУСК ЦЕЛИКОМ — ОДНОЙ PRODUCTION-ФУНКЦИЕЙ.
 *
 * Прежде тело запуска жило в блоке «если это точка входа»: три строки, до
 * которых не дотягивался ни один набор. Аудит показал цену — мутация
 * `applyModelExecutionExitCode(outcome)` → безусловный ноль проходила весь
 * набор целиком. Теперь и разбор, и перевод кода возврата, и перехват ошибки
 * живут здесь, а блок внизу только зовёт эту функцию. Набор исполняет ЕЁ, а не
 * свою копию её содержимого.
 *
 * `target` — не «тестовый режим», а тот объект, чей код возврата выставляется;
 * в production это `process`.
 */
export async function runCli(argv = process.argv, deps = {}, target = process) {
  try {
    const outcome = await main(argv, deps)
    return applyModelExecutionExitCode(outcome, target)
  } catch (thrown) {
    /* FAIL-CLOSED НА ЛЮБОМ БРОШЕННОМ ЗНАЧЕНИИ. Прежняя редакция читала
       `error.message` напрямую: `throw null` и `throw undefined` роняли сам
       перехват («Cannot read properties of null»), бросающий getter `message`
       и Proxy с бросающей или отозванной ловушкой выносили своё исключение
       мимо перехвата наружу — процесс завершался не кодом 1, а необработанным
       отказом, и «отказ обработан» переставало быть правдой ровно на том
       входе, ради которого перехват написан.

       Поэтому здесь ни `error.message`, ни `String(error)`, ни `instanceof`,
       ни единого чтения свойства у unknown: описание даёт общий
       `describeThrownSafely` — та же процедура, что стоит на границе
       резолвера и портала, а не её копия. Код возврата выставляется ДО
       печати: печать — тоже действие, и отказать в ней вправе, а код
       возврата обязан быть выставлен в любом случае. */
    target.exitCode = 1
    const described = describeThrownSafely(thrown)
    try {
      console.error(`[poi-portals] ${described}`)
    } catch {
      /* Печать отказала — код возврата уже выставлен, и это единственное,
         что перехват обязан гарантировать. */
    }
    return target.exitCode
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
