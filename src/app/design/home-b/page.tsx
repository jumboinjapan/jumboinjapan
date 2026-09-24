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
  { title: 'Экскурсии по Токио', caption: 'Город в деталях', time: '4–8 часов', href: '/city-tour', image: '/dest-city-tour-tokyo-station.jpg', alt: 'Кирпичный фасад вокзала Токио', text: 'Идеальный маршрут для первого знакомства совмещает современную архитектуру и ландшафтный дизайн, знакомит с религией и жизнью современных районов Токио.' },
  { title: 'Поездки из Токио', caption: 'Один день за городом', time: 'На день', href: '/intercity', image: '/tours/nikko/nikko-shinkyo-bridge.webp', alt: 'Красный мост Синкё в тумане, Никко', text: 'Хаконе, Никко, Камакура и Фудзи. Меняем городской пейзаж на горы, лесные святилища и побережье.' },
  { title: 'Туры по Японии', caption: 'Путешествие между регионами', time: 'Несколько дней', href: '/multi-day', image: '/dest-multi-day-journeys-hero-20260421c.jpg', alt: 'Пейзаж многодневного путешествия по Японии', text: 'Погружение в страну. Небольшие города, горные дороги и местная кухня и полное погружение в реальность настоящей Японии.' },
]
const questions = typoDeep([
  ['Вы проводите экскурсии только в Токио?', 'Нет. Я провожу экскурсии по Токио, поездки из Токио и многодневные путешествия по Японии — от Хоккайдо до Окинавы. Город старта и маршрут обсуждаем любые.'],
  ['Сколько стоит поездка с частным гидом?', 'Каждая группа уникальна. Существует минимальный порог для туров в Токио, но в целом стоимость зависит от размера группы, географии поездки, уровня требуемой подготовки.'],
  ['Можно ли изменить программу?', 'Да. Маршрут складывается под вашу группу: её интересы, темп и бытовые предпочтения. Готовые программы помогают выбрать направление, а детали мы уточняем вместе и часто в ходе самой поездки.'],
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
          <h1 id="album-title">Япония<br />в деталях.<span className={styles.serviceHeading}>{typo('Частный гид по Японии')}</span></h1>
          <p className={styles.intro}>{typo('Индивидуальные экскурсии по Токио, выездные туры и многодневные маршруты от Хоккайдо до Окинавы. На русском языке.')}</p>
          <Link href="#collection" className={styles.textLink}>Выбрать путешествие<ArrowDown size={18} aria-hidden="true" /></Link>
        </div>
        <figure className={styles.openingFigure}>
          <div className={styles.imageFrame}><Image src="/hero-city-tour-rainbow-bridge-tokyo-tower.jpg" alt="Вечерний Токио, Радужный мост и Токийская башня" fill priority sizes="(max-width: 760px) 100vw, 60vw" /></div>
          <figcaption><span>Токио. Между небом и водой</span><span>Jumbo in Japan</span></figcaption>
        </figure>
      </section>
      <section id="collection" className={styles.collection} aria-label="Форматы путешествия">
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
          <figcaption>Подъём к святилищу Хаконе</figcaption>
        </figure>
        <div className={styles.featureCopy}>
          <p className={styles.kicker}>Избранный маршрут · около 10 часов</p>
          <h2 id="feature-title">Хаконе</h2>
          <p className={styles.serifLead}>История, природа, искусство</p>
          <p>{typo('Поездка из Токио на день и более: нас ждут горное озеро, старая застава, святилище среди древних кедров и вулканическая долина. Регион также подойдёт ценителям современного и восточного искусства.')}</p>
          <TextLink href="/intercity/hakone">Программа поездки в Хаконе</TextLink>
          <div className={styles.moreRoutes}><span>Другие направления</span><Link href="/intercity/fuji">Фудзи</Link><Link href="/intercity/nikko">Никко</Link><Link href="/intercity/kamakura">Камакура</Link></div>
        </div>
      </section>
      <section className={styles.author} aria-labelledby="author-title">
        <div className={styles.authorPhoto}><div className={styles.imageFrame}><Image src="/about-photo.jpg" alt="Эдуард Ревидович, частный гид в Японии" fill sizes="(max-width: 760px) 45vw, 260px" /></div><p>Эдуард Ревидович<br /><span>Частный гид в Японии</span></p></div>
        <div><p className={styles.kicker}>20+ лет в японском туризме.</p><h2 id="author-title">Моё кредо —<br />«Не бояться менять маршрут»</h2><p>{typo('С моего первого знакомства с Японией прошло уже более 30 лет. Меня по-прежнему восхищает японское внимание к деталям, тонкое чувство сезонности и отношение к окружающему миру.')}</p><p>{typo('Моя задача — помочь увидеть страну за рамками фасада. Дать контекст, объяснить деталь и сохранить время для паузы.')}</p></div>
      </section>
      <section className={styles.planning} aria-labelledby="planning-title">
        <div className={styles.sectionHeading}><h2 id="planning-title">От замысла к поездке</h2><p>{typo('Программа начинается с короткого знакомства.')}</p></div>
        <ol className={styles.process}>
          <li><h3>Ваши задачи</h3><p>{typo('Даты, состав группы, предпочтительный темп и места, которые хочется увидеть.')}</p></li>
          <li><h3>Дизайн тура</h3><p>{typo('Определение ключевых городов, построение логистики, насыщение маршрута точками притяжения.')}</p></li>
          <li><h3>Последние штрихи</h3><p>{typo('Уточняем транспорт, бюджет, сезонные акценты, вносим корректировки.')}</p></li>
        </ol>
      </section>
      <section id="questions" className={styles.questions} aria-labelledby="questions-title">
        <h2 id="questions-title">Частые вопросы</h2>
        <div className={styles.questionGrid}>
          {questions.map(([q, a]) => <article className={styles.questionCard} key={q}>
            <h3>{q}</h3>
            <p>{a}</p>
          </article>)}
          <Link href="/faq" className={styles.allQuestions}>
            <span>Все вопросы</span>
            <ArrowRight size={26} aria-hidden="true" />
          </Link>
        </div>
      </section>
      <section className={styles.closing}><div><h2>Уже бывали<br />в Японии?</h2></div><div><p>{typo('Хотите уникальный маршрут? Расскажите, где уже бывали и что хотите увидеть в следующей поездке.')}</p><Link href="/profile" className={styles.primary}>Ответить на вопросы<ArrowRight size={18} aria-hidden="true" /></Link></div></section>
    </div>
  </div>
}
