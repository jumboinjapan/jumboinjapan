import type { ReactNode } from 'react'
import Image from 'next/image'
import { typoDeep } from '@/lib/typography'
import { excerptSentences } from '@/lib/text-excerpt'
import { TourAlbum, TourAlbumCover, TourAlbumTransport, TourAlbumContact } from './TourAlbum'
import styles from './TourAlbum.module.css'
import timeline from '@/components/IntercityRouteTimeline.module.css'

type CityTourStop = {
  id: string; number: string; title: string; text: string; duration: string;
  /** Route Stops is the photo source of truth; missing photos use a placeholder. */
  photo?: string; alt?: string;
}
type LogisticsOption = { title: string; text: string; href: string; image: string }
type CityTourDayPageProps = {
  hero: { image: string; alt?: string; eyebrow: string; title: string; displayTitle?: string; displaySubtitle?: string; subtitle: string; objectPosition?: string };
  program: { title: string; description: string; duration: string };
  stops: CityTourStop[];
  logistics?: { intro?: string; options: LogisticsOption[] };
  children?: ReactNode;
}

export function CityTourDayPage({ children, ...props }: CityTourDayPageProps) {
  const { hero, program, stops, logistics } = typoDeep(props)
  return <TourAlbum afterword={children}>
    <TourAlbumCover title={hero.displayTitle || hero.title} subtitle={hero.displaySubtitle || hero.subtitle} intro={program.description} duration={program.duration} image={hero.image} alt={hero.alt} objectPosition={hero.objectPosition} />
    <section id="itinerary" className={styles.program} aria-labelledby="program-title">
      <div className={styles.sectionHead}><h2 id="program-title">Программа дня</h2></div>
      <div className={timeline.list}>{stops.map((stop, index) => {
        const preview = excerptSentences(stop.text, 2)
        const remaining = stop.text.slice(preview.length).trim()
        return <article id={stop.id} key={stop.id} className={timeline.stop}>
          <div className={timeline.text}>
            <span className={timeline.number} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div className={timeline.copy}>
              <h3 className={timeline.title}>{stop.title}</h3>
              <p className={timeline.description}>{preview}</p>
              {(remaining || stop.duration) && <details className={styles.stopDetails}>
                <summary>Подробнее<span className="sr-only">: {stop.title}</span><span aria-hidden="true">+</span></summary>
                {remaining && <p>{remaining}</p>}
                {stop.duration && <p className={styles.stopDuration}>На остановке: {stop.duration}</p>}
              </details>}
            </div>
          </div>
          <figure className={timeline.figure}>
            <div className={`${timeline.photo} ${stop.photo ? '' : timeline.placeholder}`}>
              {stop.photo ? <Image src={stop.photo} alt={stop.alt || stop.title} fill quality={90} sizes="(max-width: 899px) 100vw, 40vw" /> : <div role="img" aria-label={`Место для фотографии: ${stop.title}`}><span>Фотография места</span><span>{stop.title}</span></div>}
            </div>
          </figure>
        </article>
      })}</div>
    </section>
    {logistics && <TourAlbumTransport {...logistics} />}
    <TourAlbumContact />
  </TourAlbum>
}

export type { CityTourStop, LogisticsOption, CityTourDayPageProps }
