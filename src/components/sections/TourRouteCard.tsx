import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { typoDeep } from '@/lib/typography'
import styles from './TourCollection.module.css'

interface TourRouteCardProps {
  title: string
  description: string
  duration: string
  slug: string
  image?: string
  imagePosition?: string
  headingLevel?: 3 | 4
  children?: ReactNode
}

export function TourRouteCard({ children, headingLevel = 3, ...props }: TourRouteCardProps) {
  const { title, description, duration, slug, image, imagePosition } = typoDeep(props)
  const Heading = headingLevel === 4 ? 'h4' : 'h3'
  return (
    <article className={styles.card}>
      <Link href={`/${slug}`} className={styles.cardLink} aria-label={`${title} — посмотреть маршрут`}>
        <div className={styles.cardImage}>
          {image && <Image src={image} alt={title} fill
            style={imagePosition ? { objectPosition: imagePosition } : undefined}
            sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) 46vw, (max-width: 1152px) 30vw, 342px" />}
        </div>
        <div className={styles.cardBody}>
          <p className={styles.duration}>{duration}</p>
          <Heading className={styles.cardTitle}>{title}</Heading>
          <p className={styles.cardDescription}>{description}</p>
          {children}
          <span className={styles.cardAction}>Посмотреть маршрут <ArrowRight size={16} aria-hidden="true" /></span>
        </div>
      </Link>
    </article>
  )
}
