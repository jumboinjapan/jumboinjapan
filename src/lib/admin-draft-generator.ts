interface GeneratePoiDraftInput {
  mode: 'seosha' | 'pelevin'
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

function buildSystemPrompt(mode: 'seosha' | 'pelevin') {
  if (mode === 'seosha') {
    return [
      'You are SEOsha, an SEO and LLM-visibility strategist writing a Russian draft for a Japan travel guide POI editor.',
      'Write ONLY the final Russian draft text. No notes, no bullets, no headings unless clearly useful inside the prose.',
      'Goal: create a strong first draft that is discoverable, fact-grounded, concise, and easy for both humans and LLMs to understand.',
      'Rules:',
      '- Keep to 1-3 short paragraphs.',
      '- Lead with the place itself and what it is.',
      '- Naturally include the city/location context when relevant.',
      '- Prefer concrete distinguishing details over fluff.',
      '- Sound natural in Russian, not robotic, not brochure-like.',
      '- Do not invent facts, dates, ticket prices, or claims not supported by the input.',
      '- Avoid cliches like «жемчужина», «обязательно к посещению», «не пропустите».',
      '- If the source text is weak, rewrite it cleanly rather than paraphrasing awkward phrases.',
    ].join('\n')
  }

  return [
    'You are Pelevin, an editorial copywriter writing a Russian draft for a Japan travel guide POI editor.',
    'Write ONLY the final Russian draft text. No notes, no bullets, no headings unless clearly useful inside the prose.',
    'Goal: create a stylish but practical first draft in Russian for a travel guide POI card/editor.',
    'Rules:',
    '- Keep to 1-3 compact paragraphs.',
    '- Sound like an informed human guide, not a brochure and not a translator.',
    '- Use concrete sensory or contextual detail when available, but stay restrained.',
    '- Keep the prose readable, calm, and editorial.',
    '- Do not invent facts, dates, ticket prices, or claims not supported by the input.',
    '- Avoid cliches like «жемчужина», «обязательно к посещению», «не пропустите».',
    '- If the source text is awkward, rewrite from scratch while preserving the factual core.',
  ].join('\n')
}

function buildUserPrompt(input: GeneratePoiDraftInput) {
  const sourceText = [input.currentDraftRu, input.approvedRu, input.sourceRu, input.sourceEn]
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n\n---\n\n')

  return [
    `Mode: ${input.mode}`,
    'Create a Russian working draft for the Draft field of an internal POI editor.',
    '',
    'POI context:',
    `- Name RU: ${input.nameRu || '—'}`,
    `- Name EN: ${input.nameEn || '—'}`,
    `- City: ${input.siteCity || '—'}`,
    `- Category: ${input.category.length ? input.category.join(', ') : '—'}`,
    `- Working hours: ${input.workingHours || '—'}`,
    `- Website: ${input.website || '—'}`,
    '',
    'Existing text and context to use if helpful:',
    sourceText || 'No existing source text. Build a careful, minimal draft only from the metadata above.',
    '',
    'Output requirements:',
    '- Output only Russian prose suitable for a draft textarea.',
    '- Keep it compact and editable.',
    '- Preserve factual accuracy.',
  ].join('\n')
}

export async function generatePoiDraft(input: GeneratePoiDraftInput) {
  const apiKey = getEnv('OPENAI_API_KEY')
  const model = getEnv('OPENAI_MODEL') ?? 'gpt-4.1-mini'

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured on the server')
  }

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
          content: [{ type: 'input_text', text: buildSystemPrompt(input.mode) }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: buildUserPrompt(input) }],
        },
      ],
      temperature: input.mode === 'seosha' ? 0.5 : 0.8,
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
  }

  const text = data.output_text?.trim()

  if (!text) {
    throw new Error('Draft generation returned an empty response')
  }

  return text
}
