import { tours } from '@/data/tours'

export const dynamic = 'force-static'
export const revalidate = false

export async function GET() {
  const cityTours = tours.filter(t => t.category === 'city-tour')
  const intercityTours = tours.filter(t => t.category === 'intercity')
  const multiDayTours = tours.filter(t => t.category === 'multi-day')

  const tourList = [
    ...cityTours.map(t => `- ${t.titleEn} (${t.duration}) — https://jumboinjapan.com/${t.slug}`),
    ...intercityTours.map(t => `- Day trip to ${t.titleEn} (${t.duration}) — https://jumboinjapan.com/${t.slug}`),
    ...multiDayTours.map(t => `- ${t.titleEn} (${t.duration}) — https://jumboinjapan.com/${t.slug}`),
  ].join('\n')

  const content = `# JumboInJapan — Personal Guide to Japan

> Eduard Revidovich is a private guide in Japan based in Tokyo, offering premium personalized tours in Russian for Russian-speaking travelers.

## About

Eduard Revidovich has been leading private tours in Japan since 2013. He specializes in authentic, off-the-beaten-path experiences for Russian-speaking visitors. His tours avoid tourist clichés and focus on genuine Japanese culture, cuisine, and hidden locations.

## Tours Available

${tourList}

## Key Facts

- Language: Russian (primary), English available
- Location: Tokyo, Japan
- Website: https://jumboinjapan.com
- Booking: https://jumboinjapan.com/contact
- Price range: premium private tours
- Experience: 10+ years as private guide in Japan

## Target audience

Russian-speaking tourists visiting Japan who want a private, personalized, premium experience with a knowledgeable local guide.

## Links

- All tours: https://jumboinjapan.com/from-tokyo
- FAQ: https://jumboinjapan.com/faq
- Contact: https://jumboinjapan.com/contact
`

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
