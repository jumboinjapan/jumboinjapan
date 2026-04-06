export type TextBudgetStatus = 'ok' | 'warning' | 'unsafe'

export interface TextBudgetProfile {
  key: string
  label: string
  target: number
  warning: number
  hardMax: number
}

export interface TextBudgetFieldConfig {
  key: string
  label: string
  profile: TextBudgetProfile
}

export interface TextBudgetAnalysis {
  chars: number
  profile: TextBudgetProfile
  status: TextBudgetStatus
}

const poiDescriptionProfile: TextBudgetProfile = {
  key: 'poi-description',
  label: 'POI description',
  target: 160,
  warning: 240,
  hardMax: 320,
}

export const TEXT_BUDGET_PROFILES = {
  poiDescription: poiDescriptionProfile,
} as const

export const POI_ADMIN_TEXT_BUDGET_FIELDS = {
  sourceRu: {
    key: 'source-ru',
    label: 'Source RU',
    profile: poiDescriptionProfile,
  },
  sourceEn: {
    key: 'source-en',
    label: 'Source EN',
    profile: poiDescriptionProfile,
  },
  workingDraftRu: {
    key: 'working-draft-ru',
    label: 'Draft RU',
    profile: poiDescriptionProfile,
  },
  workingDraftEn: {
    key: 'working-draft-en',
    label: 'Draft EN',
    profile: poiDescriptionProfile,
  },
  approvedRu: {
    key: 'approved-ru',
    label: 'Approved RU',
    profile: poiDescriptionProfile,
  },
  approvedEn: {
    key: 'approved-en',
    label: 'Approved EN',
    profile: poiDescriptionProfile,
  },
} as const satisfies Record<string, TextBudgetFieldConfig>

export function countBudgetChars(value: string) {
  return value.trim().length
}

export function getTextBudgetStatus(chars: number, profile: TextBudgetProfile): TextBudgetStatus {
  if (chars > profile.hardMax) return 'unsafe'
  if (chars > profile.warning) return 'warning'
  return 'ok'
}

export function analyzeTextBudget(value: string, profile: TextBudgetProfile): TextBudgetAnalysis {
  const chars = countBudgetChars(value)

  return {
    chars,
    profile,
    status: getTextBudgetStatus(chars, profile),
  }
}

export function formatTextBudgetGuidance(profile: TextBudgetProfile) {
  return `Target ~${profile.target} chars · comfort ${profile.warning} · hard ${profile.hardMax}`
}

export function buildTextBudgetPromptGuidance(profile: TextBudgetProfile) {
  return [
    `- Aim for about ${profile.target} characters when possible.`,
    `- Staying under ${profile.warning} characters is preferred for layout safety.`,
    `- Do not exceed ${profile.hardMax} characters unless the source absolutely requires it.`,
  ].join('\n')
}
