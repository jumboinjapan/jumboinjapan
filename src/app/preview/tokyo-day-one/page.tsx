import type { Metadata } from 'next'
import Image from 'next/image'
import { ArrowDown, ArrowUpRight, ChevronDown } from 'lucide-react'
import { notFound } from 'next/navigation'
import { typo } from '@/lib/typography'
import styles from './preview.module.css'

/**
 * THESIS: A visitor can judge the day's pace before reading the itinerary.
 * OWN-WORLD: Existing warm public palette, Lora headings, Geist body, real site photos.
 * STORY: Understand the format, see the route's logic, clarify needs with the guide.
 * FIRST VIEWPORT: Existing Tokyo image, left-aligned title and action, facts below.
 * FORM: Extension of the existing route page; no new identity or concept seed.
 * Review-only copy based on the current day-one route; no Airtable reads or writes.
 * Production is deliberately unavailable, even if this branch is merged later.
 */

export const metadata: Metadata = {
  title: 'Макет — первый день в Токио',
  description: 'Редакционный макет страницы маршрута для обсуждения.',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  alternates: { canonical: 'https://jumboinjapan.com/city-tour/day-one' },
  openGraph: {
    title: 'Макет — первый день в Токио',
    description: 'Практическая информация, логика маршрута и вопросы перед поездкой.',
    images: [{ url: '/hero-city-tour-day-one-tokyo-tower.jpg' }],
  },
}

const facts = [
  ['Длительность', '6–8 часов', 'Программа на один день'],
  ['Формат', 'С гидом на русском', 'Маршрут под вашу группу'],
  ['Передвижение', 'Пешком и на транспорте', 'Вариант обсуждаем заранее'],
  ['Стоимость', 'Индивидуальный расчёт', 'Зависит от программы и услуг'],
]

const chapters = [
  {
    time: 'Начало дня',
    title: 'Гинза и сад Хамарикю',
    image: '/tours/city-tour-day-one/hamarikyu-teahouse.jpg',
    alt: 'Чайный домик у воды в саду Хамарикю',
    text: 'Знакомство с городом начинается с Гинзы: архитектуры, витрин и разговора о том, как устроен этот район. Затем маршрут продолжается в Хамарикю. После городских улиц здесь появляется время для прогулки по саду.',
    detail: 'В центре внимания — городской район и сад: две разные стороны Токио в начале одной прогулки.',
  },
  {
    time: 'Середина дня',
    title: 'Цукидзи: время для еды',
    image: '/tours/city-tour-day-one/tsukiji-chef.jpg',
    alt: 'Приготовление еды на рынке Цукидзи',
    text: 'На внешнем рынке Цукидзи разговор о городе продолжается через еду. Здесь можно познакомиться с прилавками и выбрать то, что хочется попробовать. Предпочтения в еде и ограничения лучше обсудить до поездки.',
    detail: 'Обед — часть планирования дня. Его формат и расходы обсуждаем при составлении программы.',
  },
  {
    time: 'Вторая половина дня',
    title: 'Мэйдзи, Харадзюку и Сибуя',
    image: '/tours/city-tour-day-one/meiji-jingu.jpg',
    alt: 'Святилище Мэйдзи в Токио',
    text: 'У Мэйдзи говорим о синтоизме и месте святилищ в японской жизни. В Харадзюку тема меняется: мода, вкусы и самовыражение. Сибуя завершает знакомство с современным городом.',
    detail: 'Если хочется меньше остановок и больше времени на одну тему, состав второй половины дня можно обсудить отдельно.',
  },
]

const questions = [
  {
    q: 'Сколько придётся ходить пешком?',
    a: 'В городской программе заметная часть дня проходит пешком. Переезды между районами можно организовать на общественном, частном или заказном транспорте. Точную дистанцию и количество переходов нужно определить для выбранного варианта; сам по себе автомобиль не превращает этот маршрут в полностью автомобильную экскурсию.',
  },
  {
    q: 'Подойдёт ли этот день для поездки с детьми?',
    a: 'Маршрут можно адаптировать под интересы группы. При обсуждении важны возраст детей, привычная продолжительность прогулок и темы, которые им интересны. Это поможет выбрать остановки и транспорт, а не пытаться вместить полную программу в любой день.',
  },
  {
    q: 'Что входит в стоимость?',
    a: 'Фиксированного тарифа для этой страницы нет: стоимость рассчитывается индивидуально. При обсуждении нужно отдельно согласовать услуги гида, транспорт, входные билеты и питание. Состав оплаты определяется для вашей программы до подтверждения поездки.',
  },
  {
    q: 'Как будет устроен день, если пойдёт дождь?',
    a: 'В этой программе есть прогулки по саду и городским улицам. Если погода меняется, нужно отдельно обсудить состав остановок, продолжительность прогулок и вариант транспорта. Условия переноса или отмены согласуются при обсуждении поездки.',
  },
  {
    q: 'Можно изменить остановки или сократить программу?',
    a: 'Да, маршрут и темп обсуждаются под вашу группу. Если особенно интересны еда, архитектура или повседневная жизнь города, это стоит указать в обращении. Продолжительность 6–8 часов относится к описанному здесь варианту, а сокращённая программа требует отдельного расчёта.',
  },
]

const text = typo

export default function TokyoDayOnePreview() {
  if (process.env.VERCEL_ENV === 'production') notFound()

  return (
    <div className={styles.page}>
      <aside className={styles.previewNote} aria-label="Статус макета">
        <div className={styles.container}>
          <p><strong>Макет для обсуждения.</strong> {text('Тексты новых блоков — редакционный вариант.')}</p>
          <a href="https://jumboinjapan.com/city-tour/day-one" target="_blank" rel="noreferrer">
            Действующая страница <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
      </aside>

      <section className={styles.hero} aria-labelledby="tour-title">
        <Image src="/hero-city-tour-day-one-tokyo-tower.jpg" alt="Токийская башня среди городской застройки" fill priority quality={90} sizes="100vw" className={styles.heroImage} />
        <div className={styles.heroShade} />
        <div className={`${styles.container} ${styles.heroContent}`}>
          <p className={styles.eyebrow}>{text('Частная экскурсия • Токио')}</p>
          <h1 id="tour-title">Первый день<br />{text('в Токио')}</h1>
          <p className={styles.heroIntro}>{text('Гинза, Хамарикю, Цукидзи, Мэйдзи, Харадзюку и Сибуя. Знакомство с городом в сопровождении русскоязычного гида.')}</p>
          <a className={styles.heroAction} href="#day-at-a-glance">Подойдёт ли мне этот маршрут <ArrowDown size={18} aria-hidden="true" /></a>
        </div>
      </section>

      <section className={styles.factsBand} aria-label="Коротко о маршруте">
        <dl className={`${styles.container} ${styles.facts}`}>
          {facts.map(([label, value, note]) => <div key={label}>
            <dt>{text(label)}</dt>
            <dd>{text(value)}<span>{text(note)}</span></dd>
          </div>)}
        </dl>
      </section>

      <nav className={`${styles.container} ${styles.contents}`} aria-label="На этой странице">
        <a href="#day-at-a-glance">Кому подойдёт</a>
        <a href="#guide-perspective">Логика маршрута</a>
        <a href="#itinerary">Программа дня</a>
        <a href="#practical-questions">Практические вопросы</a>
      </nav>

      <section id="day-at-a-glance" className={`${styles.container} ${styles.section} ${styles.fit}`} aria-labelledby="fit-title">
        <div>
          <p className={styles.kicker}>Перед выбором маршрута</p>
          <h2 id="fit-title">Один день,<br />{text('несколько сторон Токио')}</h2>
        </div>
        <div className={styles.prose}>
          <p className={styles.lead}>{text('Этот маршрут подойдёт для первого знакомства с городом, если хочется совместить городские районы, сад, святилище и еду в течение одного дня.')}</p>
          <p>{text('В программе шесть остановок и переезды между районами. Перед поездкой стоит решить, что для вас важнее: пройти весь маршрут или провести больше времени в нескольких местах.')}</p>
          <div className={styles.planningNote}>
            <h3>Если хочется меньше ходить</h3>
            <p>{text('При обсуждении можно выбрать другой темп и транспорт. Для этого важно знать состав группы и как долго вам комфортно гулять без перерыва.')}</p>
          </div>
        </div>
      </section>

      <section id="guide-perspective" className={styles.guideBand} aria-labelledby="guide-title">
        <div className={`${styles.container} ${styles.guideLayout}`}>
          <div className={styles.guideIdentity}>
            <Image src="/about-photo.jpg" alt="Эдуард Ревидович, частный гид по Японии" width={320} height={400} sizes="(max-width: 700px) 100px, 210px" className={styles.portrait} />
            <div><p className={styles.guideName}>Эдуард Ревидович</p><p className={styles.caption}>Частный гид по Японии</p></div>
          </div>
          <div className={styles.prose}>
            <p className={styles.kicker}>О замысле программы</p>
            <h2 id="guide-title">Почему места собраны<br />{text('именно в такой день')}</h2>
            <p className={styles.lead}>{text('Гинза и Хамарикю показывают, как рядом существуют городской район и сад. Цукидзи добавляет к этому разговор о еде. Во второй половине дня Мэйдзи, Харадзюку и Сибуя дают повод поговорить о традициях и современной городской культуре.')}</p>
            <p>{text('Главная идея этой программы — увидеть разные стороны Токио и связать их между собой. Поэтому при выборе остановок важно сохранить время для разговора и самой прогулки.')}</p>
          </div>
        </div>
      </section>

      <section id="itinerary" className={`${styles.container} ${styles.section}`} aria-labelledby="itinerary-title">
        <header className={styles.sectionHeader}>
          <div><p className={styles.kicker}>От Гинзы до Сибуи</p><h2 id="itinerary-title">Как проходит день</h2></div>
          <p>{text('Последовательность базового маршрута. Время начала и детали уточняем при обсуждении.')}</p>
        </header>
        <ol className={styles.chapters}>
          {chapters.map((chapter, index) => <li key={chapter.title} className={styles.chapter}>
            <div className={styles.chapterPhoto}><Image src={chapter.image} alt={chapter.alt} fill sizes="(max-width: 700px) 100vw, 40vw" className={styles.routeImage} /></div>
            <div className={styles.chapterText}>
              <p className={styles.chapterTime}><span>{String(index + 1).padStart(2, '0')}</span>{text(chapter.time)}</p>
              <h3>{text(chapter.title)}</h3>
              <p>{text(chapter.text)}</p>
              <p className={styles.chapterDetail}>{text(chapter.detail)}</p>
            </div>
          </li>)}
        </ol>
      </section>

      <section id="practical-questions" className={styles.questionsBand} aria-labelledby="questions-title">
        <div className={`${styles.container} ${styles.questionsLayout}`}>
          <header><p className={styles.kicker}>До поездки</p><h2 id="questions-title">Практические<br />вопросы</h2><p className={styles.questionsIntro}>{text('То, что помогает выбрать подходящий формат и заранее обсудить детали.')}</p></header>
          <div className={styles.questions}>
            {questions.map((question, index) => <details key={question.q} open={index === 0}>
              <summary>{text(question.q)}<ChevronDown size={20} aria-hidden="true" /></summary>
              <p>{text(question.a)}</p>
            </details>)}
          </div>
        </div>
      </section>

      <section className={`${styles.container} ${styles.section} ${styles.contact}`} aria-labelledby="contact-title">
        <div><p className={styles.kicker}>Ваша поездка</p><h2 id="contact-title">Обсудим ваш<br />{text('первый день в Токио')}</h2></div>
        <div className={styles.prose}>
          <p className={styles.lead}>{text('Для начала достаточно дат, состава группы и нескольких слов о том, что вам интересно.')}</p>
          <p>{text('Стоимость рассчитывается индивидуально. Маршрут и состав услуг согласуем лично. Отправка обращения не подтверждает бронирование.')}</p>
          <a href="https://jumboinjapan.com/contact" className={styles.primaryAction}>Обсудить маршрут <ArrowUpRight size={18} aria-hidden="true" /></a>
          <p className={styles.caption}>Кнопка открывает форму на рабочем сайте.</p>
        </div>
      </section>
    </div>
  )
}
