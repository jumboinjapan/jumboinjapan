import { TEXT_BUDGET_PROFILES, buildTextBudgetPromptGuidance } from '@/lib/text-budgets'

interface GeneratePoiDraftInput {
  mode: 'rewrite'
  nameRu: string
  nameEn: string
  siteCity: string
  category: string[]
  workingHours: string
  website: string
  sourceRu: string
  sourceEn: string
  currentDraftRu: string
  currentDraftEn: string
  approvedRu: string
  approvedEn: string
}

interface GeneratedPoiDraft {
  draftRu: string
  draftEn: string
}

function getEnv(name: string) {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function buildSourceText(input: GeneratePoiDraftInput) {
  return [input.currentDraftRu, input.currentDraftEn, input.approvedRu, input.approvedEn, input.sourceRu, input.sourceEn]
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n\n---\n\n')
}

function buildContextBlock(input: GeneratePoiDraftInput) {
  return [
    'POI context:',
    `- Name RU: ${input.nameRu || '—'}`,
    `- Name EN: ${input.nameEn || '—'}`,
    `- City: ${input.siteCity || '—'}`,
    `- Category: ${input.category.length ? input.category.join(', ') : '—'}`,
    `- Working hours: ${input.workingHours || '—'}`,
    `- Website: ${input.website || '—'}`,
  ].join('\n')
}

const poiDescriptionBudgetPrompt = buildTextBudgetPromptGuidance(TEXT_BUDGET_PROFILES.poiDescription)

function buildRuEditorialSystemPrompt() {
  return [
    'You are Pelevin, an editorial copywriter writing a Russian draft for a Japan travel guide POI editor.',
    'Write ONLY the final Russian draft text. No notes, no bullets, no headings unless clearly useful inside the prose.',
    'Goal: create the primary editorial rewrite from the current source.',
    'Rules:',
    '- Keep to 1-3 compact paragraphs.',
    '- Start from the source text when present, but rewrite decisively if the prose is weak or awkward.',
    '- Sound like an informed human guide, not a brochure and not a translator.',
    '- Keep the prose restrained, calm, and editorial.',
    '- Lead clearly with what the place is and why it matters.',
    '- Use concrete sensory or contextual detail when available, but stay disciplined.',
    poiDescriptionBudgetPrompt,
    '- Do not invent facts, dates, ticket prices, rankings, or claims not supported by the input.',
    '- Avoid cliches like «жемчужина», «обязательно к посещению», «не пропустите».',
    '- Output text suitable for the Draft field only.',
  ].join('\n')
}

function buildRuEditorialUserPrompt(input: GeneratePoiDraftInput) {
  const sourceText = buildSourceText(input)

  return [
    'Mode: rewrite',
    'Task: write the editorial-first Russian draft for the Draft field of an internal POI editor.',
    '',
    buildContextBlock(input),
    '',
    'Existing text and context to use if helpful:',
    sourceText || 'No existing source text. Build a careful, minimal editorial draft only from the metadata above.',
    '',
    'Output requirements:',
    '- Output only Russian prose suitable for a draft textarea.',
    '- Keep it compact and editable.',
    poiDescriptionBudgetPrompt,
    '- Preserve factual accuracy.',
  ].join('\n')
}

function buildRuSeoSystemPrompt() {
  return [
    'You are SEOsha, an SEO and LLM-discoverability strategist reviewing a Russian draft for a Japan travel guide POI editor.',
    'Write ONLY the final improved Russian draft text. No notes, no bullets, no headings unless clearly useful inside the prose.',
    'Goal: tighten the draft for discoverability and AI readability without breaking editorial quality.',
    'Rules:',
    '- Keep the text in 1-3 compact paragraphs.',
    '- Preserve the editorial voice: calm, restrained, human, not robotic.',
    '- Improve semantic clarity so both search engines and LLMs can identify what the place is, where it is, and why it matters.',
    '- Naturally include city/location context when relevant for discoverability.',
    '- Prefer specific nouns and concrete phrasing over vague praise.',
    '- Do not keyword-stuff and do not turn the text into SEO copy.',
    poiDescriptionBudgetPrompt,
    '- Do not invent facts, dates, ticket prices, rankings, or claims not supported by the input.',
    '- Avoid cliches like «жемчужина», «обязательно к посещению», «не пропустите».',
    '- Output text suitable for the Draft field only.',
  ].join('\n')
}

function buildRuSeoUserPrompt(input: GeneratePoiDraftInput, editorialDraftRu: string) {
  const sourceText = buildSourceText(input)

  return [
    'Mode: rewrite',
    'Task: review and refine the editorial-first draft for discoverability and LLM readability.',
    '',
    buildContextBlock(input),
    '',
    'Current editorial draft to refine:',
    editorialDraftRu,
    '',
    'Original source/context:',
    sourceText || 'No additional source text beyond metadata.',
    '',
    'Refinement requirements:',
    '- Keep the editorial tone intact.',
    '- Make the subject, location, and distinguishing value easier to understand.',
    '- Keep or tighten the draft toward the safe text budget rather than expanding it.',
    '- Improve discoverability naturally, without exposing any internal agent workflow.',
    '- Output only the final Russian draft text.',
  ].join('\n')
}

function buildEnEditorialSystemPrompt() {
  return [
    'You are Pelevin, an editorial copywriter preparing the English draft for a Japan travel guide POI editor.',
    'Write ONLY the final English draft text. No notes, no bullets, no headings unless clearly useful inside the prose.',
    'Goal: derive an editorial English draft from the finalized Russian draft while preserving facts, tone, and intent.',
    'Rules:',
    '- Keep to 1-3 compact paragraphs.',
    '- Base the English draft on the supplied Russian draft, not on the raw source independently.',
    '- Preserve meaning and factual boundaries; do not invent facts, dates, ticket prices, rankings, or claims not supported by the input.',
    '- Sound like an informed human guide, not a brochure and not a literal machine translation.',
    '- Keep the prose restrained, calm, and editorial.',
    '- Lead clearly with what the place is and why it matters.',
    poiDescriptionBudgetPrompt,
    '- Output text suitable for the Draft field only.',
  ].join('\n')
}

function buildEnEditorialUserPrompt(input: GeneratePoiDraftInput, refinedDraftRu: string) {
  const sourceText = buildSourceText(input)

  return [
    'Mode: rewrite',
    'Task: write the editorial-first English draft for the Draft field of an internal POI editor.',
    '',
    buildContextBlock(input),
    '',
    'Final Russian draft to derive from:',
    refinedDraftRu,
    '',
    'Additional source/context for fact checking only:',
    sourceText || 'No additional source text beyond metadata.',
    '',
    'Output requirements:',
    '- Output only English prose suitable for a draft textarea.',
    '- Derive the text from the Russian draft above, while making it read naturally in English.',
    '- Keep it compact and editable.',
    poiDescriptionBudgetPrompt,
    '- Preserve factual accuracy.',
  ].join('\n')
}

function buildEnSeoSystemPrompt() {
  return [
    'You are SEOsha, an SEO and LLM-discoverability strategist reviewing an English draft for a Japan travel guide POI editor.',
    'Write ONLY the final improved English draft text. No notes, no bullets, no headings unless clearly useful inside the prose.',
    'Goal: tighten the draft for discoverability and AI readability without breaking editorial quality.',
    'Rules:',
    '- Keep the text in 1-3 compact paragraphs.',
    '- Preserve the editorial voice: calm, restrained, human, not robotic.',
    '- Improve semantic clarity so both search engines and LLMs can identify what the place is, where it is, and why it matters.',
    '- Naturally include city/location context when relevant for discoverability.',
    '- Prefer specific nouns and concrete phrasing over vague praise.',
    '- Do not keyword-stuff and do not turn the text into SEO copy.',
    poiDescriptionBudgetPrompt,
    '- Keep the English text derived from the supplied Russian draft and editorial English draft, not from the raw source independently.',
    '- Do not invent facts, dates, ticket prices, rankings, or claims not supported by the input.',
    '- Output text suitable for the Draft field only.',
  ].join('\n')
}

function buildEnSeoUserPrompt(input: GeneratePoiDraftInput, refinedDraftRu: string, editorialDraftEn: string) {
  return [
    'Mode: rewrite',
    'Task: review and refine the editorial-first English draft for discoverability and LLM readability.',
    '',
    buildContextBlock(input),
    '',
    'Russian draft this English version must stay aligned with:',
    refinedDraftRu,
    '',
    'Current editorial English draft to refine:',
    editorialDraftEn,
    '',
    'Refinement requirements:',
    '- Keep the editorial tone intact.',
    '- Make the subject, location, and distinguishing value easier to understand.',
    '- Keep or tighten the draft toward the safe text budget rather than expanding it.',
    '- Improve discoverability naturally, without exposing any internal agent workflow.',
    '- Preserve factual alignment with the Russian draft.',
    '- Output only the final English draft text.',
  ].join('\n')
}

async function runResponsesRequest({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  temperature,
}: {
  apiKey: string
  model: string
  systemPrompt: string
  userPrompt: string
  temperature: number
}) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: userPrompt }],
        },
      ],
      temperature,
      max_output_tokens: 500,
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Draft generation failed: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as {
    output_text?: string
    output?: Array<{
      content?: Array<{
        type?: string
        text?: string
      }>
    }>
  }

  const responseTextBlocks =
    data.output
      ?.flatMap((item) => item.content ?? [])
      .filter(
        (item): item is { type?: string; text: string } =>
          item.type === 'output_text' && typeof item.text === 'string',
      ) ?? []

  const text =
    data.output_text?.trim() ??
    responseTextBlocks.map((item) => item.text.trim()).filter(Boolean).join('\n').trim()

  if (!text) {
    throw new Error('Draft generation returned an empty response')
  }

  return text
}

export async function generatePoiDraft(input: GeneratePoiDraftInput): Promise<GeneratedPoiDraft> {
  const apiKey = getEnv('OPENAI_API_KEY')
  const model = getEnv('OPENAI_MODEL') ?? 'gpt-4.1-mini'

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured on the server')
  }

  const editorialDraftRu = await runResponsesRequest({
    apiKey,
    model,
    systemPrompt: buildRuEditorialSystemPrompt(),
    userPrompt: buildRuEditorialUserPrompt(input),
    temperature: 0.8,
  })

  const refinedDraftRu = await runResponsesRequest({
    apiKey,
    model,
    systemPrompt: buildRuSeoSystemPrompt(),
    userPrompt: buildRuSeoUserPrompt(input, editorialDraftRu),
    temperature: 0.45,
  })

  const editorialDraftEn = await runResponsesRequest({
    apiKey,
    model,
    systemPrompt: buildEnEditorialSystemPrompt(),
    userPrompt: buildEnEditorialUserPrompt(input, refinedDraftRu),
    temperature: 0.7,
  })

  const refinedDraftEn = await runResponsesRequest({
    apiKey,
    model,
    systemPrompt: buildEnSeoSystemPrompt(),
    userPrompt: buildEnSeoUserPrompt(input, refinedDraftRu, editorialDraftEn),
    temperature: 0.45,
  })

  return {
    draftRu: refinedDraftRu,
    draftEn: refinedDraftEn,
  }
}
