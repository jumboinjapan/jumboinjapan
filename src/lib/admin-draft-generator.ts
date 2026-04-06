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
  approvedRu: string
}

function getEnv(name: string) {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function buildSourceText(input: GeneratePoiDraftInput) {
  return [input.currentDraftRu, input.approvedRu, input.sourceRu, input.sourceEn]
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

function buildEditorialSystemPrompt() {
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
    '- Do not invent facts, dates, ticket prices, rankings, or claims not supported by the input.',
    '- Avoid cliches like «жемчужина», «обязательно к посещению», «не пропустите».',
    '- Output text suitable for the Draft field only.',
  ].join('\n')
}

function buildEditorialUserPrompt(input: GeneratePoiDraftInput) {
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
    '- Preserve factual accuracy.',
  ].join('\n')
}

function buildSeoSystemPrompt() {
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
    '- Do not invent facts, dates, ticket prices, rankings, or claims not supported by the input.',
    '- Avoid cliches like «жемчужина», «обязательно к посещению», «не пропустите».',
    '- Output text suitable for the Draft field only.',
  ].join('\n')
}

function buildSeoUserPrompt(input: GeneratePoiDraftInput, editorialDraft: string) {
  const sourceText = buildSourceText(input)

  return [
    'Mode: rewrite',
    'Task: review and refine the editorial-first draft for discoverability and LLM readability.',
    '',
    buildContextBlock(input),
    '',
    'Current editorial draft to refine:',
    editorialDraft,
    '',
    'Original source/context:',
    sourceText || 'No additional source text beyond metadata.',
    '',
    'Refinement requirements:',
    '- Keep the editorial tone intact.',
    '- Make the subject, location, and distinguishing value easier to understand.',
    '- Improve discoverability naturally, without exposing any internal agent workflow.',
    '- Output only the final Russian draft text.',
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

export async function generatePoiDraft(input: GeneratePoiDraftInput) {
  const apiKey = getEnv('OPENAI_API_KEY')
  const model = getEnv('OPENAI_MODEL') ?? 'gpt-4.1-mini'

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured on the server')
  }

  const editorialDraft = await runResponsesRequest({
    apiKey,
    model,
    systemPrompt: buildEditorialSystemPrompt(),
    userPrompt: buildEditorialUserPrompt(input),
    temperature: 0.8,
  })

  const refinedDraft = await runResponsesRequest({
    apiKey,
    model,
    systemPrompt: buildSeoSystemPrompt(),
    userPrompt: buildSeoUserPrompt(input, editorialDraft),
    temperature: 0.45,
  })

  return refinedDraft
}
