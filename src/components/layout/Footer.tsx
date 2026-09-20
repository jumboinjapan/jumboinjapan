import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

import { ObfuscatedEmail } from '@/components/ObfuscatedEmail'
import { serviceTerms } from '@/data/service-terms'
import styles from './Footer.module.css'

const journeys = [
  { href: '/city-tour', label: 'По Токио' },
  { href: '/intercity', label: 'Маршруты из Токио' },
  { href: '/multi-day', label: 'Многодневные туры' },
]
const information = [
  { href: '/journal', label: 'Журнал' },
  { href: '/faq', label: 'Вопросы о поездке' },
  { href: '/contact', label: 'Контакты' },
]

export function Footer({ reserveMobileCta = false }: { reserveMobileCta?: boolean }) {
  return (
    <footer id="site-footer" className={`${styles.footer} ${reserveMobileCta ? styles.withMobileCta : ''}`}>
      <div className={styles.container}>
        <div className={styles.main}>
          <div className={styles.identity}>
            <Link href="/" className={styles.brand} aria-label="Jumbo in Japan — на главную">
              <svg viewBox="11 5 64 80" className={styles.mark} aria-hidden="true">
                <mask id="jj-footer-mark">
                  <rect width="96" height="96" fill="white" />
                  <circle cx="64" cy="16" r="3" fill="black" />
                  <circle cx="22" cy="56" r="3" fill="black" />
                </mask>
                <g mask="url(#jj-footer-mark)">
                  <path d="M 64 16 V 56 A 21 21 0 0 1 22 56" stroke="currentColor" strokeWidth="10" fill="none" strokeLinecap="round" />
                  <circle cx="64" cy="16" r="8.5" fill="#c8502c" />
                  <circle cx="22" cy="56" r="8.5" fill="#c8502c" />
                </g>
              </svg>
              <span>Jumbo<span>in Japan</span></span>
            </Link>
            <p className={styles.description}>Частный гид в Японии.<br />Токио и путешествия по стране.</p>
          </div>

          <nav aria-labelledby="footer-journeys">
            <h2 id="footer-journeys" className={styles.label}>Путешествия</h2>
            <ul className={styles.links}>
              {journeys.map(({ href, label }) => <li key={href}><Link href={href}>{label}</Link></li>)}
            </ul>
          </nav>

          <nav aria-labelledby="footer-information">
            <h2 id="footer-information" className={styles.label}>Полезное</h2>
            <ul className={styles.links}>
              {information.map(({ href, label }) => <li key={href}><Link href={href}>{label}</Link></li>)}
            </ul>
          </nav>

          <div className={styles.contact}>
            <h2 className={styles.label}>Связь</h2>
            <ObfuscatedEmail className={styles.email} />
            <p className={styles.location}>Токио, Япония</p>
            <a href="https://www.instagram.com/revidovich.art/" target="_blank" rel="noopener noreferrer" className={styles.social}>
              Instagram <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className={styles.colophon}>
          <p className={styles.copyright}>© {new Date().getFullYear()} Jumbo in Japan</p>
          <p className={styles.terms}>{serviceTerms.pricing}</p>
        </div>
      </div>
    </footer>
  )
}
