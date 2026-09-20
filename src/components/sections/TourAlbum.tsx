import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Cormorant_Garamond } from 'next/font/google'
import { ArrowRight } from 'lucide-react'
import { excerptSentences } from '@/lib/text-excerpt'
import { typo } from '@/lib/typography'
import styles from './TourAlbum.module.css'

const albumFont = Cormorant_Garamond({ subsets: ['latin', 'cyrillic'], weight: ['400', '500'], style: ['normal', 'italic'], display: 'swap', variable: '--font-album' })

export function TourAlbum({ children, afterword }: { children: ReactNode; afterword?: ReactNode }) {
  return <div className={`${albumFont.variable} ${styles.album}`}>
    <div className={styles.container}>{children}</div>
    <div className={styles.faq}>{afterword}</div>
  </div>
}

export function TourAlbumCover({ title, subtitle, intro, summary, duration, image, alt, objectPosition, collection = false, section = 'city-tour' }: {
  title: string; subtitle: string; intro?: string; summary?: string; duration?: string; image: string; alt?: string; objectPosition?: string; collection?: boolean; section?: 'city-tour' | 'intercity'
}) {
  const sectionTitle = section === 'intercity' ? 'Из Токио' : 'По Токио'
  const introPreview = summary || (intro ? excerptSentences(intro, 2) : '')
  const hasMoreIntro = Boolean(intro && intro.trim() !== introPreview)
  const detailIntro = intro || summary
  return <header className={styles.cover}>
    <nav aria-label="Навигационная цепочка" className={styles.breadcrumb}>
      <Link href={collection ? '/' : `/${section}`}>{collection ? 'Главная' : sectionTitle}</Link>
      <span aria-hidden="true">/</span><span aria-current="page">{typo(collection ? sectionTitle : title)}</span>
    </nav>
    <div className={`${styles.coverTop} ${section === 'intercity' && !collection && title.length <= 16 ? '' : styles.cityCover}`}>
      <div className={styles.coverCopy}>
        <p className={styles.edition}>Индивидуальные {collection ? 'путешествия' : 'экскурсии'}</p>
        <h1>{typo(title)}</h1>
        <p className={styles.subtitle}>{typo(subtitle)}</p>
        {duration && <p className={styles.duration}>{typo(duration)}</p>}
      </div>
      {(intro || summary) && <div className={styles.guideNote}>
        <p className={styles.guideSummary}>{typo(introPreview)}</p>
        {(hasMoreIntro || summary) && detailIntro && <details className={`${styles.intro} ${hasMoreIntro ? '' : styles.mobileIntro}`}><summary>{collection ? (section === 'intercity' ? 'О поездках' : 'О поездках по Токио') : 'О маршруте'} <span aria-hidden="true">+</span></summary><p>{typo(detailIntro)}</p></details>}
      </div>}
    </div>
    <figure className={`${styles.coverPhoto} ${!image ? styles.coverPlaceholder : ''}`}>
      <div>{image ? <Image src={image} alt={typo(alt || title)} fill priority quality={90} sizes="(max-width: 767px) 100vw, 1280px" style={objectPosition ? { objectPosition } : undefined} /> : <div role="img" aria-label={`Место для фотографии: ${title}`}><span>Фотография маршрута</span><span>{typo(title)}</span></div>}</div>
      <figcaption><span>{typo(title)}</span><a href={collection ? '#routes' : '#itinerary'} className={styles.routeLink}>{collection ? 'Выбрать маршрут' : 'Программа поездки'} <ArrowRight size={16} aria-hidden="true" /></a></figcaption>
    </figure>
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
