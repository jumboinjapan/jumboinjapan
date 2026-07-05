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

> Eduard Revidovich is a private guide in Japan based in Tokyo, offering personalized tours in Russian for Russian-speaking travelers.

## About

Eduard Revidovich has lived in Japan for over 25 years and has worked in tourism for over 20 years, designing more than 400 custom itineraries. He specializes in authentic experiences for Russian-speaking visitors: genuine Japanese culture, cuisine, seasonal context and locations beyond the standard tourist circuit.

## Tours Available

${tourList}

## Key Facts

- Language: Russian (primary), English available
- Location: Tokyo, Japan
- Website: https://jumboinjapan.com
- Booking: https://jumboinjapan.com/contact
- Format: private tours and custom itineraries, individual pricing
- Experience: 25+ years living in Japan, 20+ years in tourism, 400+ custom itineraries
- Instagram: https://www.instagram.com/revidovich.art/

## Target audience

Russian-speaking tourists visiting Japan who want a private, personalized trip built around their pace and interests, guided by a long-term Japan resident.

## Links

- Tokyo tours: https://jumboinjapan.com/city-tour
- Day trips from Tokyo: https://jumboinjapan.com/intercity
- Multi-day journeys: https://jumboinjapan.com/multi-day
- Trip questionnaire: https://jumboinjapan.com/profile
- Contact: https://jumboinjapan.com/contact
`

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
