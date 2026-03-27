import type { Metadata } from 'next'
import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";
import { tours } from '@/data/tours'

const tour = tours.find(t => t.slug === 'from-tokyo/intercity/hakone')!

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    images: [{ url: tour.image }],
  },
}

const tourSchema = {
  "@context": "https://schema.org",
  "@type": "TouristTrip",
  "name": tour.titleEn,
  "description": tour.description,
  "touristType": "Russian-speaking tourists",
  "provider": {
    "@type": "Person",
    "name": "Eduard Revidovich",
    "url": "https://jumboinjapan.com"
  },
  "offers": {
    "@type": "Offer",
    "availability": "https://schema.org/InStock",
    "url": `https://jumboinjapan.com/${tour.slug}`
  }
}

export default function HakonePage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel images={["/tours/hakone/hakone-1.jpg","/tours/hakone/hakone-2.jpg","/tours/hakone/hakone-3.jpg"]} alt="Хаконэ" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Хаконэ</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Хаконэ — это не просто горный курорт в двух часах от Токио. Это место, где вулканическая активность, история феодальной дороги и серьёзная коллекция современного искусства живут в одном пейзаже. Программа выстроена как маршрут: от истории к природе, от воды к огню, от молчания к скульптуре.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Застава Хаконэ</h3>
              <p>Два с половиной века этот пост контролировал тракт Токайдо — главную артерию между Эдо и Киото. Сёгунат Токугава особенно подозрительно относился к женщинам, покидавшим Эдо: жёны самураев содержались в столице как заложники, и любая попытка выехать без документов каралась смертью. Сейчас это музей с точными репликами документов, форм и протоколов этой системы слежки. В ясную погоду отсюда видно озеро Аси и Фудзи за ним.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Святилище Хаконэ</h3>
              <p>Стоит у берега озера Асиноко с 757 года — посвящено покровителю путешественников. Красные тории уходят прямо в воду: когда озеро спокойно, они стоят по щиколотку, в туман — исчезают полностью. Главное божество здесь — девятиглавый дракон, некогда наводивший ужас на округу, пока его не усмирил буддийский монах. Кедры вокруг очень старые, и утренний свет сквозь них такой, что люди невольно останавливаются.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Круиз по озеру Аси</h3>
              <p>Озеро возникло три тысячи лет назад — вулкан провалился внутрь себя, вода заполнила кратер. По нему ходят реплики пиратских галеонов, что звучит нелепо ровно до того момента, как в ясный день Фудзи появляется в такелаже. В центре озеро достигает 24 метров глубины; в тихое утро Фудзи отражается в воде с геометрической точностью.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Канатная дорога</h3>
              <p>Четыре километра над вулканическим ландшафтом, который формально всё ещё активен. Кабинки движутся непрерывно — над серными парами Овакудани, затем спускаются к Тогэндай на берегу озера. В облачные дни облака затягивают снизу и едешь сквозь белое. Овакудани-участок закрывают несколько раз в год, когда показания сейсмографов растут — это либо предупреждение, либо атмосфера, зависит от того, как смотреть.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Кратер Овакудани</h3>
              <p>Активная вулканическая зона: серные фумаролы, кипящие грязевые котлы, и запах, который появляется раньше, чем вид. Местная специальность — куро-тамаго, яйца, сваренные чёрными в минеральных источниках, продаются по пять штук в сетке. Легенда о том, что каждое яйцо прибавляет семь лет жизни — местный маркетинг, переживший всякую иронию. В ясные дни Фудзи виден с гребня.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Музей под открытым небом</h3>
              <p>Здесь к скульптуре относятся так, как Япония относится ко всему, что считает достойным внимания: серьёзно и без иронии. Коллекция — от Родена до Миро, отдельный павильон Пикассо с его керамикой и гравюрами. Работы расставлены по склону холма так, что между ними ходишь, а не проходишь мимо. Среди скульптур — горячие ванночки для ног, что выглядит как шутка ровно до того момента, как сидишь в одной и смотришь на Кальдера.</p>
            </div>
          </div>
        </section>

        <Link
          href="/contact"
          className="inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
        >
          Связаться →
        </Link>
      </div>
    </section>
  );
}
