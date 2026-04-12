export type AuthoritativeTouristSource = {
  id: string
  label: string
  rationale: string
  weight: 2 | 3
  hostnames: string[]
}

export type IntakeDecision = 'import' | 'review' | 'skip'

export type IntakeSignal = {
  kind: 'positive' | 'negative'
  code: string
  score: number
  note: string
}

export type IntakeEvaluation = {
  decision: IntakeDecision
  score: number
  matchedSources: AuthoritativeTouristSource[]
  linkedSourceHosts: string[]
  geoResolvable: boolean
  inWindow: boolean
  blockingReasons: string[]
  signals: IntakeSignal[]
}

export type EvaluateJapanTravelEventInput = {
  title: string
  summary: string
  description: string
  venue: string
  address: string
  city: string
  regionLabel: string
  startsAt: string
  endsAt: string
  sourceUrl: string
  officialUrl: string | null
  linkedUrls: string[]
}

export type JapanTravelIntakeWindowOptions = {
  maxFutureDays?: number
  maxPastGraceDays?: number
}

export const AUTHORITATIVE_TOURIST_SOURCES: AuthoritativeTouristSource[] = [
  {
    id: 'jnto',
    label: 'JNTO / Japan Travel',
    rationale: 'Official national tourism organization for Japan; strongest tourist-facing baseline for nationally relevant event discovery.',
    weight: 3,
    hostnames: ['japan.travel'],
  },
  {
    id: 'japan-guide',
    label: 'Japan Guide',
    rationale: 'Long-standing, high-trust independent travel reference widely used by inbound visitors for practical event and destination planning.',
    weight: 3,
    hostnames: ['japan-guide.com'],
  },
  {
    id: 'go-tokyo',
    label: 'GO TOKYO',
    rationale: 'Official Tokyo tourism guide operated by the Tokyo Convention & Visitors Bureau; strong signal for tourist-facing Tokyo events.',
    weight: 2,
    hostnames: ['gotokyo.org'],
  },
  {
    id: 'kyoto-travel',
    label: 'Kyoto Travel',
    rationale: 'Official Kyoto City tourism portal; highly relevant for traveler-facing seasonal and cultural event coverage.',
    weight: 2,
    hostnames: ['kyoto.travel'],
  },
  {
    id: 'osaka-info',
    label: 'Osaka Info',
    rationale: 'Official Osaka Convention & Tourism Bureau guide; useful corroboration for major Osaka events visitors may route around.',
    weight: 2,
    hostnames: ['osaka-info.jp'],
  },
  {
    id: 'visit-hokkaido',
    label: 'Visit Hokkaido',
    rationale: 'Official Hokkaido Tourism Organization guide; good tourist-oriented coverage for seasonal festivals and regional travel planning.',
    weight: 2,
    hostnames: ['visit-hokkaido.jp'],
  },
]

const SOCIAL_HOSTS = new Set(['facebook.com', 'instagram.com', 'x.com', 'twitter.com', 't.co', 'youtube.com', 'youtu.be', 'line.me'])
const PRESS_RELEASE_HOSTS = new Set(['prtimes.jp', 'prtimes.com', 'news.mynavi.jp'])

const STRONG_TOURIST_EVENT_PATTERN = /\b(matsuri|festival|fireworks|hanabi|sakura|cherry blossom|illumination|autumn leaves|momiji|lantern|parade|float procession|market|flea market|night market|temple opening|shrine festival|seasonal event|exhibition|art fair|museum exhibition)\b/i

const SECONDARY_TOURIST_EVENT_PATTERN = /\b(concert|live music|jazz|orchestra|garden event|flower festival|food festival|beer festival|craft fair|cultural event|traditional performance|tea ceremony)\b/i

const PROMO_NOISE_PATTERN = /\b(buffet|afternoon tea|dessert buffet|sweets buffet|brunch|dinner course|limited-time menu|collaboration cafe|collab cafe|collaboration room|stay plan|accommodation plan|room package|press release|campaign|novelty|merchandise fair)\b/i

const LOCAL_ONLY_NOISE_PATTERN = /\b(residents only|citizens only|local residents|community center|public hall|town meeting|seminar|lecture|briefing|recruitment|volunteer|training session|consultation day|exam venue|school information session)\b/i

const GENERIC_CITY_VALUES = new Set(['', 'japan'])
const REVIEW_MIN_SCORE = 2
const IMPORT_MIN_SCORE = 4
const MAX_FUTURE_DAYS = 366
const MAX_PAST_GRACE_DAYS = 14

function normalizeHostname(value: string) {
  return value.replace(/^www\./, '').toLowerCase()
}

function hostnameFromUrl(value: string | null | undefined) {
  if (!value) return null

  try {
    return normalizeHostname(new URL(value).hostname)
  } catch {
    return null
  }
}

function matchesHostname(hostname: string, pattern: string) {
  return hostname === pattern || hostname.endsWith(`.${pattern}`)
}

function daysFromNow(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return Number.POSITIVE_INFINITY
  return (date.getTime() - Date.now()) / 86_400_000
}

function pushSignal(signals: IntakeSignal[], kind: IntakeSignal['kind'], code: string, score: number, note: string) {
  signals.push({ kind, code, score, note })
}

export function evaluateJapanTravelEventIntake(
  input: EvaluateJapanTravelEventInput,
  options: JapanTravelIntakeWindowOptions = {},
): IntakeEvaluation {
  const haystack = [input.title, input.summary, input.description, input.venue].join(' ').toLowerCase()
  const allUrls = [input.sourceUrl, input.officialUrl, ...input.linkedUrls].filter((value): value is string => Boolean(value))
  const linkedHosts = Array.from(
    new Set(
      allUrls
        .map((value) => hostnameFromUrl(value))
        .filter((value): value is string => Boolean(value)),
    ),
  )

  const matchedSources = AUTHORITATIVE_TOURIST_SOURCES.filter((source) =>
    linkedHosts.some((hostname) => source.hostnames.some((pattern) => matchesHostname(hostname, pattern))),
  )

  const signals: IntakeSignal[] = []
  const blockingReasons: string[] = []
  let score = 0

  const maxFutureDays = options.maxFutureDays ?? MAX_FUTURE_DAYS
  const maxPastGraceDays = options.maxPastGraceDays ?? MAX_PAST_GRACE_DAYS
  const endOffsetDays = daysFromNow(input.endsAt)
  const startOffsetDays = daysFromNow(input.startsAt)
  const inWindow = endOffsetDays >= -maxPastGraceDays && startOffsetDays <= maxFutureDays

  if (!inWindow) {
    blockingReasons.push('outside_phase_1_window')
    pushSignal(
      signals,
      'negative',
      'time-window',
      -5,
      `Event falls outside the active intake window (past grace ${maxPastGraceDays}d, future horizon ${maxFutureDays}d).`,
    )
    score -= 5
  } else {
    pushSignal(
      signals,
      'positive',
      'time-window',
      1,
      `Event falls within the active intake window (past grace ${maxPastGraceDays}d, future horizon ${maxFutureDays}d).`,
    )
    score += 1
  }

  if (PROMO_NOISE_PATTERN.test(haystack)) {
    blockingReasons.push('promo_noise')
    pushSignal(signals, 'negative', 'promo-noise', -5, 'Looks like hospitality/menu/collaboration promo noise rather than route-relevant travel event coverage.')
    score -= 5
  }

  if (LOCAL_ONLY_NOISE_PATTERN.test(haystack)) {
    pushSignal(signals, 'negative', 'local-only-noise', -2, 'Looks targeted at local administration/community participation rather than travelers.')
    score -= 2
  }

  if (STRONG_TOURIST_EVENT_PATTERN.test(haystack)) {
    pushSignal(signals, 'positive', 'strong-event-keywords', 2, 'Contains strong tourist-event keywords.')
    score += 2
  } else if (SECONDARY_TOURIST_EVENT_PATTERN.test(haystack)) {
    pushSignal(signals, 'positive', 'secondary-event-keywords', 1, 'Contains secondary tourist-event keywords.')
    score += 1
  }

  if (matchedSources.length > 0) {
    const sourceScore = Math.min(
      5,
      matchedSources.reduce((total, source) => total + source.weight, 0) + (matchedSources.length >= 2 ? 1 : 0),
    )
    pushSignal(
      signals,
      'positive',
      'authoritative-sources',
      sourceScore,
      `Matched authoritative tourist sources: ${matchedSources.map((source) => source.label).join(', ')}.`,
    )
    score += sourceScore
  }

  const officialHost = hostnameFromUrl(input.officialUrl)
  if (officialHost && !SOCIAL_HOSTS.has(officialHost)) {
    pushSignal(signals, 'positive', 'official-url', 1, `Has a non-social official/event URL (${officialHost}).`)
    score += 1
  }

  if (
    officialHost &&
    (PRESS_RELEASE_HOSTS.has(officialHost) || /\/press\b|\/news\b|\/press-release\b/i.test(input.officialUrl ?? ''))
  ) {
    pushSignal(signals, 'negative', 'press-release-surface', -2, 'Official URL looks like a press/news release surface, so keep it out of auto-import unless stronger corroboration exists.')
    score -= 2
  }

  const geoResolvable = !GENERIC_CITY_VALUES.has(input.city.trim().toLowerCase()) && Boolean(input.regionLabel.trim()) && Boolean((input.address || input.venue).trim())
  if (geoResolvable) {
    pushSignal(signals, 'positive', 'geo-resolvable', 1, `Event can be resolved to ${input.city}, ${input.regionLabel}.`)
    score += 1
  } else {
    pushSignal(signals, 'negative', 'geo-unresolved', -2, 'Event location is too vague for reliable routing/geocoding.')
    score -= 2
  }

  let decision: IntakeDecision = 'skip'
  if (blockingReasons.length > 0) {
    decision = score >= REVIEW_MIN_SCORE ? 'review' : 'skip'
  } else if (score >= IMPORT_MIN_SCORE) {
    decision = 'import'
  } else if (score >= REVIEW_MIN_SCORE) {
    decision = 'review'
  }

  return {
    decision,
    score,
    matchedSources,
    linkedSourceHosts: linkedHosts,
    geoResolvable,
    inWindow,
    blockingReasons,
    signals,
  }
}
