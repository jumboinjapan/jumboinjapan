import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Cormorant_Garamond } from 'next/font/google'
import { ArrowRight } from 'lucide-react'
import { typo } from '@/lib/typography'
import { excerptSentences } from '@/lib/text-excerpt'
import styles from './TourAlbum.module.css'

const albumFont = Cormorant_Garamond({ subsets: ['latin', 'cyrillic'], weight: ['400', '500'], style: ['normal', 'italic'], display: 'swap', variable: '--font-album' })

export function TourAlbum({ children, afterword }: { children: ReactNode; afterword?: ReactNode }) {
  return <div className={`${albumFont.variable} ${styles.album}`}>
    <div className={styles.container}>{children}</div>
    <div className={styles.faq}>{afterword}</div>
  </div>
}

type CoverLink = { title: string; href: string }

export function TourAlbumCover({ title, subtitle, intro, summary, duration, travelTime, image, alt, caption, objectPosition, stops = [], directions = [], collection = false, section = 'city-tour' }: {
  title: string; subtitle: string; intro?: string; summary?: string; duration?: string; travelTime?: string; image: string; alt?: string; caption?: string; objectPosition?: string; stops?: CoverLink[]; directions?: CoverLink[]; collection?: boolean; section?: 'city-tour' | 'intercity'
}) {
  const sectionTitle = section === 'intercity' ? 'Из Токио' : 'По Токио'
  const description = intro?.trim() || ''
  const shortSubtitle = !collection && subtitle.length > 100 ? excerptSentences(subtitle) : subtitle
  const subtitleDetail = subtitle.slice(shortSubtitle.length).trim()
  // Остаток подзаголовка перечисляет те же места, что «Основные точки посещения»
  // в инфоблоке, — на страницах с цепочкой точек повтор не показываем (Notion, 25.09).
  // Описание справа (body) считается по-прежнему.
  const hideSubtitleDetail = !collection && stops.length > 0 && Boolean(subtitleDetail)
  const lead = hideSubtitleDetail ? '' : subtitleDetail || summary?.trim() || (collection ? description : excerptSentences(description, 2))
  const body = collection ? '' : subtitleDetail
    ? [...new Set([summary?.trim(), description].filter(Boolean))].join('\n\n')
    : summary?.trim() ? (description === lead ? '' : description) : description.slice(lead.length).trim()
  return <header className={styles.cover}>
    <div className={styles.coverTop}>
      <figure className={`${styles.coverPhoto} ${!image ? styles.coverPlaceholder : ''}`}>
        <div>{image ? <Image src={image} alt={typo(alt || title)} width={1200} height={800} priority quality={90} style={{ objectPosition: objectPosition || 'center' }} sizes="(max-width: 899px) calc(100vw - 32px), (max-width: 1376px) 50vw, 616px" /> : <div role="img" aria-label={`Место для фотографии: ${title}`}><span>Фотография маршрута</span><span>{typo(title)}</span></div>}</div>
        <figcaption>{typo(caption || title)}</figcaption>
      </figure>
      <div className={styles.coverCopy}>
        <nav aria-label="Навигационная цепочка" className={styles.breadcrumb}>
          <Link href="/">Главная</Link>
          <span aria-hidden="true">/</span>
          {collection ? <span aria-current="page">{sectionTitle}</span> : <>
            <Link href={`/${section}`}>{sectionTitle}</Link>
            <span aria-hidden="true">/</span><span aria-current="page">{typo(title)}</span>
          </>}
        </nav>
        <p className={styles.edition}>Индивидуальные {collection ? 'путешествия' : 'экскурсии'}</p>
        <h1>{typo(title)}</h1>
        {shortSubtitle && <p className={styles.subtitle}>{typo(shortSubtitle)}</p>}
        {!collection && (duration || travelTime || stops.length > 0) && <div className={styles.coverFacts}>
          {duration && <span>{typo(duration)}</span>}
          {travelTime && <span>Из Токио · {typo(travelTime)}</span>}
          {stops.length > 0 && <div className={styles.coverStops}>
            <span className={styles.coverStopsLabel}>Основные точки посещения:</span>
            <ol>{stops.map((stop, index) => <li key={`${stop.href}-${index}`}>{typo(stop.title)}</li>)}</ol>
          </div>}
        </div>}
        {collection && lead && <p className={styles.coverLead}>{typo(lead)}</p>}
        <div className={styles.coverActions}>
          <a href={collection ? '#routes' : '#itinerary'} className={styles.coverPrimary}>{collection ? 'Выбрать маршрут' : 'Программа поездки'}</a>
          {collection ? <a href="#transport" className={styles.coverSecondary}>Как лучше ехать</a> : <Link href="/contact" className={styles.coverSecondary}>Обсудить поездку</Link>}
        </div>
      </div>
    </div>
    {!collection && (lead || body) && <div className={styles.coverDetails}>
      {lead && <div className={styles.routeOverview}>
        <p className={styles.coverLead}>{typo(lead)}</p>
      </div>}
      {body && <div className={styles.coverDescription}>{body.split(/\n\s*\n/).filter(Boolean).map((text, index) => <p key={index}>{typo(text)}</p>)}</div>}
    </div>}
    {collection && directions.length > 0 && <nav className={styles.directions} aria-label="Направления">
      <span className={styles.indexLabel}>Направления</span>
      {directions.map(link => <Link key={link.href} href={link.href}>{typo(link.title)}</Link>)}
    </nav>}
  </header>
}

export function TourAlbumTransport({ options, intro }: { options: readonly { title: string; text: string; href: string; image: string }[]; intro?: string }) {
  if (!options.length) return null
  return <section id="transport" className={styles.transport} aria-labelledby="transport-title">
    <div className={styles.sectionHead}><h2 id="transport-title">Как лучше ехать</h2></div>
    {intro && <p className={styles.transportIntro}>{typo(intro)}</p>}
    <div className={styles.transportGrid}>{options.map(option => <Link key={option.href} href={option.href} className={styles.transportCard}>
      <div className={styles.transportImage}><Image src={option.image} alt="" fill quality={90} sizes="(max-width: 767px) 100vw, 33vw" /></div>
      <h3>{typo(option.title)}<ArrowRight size={18} aria-hidden="true" /></h3>
      <p>{typo(option.text)}</p>
    </Link>)}</div>
  </section>
}

export function TourAlbumContact() {
  return <div id="cta" className={styles.contactLine}><Link href="/contact">Обсудить поездку <ArrowRight size={16} aria-hidden="true" /></Link></div>
}
