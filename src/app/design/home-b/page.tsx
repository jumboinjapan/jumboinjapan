import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { PreviewSwitch } from '@/components/home-preview/PreviewSwitch'
import { typo, typoDeep } from '@/lib/typography'
import { serviceTerms } from '@/data/service-terms'
import { guideRef } from '@/lib/schema'
import { serializeTourSchema } from '@/lib/tour-schema'
import styles from '@/components/home-preview/HomePreview.module.css'

// This remains a noindex design preview. Change to the homepage URL only on promotion.
const pageUrl = 'https://jumbo-design-preview-2026.vercel.app/design/home-b'
const pageTitle = 'Частный гид по Японии — Эдуард Ревидович'
const pageDescription = 'Индивидуальные экскурсии по Токио, поездки из Токио и многодневные туры по Японии на русском языке. Маршрут под ваши интересы и темп.'
const socialImage = {
  url: 'https://jumbo-design-preview-2026.vercel.app/hero-city-tour-rainbow-bridge-tokyo-tower.jpg',
  width: 3840,
  height: 2560,
  alt: 'Вечерний Токио — путешествия по Японии с Эдуардом Ревидовичем',
}
export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: pageUrl },
  openGraph: {
    type: 'website', locale: 'ru_RU', url: pageUrl, siteName: 'Jumbo in Japan',
    title: pageTitle, description: pageDescription, images: [socialImage],
  },
  twitter: { card: 'summary_large_image', title: pageTitle, description: pageDescription, images: [socialImage] },
}

/* THESIS: Japan is discovered through a sequence of places, at a personal pace.
 * OWN-WORLD: paper, dark botanical ink, Lora titles, Geist captions, unframed photographs.
 * STORY: meet the guide's eye, choose the scale of a trip, open a route, describe your plans.
 * FIRST VIEWPORT: title and compact contents at left; a 3:2 Tokyo photograph at right.
 * FORM: owner-pinned architectural catalogue; an opening spread followed by photographic plates.
 */
const formats = [
  { title: 'Экскурсии по Токио', caption: 'Город в деталях', time: '4–8 часов', href: '/city-tour', image: '/dest-city-tour-tokyo-station.jpg', alt: 'Кирпичный фасад вокзала Токио', text: 'Архитектура, сады и разные характеры районов. Первое знакомство с городом или прогулка за пределами привычных адресов.' },
  { title: 'Поездки из Токио', caption: 'Один день за городом', time: 'На день', href: '/intercity', image: '/tours/nikko/nikko-shinkyo-bridge.webp', alt: 'Красный мост Синкё в тумане, Никко', text: 'Хаконе, Никко, Камакура и Фудзи. Меняем городской пейзаж на горы, лесные святилища и побережье.' },
  { title: 'Туры по Японии', caption: 'Путешествие между местами', time: 'Несколько дней', href: '/multi-day', image: '/dest-multi-day-journeys-hero-20260421c.jpg', alt: 'Пейзаж многодневного путешествия по Японии', text: 'Небольшие города, горные дороги и местная повседневность. Маршрут, в котором есть время остаться подольше.' },
]
const questions = typoDeep([
  ['Вы проводите экскурсии только в Токио?', 'Нет. Я провожу экскурсии по Токио, поездки из Токио и многодневные путешествия по Японии — от Хоккайдо до Окинавы. Город начала и программу обсуждаем при подготовке.'],
  ['Сколько стоит поездка с частным гидом?', serviceTerms.pricing],
  ['Можно ли изменить программу?', 'Да. Маршрут складывается под вашу группу: её интересы, темп и бытовые предпочтения. Готовые программы помогают выбрать направление, а детали мы уточняем вместе.'],
  ['На каком языке проходит поездка?', serviceTerms.language],
  ['С чего начать планирование?', `Укажите в опроснике даты, количество гостей и ваши интересы. Если города уже выбраны, добавьте их. ${serviceTerms.inquiry}`],
])
// Same source as the visible answers; semantic markup, not a promise of Google rich results.
const faqSchema = {
  '@context': 'https://schema.org', '@type': 'FAQPage', '@id': `${pageUrl}#questions`,
  url: `${pageUrl}#questions`, inLanguage: 'ru', author: guideRef,
  mainEntity: questions.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
}
function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className={styles.textLink} href={href}>{children}<ArrowRight size={18} aria-hidden="true" /></Link>
}

export default function HomeAlbumPreview() {
  return <div className={`${styles.preview} ${styles.album}`}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeTourSchema(faqSchema) }} />
    <PreviewSwitch active="b" />
    <div className={styles.container}>
      <section className={styles.opening} aria-labelledby="album-title">
        <div className={styles.openingCopy}>
          <p className={styles.kicker}>Эдуард Ревидович · Jumbo in Japan</p>
          <h1 id="album-title">Япония<br /><em>в деталях.</em><span className={styles.serviceHeading}>{typo('Частный гид по Японии')}</span></h1>
          <p className={styles.intro}>{typo('Индивидуальные экскурсии по Токио, поездки за город и многодневные маршруты от Хоккайдо до Окинавы. На русском языке.')}</p>
          <Link href="#collection" className={styles.textLink}>Выбрать путешествие<ArrowDown size={18} aria-hidden="true" /></Link>
        </div>
        <figure className={styles.openingFigure}>
          <div className={styles.imageFrame}><Image src="/hero-city-tour-rainbow-bridge-tokyo-tower.jpg" alt="Вечерний Токио, Радужный мост и Токийская башня" fill priority sizes="(max-width: 760px) 100vw, 60vw" /></div>
          <figcaption><span>Токио. Между городом и водой</span><span>Jumbo in Japan</span></figcaption>
        </figure>
      </section>
      <section id="collection" className={styles.collection} aria-labelledby="collection-title">
        <div className={styles.sectionHeading}><h2 id="collection-title">Масштаб путешествия</h2><p>{typo('Один город, день за его пределами или дорога через всю страну.')}</p></div>
        <div className={styles.formatGrid}>
          {formats.map(format => <Link href={format.href} className={styles.format} key={format.href}>
            <div className={styles.formatMeta}><span>{format.caption}</span><span>{format.time}</span></div>
            <div className={styles.imageFrame}><Image src={format.image} alt={format.alt} fill sizes="(max-width: 760px) 100vw, 33vw" /></div>
            <h3>{format.title}<ArrowRight size={23} aria-hidden="true" /></h3>
            <p>{typo(format.text)}</p>
          </Link>)}
        </div>
      </section>
      <section className={styles.feature} aria-labelledby="feature-title">
        <figure>
          <div className={styles.imageFrame}><Image src="/tours/hakone/hakone-shrine.webp" alt="Лестница к святилищу Хаконе среди высоких деревьев" fill sizes="(max-width: 760px) 100vw, 55vw" /></div>
          <figcaption>Хаконе. Подъём к святилищу</figcaption>
        </figure>
        <div className={styles.featureCopy}>
          <p className={styles.kicker}>Избранный маршрут · около 10 часов</p>
          <h2 id="feature-title">Хаконе</h2>
          <p className={styles.serifLead}>Горы. Вода. Искусство.</p>
          <p>{typo('Однодневная поездка из Токио: озеро Аси, старая застава, святилище среди деревьев и вулканическая долина. За один день пейзаж меняется несколько раз — вместе с ритмом поездки.')}</p>
          <TextLink href="/intercity/hakone">Программа поездки в Хаконе</TextLink>
          <div className={styles.moreRoutes}><span>Другие направления</span><Link href="/intercity/fuji">Фудзи</Link><Link href="/intercity/nikko">Никко</Link><Link href="/intercity/kamakura">Камакура</Link></div>
        </div>
      </section>
      <section className={styles.author} aria-labelledby="author-title">
        <div className={styles.authorPhoto}><div className={styles.imageFrame}><Image src="/about-photo.jpg" alt="Эдуард Ревидович, частный гид в Японии" fill sizes="(max-width: 760px) 45vw, 260px" /></div><p>Эдуард Ревидович<br /><span>Частный гид в Японии</span></p></div>
        <div><p className={styles.kicker}>Взгляд человека, который здесь живёт</p><h2 id="author-title">«Не бояться<br />менять маршрут»</h2><p>{typo('С моего первого знакомства с Японией прошло уже более 30 лет. Меня по-прежнему восхищают внимание к деталям, тонкое чувство сезонов и отношение к окружающему миру.')}</p><p>{typo('Моя работа — помочь увидеть страну глубже. Дать контекст, заметить деталь и оставить время на то, что окажется важным именно вам.')}</p><a href="https://www.instagram.com/jumboinjapan/" className={styles.textLink}>Япония в моём Instagram<ArrowRight size={18} aria-hidden="true" /></a></div>
      </section>
      <section className={styles.planning} aria-labelledby="planning-title">
        <div className={styles.sectionHeading}><h2 id="planning-title">От замысла к поездке</h2><p>{typo('Программа начинается с ваших планов.')}</p></div>
        <div className={styles.process}>
          <article><h3>Ваши интересы</h3><p>{typo('Даты, состав группы, предпочтительный темп и места, которые хочется увидеть.')}</p></article>
          <article><h3>Мой маршрут</h3><p>{typo('Подходящий формат, последовательность остановок и понятная логистика.')}</p></article>
          <article><h3>Общие детали</h3><p>{typo('Транспорт, бюджет и сезонные акценты. Уточняем программу перед поездкой.')}</p></article>
        </div>
      </section>
      <section id="questions" className={styles.questions} aria-labelledby="questions-title"><div><h2 id="questions-title">Вопросы о поездке</h2><TextLink href="/faq">Все вопросы</TextLink></div><div>{questions.map(([q,a])=><details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div></section>
      <section className={styles.closing}><div><p className={styles.kicker}>Следующая глава — ваша</p><h2>Какую Японию<br />хотите увидеть вы?</h2></div><div><p>{typo('Начнём с нескольких вопросов о вашей поездке. Они помогут выбрать направление и собрать программу.')}</p><Link href="/profile" className={styles.primary}>Заполнить опросник<ArrowRight size={18} aria-hidden="true" /></Link></div></section>
    </div>
  </div>
}
