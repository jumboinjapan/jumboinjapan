import { importJapanTravelEvents } from '../src/lib/japantravel-events.ts'

function parseArgs(argv) {
  const args = {
    startPage: 1,
    maxPages: 1,
    maxItems: undefined,
    dryRun: true,
    includeEnded: false,
    requestDelayMs: 250,
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
  }

  if (!Number.isFinite(args.startPage) || args.startPage < 1) throw new Error('--start-page must be >= 1')
  if (!Number.isFinite(args.maxPages) || args.maxPages < 1) throw new Error('--max-pages must be >= 1')
  if (args.maxItems !== undefined && (!Number.isFinite(args.maxItems) || args.maxItems < 1)) {
    throw new Error('--max-items must be >= 1')
  }
  if (!Number.isFinite(args.requestDelayMs) || args.requestDelayMs < 0) throw new Error('--delay-ms must be >= 0')

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = await importJapanTravelEvents({
    ...args,
    log: (message) => console.error(`[japantravel-events] ${message}`),
  })

  console.log(
    JSON.stringify(
      {
        dryRun: result.dryRun,
        pagesVisited: result.pagesVisited,
        candidatesFound: result.candidatesFound,
        importedCount: result.imported.length,
        skippedEnded: result.skippedEnded,
        airtable: result.airtable ?? null,
        sample: result.imported.slice(0, 5).map((event) => ({
          resourceId: event.resourceId,
          type: event.type,
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
        })),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
