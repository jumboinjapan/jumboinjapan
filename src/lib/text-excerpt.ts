/** Keep complete sentences in compact previews; full text remains in the disclosure. */
export function excerptSentences(text: string, count = 1): string {
  const segmenter = new Intl.Segmenter('ru', { granularity: 'sentence' })
  return Array.from(segmenter.segment(text), ({ segment }) => segment).slice(0, count).join('').trim()
}
