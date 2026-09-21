import type { ReactNode } from 'react'
import type { AirtablePoi } from '@/lib/airtable'
import { IntercityRouteTimeline, type IntercityRouteStop } from '@/components/IntercityRouteTimeline'
import { buildTicketDisplay } from '@/lib/ticket-display'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'
import { TourAdditions } from './TourAdditions'
import { TourAlbum, TourAlbumCover, TourAlbumTransport, TourAlbumContact } from './TourAlbum'
import styles from './TourAlbum.module.css'

/** Presentation only: pages retain their route loaders, schema and constructor data. */
export function IntercityTourAlbum({ title, subtitle, summary, intro, duration, image, alt, objectPosition, stops, helpers, transport, related, afterword }: {
  title: string
  subtitle: string
  summary: string
  intro?: string
  duration: string
  image: string
  alt: string
  objectPosition?: string
  stops: IntercityRouteStop[]
  helpers: { poi: AirtablePoi; criteriaLabel: string }[]
  transport: { title: string; summary: string; href: string; image: string }[]
  related?: ReactNode
  afterword?: ReactNode
}) {
  const additions = helpers.map(({ poi, criteriaLabel }) => ({
    id: poi.poiId,
    title: poi.nameRu,
    description: poi.approvedRu || poi.descriptionRu,
    note: criteriaLabel,
    website: poi.website,
    workingHours: formatWorkingHoursForRouteCard(poi.workingHours) || undefined,
    tickets: buildTicketDisplay(poi.tickets).lines,
  }))

  return <TourAlbum afterword={afterword}>
    <TourAlbumCover section="intercity" title={title} subtitle={subtitle}
      stops={stops.map((stop, index) => ({ title: stop.title, href: `#route-stop-${index + 1}` }))}
      summary={summary} intro={intro} duration={duration} image={image} alt={alt} objectPosition={objectPosition} />
    <section id="itinerary" className={styles.program} aria-labelledby="program-title">
      <div className={styles.sectionHead}><h2 id="program-title">Программа дня</h2></div>
      <IntercityRouteTimeline stops={stops} variant="album" />
    </section>
    <TourAdditions additions={additions} />
    <TourAlbumTransport options={transport.map(({ summary: text, ...option }) => ({ ...option, text }))} />
    <TourAlbumContact />
    {related}
  </TourAlbum>
}
