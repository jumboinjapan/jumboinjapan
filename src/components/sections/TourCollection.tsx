import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { typo } from '@/lib/typography'
import { TransportCard, type TransportCardProps } from './TransportCard'
import styles from './TourCollection.module.css'

interface TourCollectionProps {
  image: string
  alt: string
  eyebrow: string
  title: string
  subtitle: string
  objectPosition?: string
  children: ReactNode
}

/** Shared presentation only; each page retains its data loading and route URLs. */
export function TourCollection({ image, alt, eyebrow, title, subtitle, objectPosition = 'center', children }: TourCollectionProps) {
  return (
    <div className={styles.collection}>
      <section className={styles.hero} aria-labelledby="tour-title">
        <Image src={image} alt={typo(alt)} fill priority sizes="100vw" quality={90}
          className={styles.heroImage} style={{ objectPosition }} />
        <div className={styles.heroShade} />
        <div className={`${styles.container} ${styles.heroContent}`}>
          <div>
            <p className={styles.eyebrow}>{typo(eyebrow)}</p>
            <h1 id="tour-title" className={styles.heroTitle}>{typo(title)}</h1>
            <p className={styles.heroSubtitle}>{typo(subtitle)}</p>
          </div>
          <a href="#routes" className={styles.heroLink}>
            Смотреть маршруты <ArrowDown size={16} aria-hidden="true" />
          </a>
        </div>
      </section>
      <div className={`${styles.container} ${styles.content}`}>{children}</div>
    </div>
  )
}

export function TourCollectionSection({ id, title, description, children }: {
  id: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHeading}>
        <h2 id={`${id}-title`}>{typo(title)}</h2>
        <p>{typo(description)}</p>
      </div>
      {children}
    </section>
  )
}

export function TourCollectionGrid({ children }: { children: ReactNode }) {
  return <div className={styles.routeGrid}>{children}</div>
}

export function TourCollectionTransport({ options }: { options: readonly TransportCardProps[] }) {
  return (
    <TourCollectionSection id="transport" title="Как будем передвигаться"
      description="Транспорт подбираем под маршрут, состав группы и удобный вам темп.">
      <div className={styles.transportGrid}>
        {options.map((option) => <TransportCard key={option.href} {...option} variant="collection" />)}
      </div>
    </TourCollectionSection>
  )
}

export function TourCollectionContact({ custom = false }: { custom?: boolean }) {
  return (
    <section className={styles.contact} aria-labelledby="contact-title">
      <div>
        <h2 id="contact-title">Ваша поездка, ваш ритм</h2>
        <p>{typo('Даты, интересы и состав вашей группы — с этого начинается маршрут. Программу и стоимость обсуждаем лично.')}</p>
      </div>
      <div className={styles.contactActions}>
        <Link href="/contact" className={styles.primaryLink}>
          Обсудить поездку <ArrowRight size={18} aria-hidden="true" />
        </Link>
        {custom && <Link href="/multi-day/custom" className={styles.textLink}>Об индивидуальном маршруте</Link>}
      </div>
    </section>
  )
}
