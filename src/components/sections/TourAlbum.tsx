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

export function TourAlbumCover({ title, subtitle, intro, duration, image, alt, objectPosition, collection = false }: {
  title: string; subtitle: string; intro?: string; duration?: string; image: string; alt?: string; objectPosition?: string; collection?: boolean
}) {
  const introPreview = intro ? excerptSentences(intro, 2) : ''
  const hasMoreIntro = Boolean(intro && intro.trim() !== introPreview)
  return <header className={styles.cover}>
    <nav aria-label="Навигационная цепочка" className={styles.breadcrumb}>
      <Link href={collection ? '/' : '/city-tour'}>{collection ? 'Главная' : 'По Токио'}</Link>
      <span aria-hidden="true">/</span><span aria-current="page">{typo(collection ? 'По Токио' : title)}</span>
    </nav>
    <div className={`${styles.coverTop} ${styles.cityCover}`}>
      <div className={styles.coverCopy}>
        <p className={styles.edition}>Индивидуальные {collection ? 'путешествия' : 'экскурсии'}</p>
        <h1>{typo(title)}</h1>
        <p className={styles.subtitle}>{typo(subtitle)}</p>
        {duration && <p className={styles.duration}>{typo(duration)}</p>}
      </div>
      {intro && <div className={styles.guideNote}>
        <p className={styles.guideSummary}>{typo(introPreview)}</p>
        {hasMoreIntro && <details className={styles.intro}><summary>{collection ? 'О поездках по Токио' : 'О маршруте'} <span aria-hidden="true">+</span></summary><p>{typo(intro)}</p></details>}
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
