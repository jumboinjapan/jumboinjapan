import nextEnv from '@next/env'
import { importJapanTravelEvents } from '../src/lib/japantravel-events.ts'
import { JAPAN_TRAVEL_IMPORT_DEFAULTS } from '../src/lib/japantravel-event-intake.ts'
import {
  archiveEndedJapanTravelEvents,
  reportRecurringJapanTravelCandidates,
} from '../src/lib/japantravel-event-maintenance.ts'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

function parseArgs(argv) {
  const args = {
    command: 'import',
    startPage: 1,
    maxPages: JAPAN_TRAVEL_IMPORT_DEFAULTS.pages,
    maxItems: undefined,
    dryRun: true,
    includeEnded: false,
    requestDelayMs: 250,
    maxFutureDays: undefined,
    maxPastGraceDays: undefined,
    endedBeforeDays: 0,
    recurringStatus: 'all',
  }

  const firstArg = argv[0]
  if (firstArg && !firstArg.startsWith('--')) {
    if (!['import', 'cleanup-ended', 'report-recurring'].includes(firstArg)) {
      throw new Error(`Unknown command: ${firstArg}`)
    }
    args.command = firstArg
    argv = argv.slice(1)
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--page' || arg === '--start-page') {
      args.startPage = Number(argv[index + 1] ?? '1')
      index += 1
      continue
    }

    if (arg === '--pages' || arg === '--max-pages') {
      args.maxPages = Number(argv[index + 1] ?? '1')
      index += 1
      continue
    }

    if (arg === '--limit' || arg === '--max-items') {
      args.maxItems = Number(argv[index + 1] ?? '0')
      index += 1
      continue
    }

    if (arg === '--no-limit') {
      args.maxItems = null
      continue
    }

    if (arg === '--write') {
      args.dryRun = false
      continue
    }

    if (arg === '--dry-run') {
      args.dryRun = true
      continue
    }

    if (arg === '--include-ended') {
      args.includeEnded = true
      continue
    }

    if (arg === '--delay-ms') {
      args.requestDelayMs = Number(argv[index + 1] ?? '250')
      index += 1
      continue
    }

    if (arg === '--future-days') {
      args.maxFutureDays = Number(argv[index + 1] ?? '0')
      index += 1
      continue
    }

    if (arg === '--past-grace-days') {
      args.maxPastGraceDays = Number(argv[index + 1] ?? '0')
      index += 1
      continue
    }

    if (arg === '--ended-before-days') {
      args.endedBeforeDays = Number(argv[index + 1] ?? '0')
      index += 1
      continue
    }

    if (arg === '--status') {
      args.recurringStatus = argv[index + 1] ?? 'all'
      index += 1
      continue
    }
  }

  if (!Number.isFinite(args.startPage) || args.startPage < 1) throw new Error('--start-page must be >= 1')
  if (!Number.isFinite(args.maxPages) || args.maxPages < 1) throw new Error('--max-pages must be >= 1')
  if (args.maxItems !== undefined && args.maxItems !== null && (!Number.isFinite(args.maxItems) || args.maxItems < 1)) {
    throw new Error('--max-items must be >= 1')
  }
  if (!Number.isFinite(args.requestDelayMs) || args.requestDelayMs < 0) throw new Error('--delay-ms must be >= 0')
  if (args.maxFutureDays !== undefined && (!Number.isFinite(args.maxFutureDays) || args.maxFutureDays < 1)) {
    throw new Error('--future-days must be >= 1')
  }
  if (args.maxPastGraceDays !== undefined && (!Number.isFinite(args.maxPastGraceDays) || args.maxPastGraceDays < 0)) {
    throw new Error('--past-grace-days must be >= 0')
  }
  if (!Number.isFinite(args.endedBeforeDays) || args.endedBeforeDays < 0) {
    throw new Error('--ended-before-days must be >= 0')
  }
  if (!['active', 'archived', 'all'].includes(args.recurringStatus)) {
    throw new Error('--status must be one of: active, archived, all')
  }

  return args
}

async function runImport(args) {
  const result = await importJapanTravelEvents({
    startPage: args.startPage,
    maxPages: args.maxPages,
    maxItems: args.maxItems,
    dryRun: args.dryRun,
    includeEnded: args.includeEnded,
    requestDelayMs: args.requestDelayMs,
    maxFutureDays: args.maxFutureDays,
    maxPastGraceDays: args.maxPastGraceDays,
    log: (message) => console.error(`[japantravel-events] ${message}`),
  })

  return {
    mode: 'import',
    dryRun: result.dryRun,
    startPage: args.startPage,
    pagesVisited: result.pagesVisited,
    endPage: result.pagesVisited > 0 ? args.startPage + result.pagesVisited - 1 : args.startPage,
    stop: {
      reason: result.stoppedReason,
      page: result.stoppedAtPage,
      knownHorizon: result.knownHorizon,
    },
    candidatesFound: result.candidatesFound,
    knownCandidatesSkipped: result.knownCandidatesSkipped,
    importedCount: result.imported.length,
    reviewCount: result.review.length,
    rejectCount: result.rejected.length,
    duplicateCount: result.duplicates.length,
    endedCount: result.ended.length,
    intakeWindow: {
      futureDays: args.maxFutureDays ?? JAPAN_TRAVEL_IMPORT_DEFAULTS.futureDays,
      pastGraceDays: args.maxPastGraceDays ?? JAPAN_TRAVEL_IMPORT_DEFAULTS.pastGraceDays,
    },
    decisions: result.decisions,
    airtable: result.airtable ?? null,
    sample: {
      import: result.imported.slice(0, 5).map((event) => ({
        resourceId: event.resourceId,
        decision: event.intake.decision,
        score: event.intake.score,
        title: event.title,
        city: event.city,
        regionLabel: event.regionLabel,
        startsAt: event.event.startsAt,
        endsAt: event.event.endsAt,
        category: event.event.category,
        venue: event.event.venue,
        priceLabel: event.event.priceLabel,
        primaryUrl: event.primaryUrl,
        sourceUrl: event.event.sourceUrl,
        matchedSources: event.intake.matchedSources.map((source) => source.label),
        signals: event.intake.signals.map((signal) => `${signal.kind}:${signal.code}:${signal.score}`),
      })),
      review: result.review.slice(0, 5).map((event) => ({
        resourceId: event.resourceId,
        decision: event.intake.decision,
        score: event.intake.score,
        title: event.title,
        city: event.city,
        regionLabel: event.regionLabel,
        primaryUrl: event.primaryUrl,
        sourceUrl: event.event.sourceUrl,
        blockingReasons: event.intake.blockingReasons,
        matchedSources: event.intake.matchedSources.map((source) => source.label),
        signals: event.intake.signals.map((signal) => `${signal.kind}:${signal.code}:${signal.score}`),
      })),
      reject: result.rejected.slice(0, 5).map((event) => ({
        resourceId: event.resourceId,
        decision: event.intake.decision,
        score: event.intake.score,
        title: event.title,
        city: event.city,
        regionLabel: event.regionLabel,
        primaryUrl: event.primaryUrl,
        sourceUrl: event.event.sourceUrl,
        blockingReasons: event.intake.blockingReasons,
        matchedSources: event.intake.matchedSources.map((source) => source.label),
        signals: event.intake.signals.map((signal) => `${signal.kind}:${signal.code}:${signal.score}`),
      })),
      duplicate: result.duplicates.slice(0, 5).map((event) => ({
        resourceId: event.resourceId,
        decision: event.intake.decision,
        score: event.intake.score,
        title: event.title,
        sourceUrl: event.event.sourceUrl,
        duplicateOf: event.meta.duplicateOf,
        blockingReasons: event.intake.blockingReasons,
      })),
      ended: result.ended.slice(0, 5).map((event) => ({
        resourceId: event.resourceId,
        decision: event.intake.decision,
        score: event.intake.score,
        title: event.title,
        sourceUrl: event.event.sourceUrl,
        endsAt: event.event.endsAt,
        blockingReasons: event.intake.blockingReasons,
      })),
    },
  }
}

async function runCleanup(args) {
  const result = await archiveEndedJapanTravelEvents({
    dryRun: args.dryRun,
    endedBeforeDays: args.endedBeforeDays,
    log: (message) => console.error(`[japantravel-events] ${message}`),
  })

  return {
    mode: 'cleanup-ended',
    ...result,
  }
}

async function runRecurringReport(args) {
  const result = await reportRecurringJapanTravelCandidates({
    status: args.recurringStatus,
  })

  return {
    mode: 'report-recurring',
    status: args.recurringStatus,
    scanned: result.scanned,
    candidateCount: result.candidates.length,
    candidates: result.candidates.slice(0, 50),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const output =
    args.command === 'cleanup-ended'
      ? await runCleanup(args)
      : args.command === 'report-recurring'
        ? await runRecurringReport(args)
        : await runImport(args)

  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
