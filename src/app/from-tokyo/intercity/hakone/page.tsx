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
              <p>Два с половиной века этот пост контролировал тракт Токайдо — главную артерию между Эдо и Киото. Сёгунат Токугава особенно подозрительно относился к женщинам, покидавшим Эдо: жёны самураев содержались в столице как заложники, и любая попытка выехать без документов каралась смертью. Музей хранит точные реплики этих бумаг — пропуска, журналы досмотра, формы опознания, — свидетельства государства, которое управляло через страх, а не через доверие. Место выбрано не случайно: с горного перевала дорога просматривалась на километры в обе стороны, и скрыть движение было попросту невозможно.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Святилище Хаконэ</h3>
              <p>Стоит у берега озера Асиноко с 757 года — посвящено покровителю путешественников, которых здесь всегда было много. Красные тории уходят прямо в воду: когда озеро спокойно, они стоят по щиколотку, в туман — исчезают полностью. Главное божество здесь — девятиглавый дракон, некогда наводивший ужас на округу, пока его не усмирил буддийский монах; с тех пор дракон считается защитником этих мест, а не их угрозой. Кедры, которые помнят оба эти периода, стоят вокруг так плотно, что утренний свет проходит сквозь них как сквозь фильтр — и люди невольно останавливаются.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Круиз по озеру Аси</h3>
              <p>Озеро возникло три тысячи лет назад — вулкан провалился внутрь себя, вода заполнила кратер, и с тех пор здесь стоит эта неправдоподобная тишина. По нему ходят реплики пиратских галеонов, что звучит нелепо ровно до того момента, как в ясный день Фудзи появляется в такелаже. Вода достаточно спокойна и достаточно темна, чтобы отражать её с геометрической точностью — и тогда непонятно, где кончается гора и начинается её копия.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Канатная дорога</h3>
              <p>Четыре километра над вулканическим ландшафтом, который формально всё ещё активен. Кабинки движутся непрерывно — над серными парами Овакудани, потом вниз к Тогэндай, где озеро уже ждёт у причала. В облачные дни облака затягивают снизу, и едешь сквозь белое, не видя ни земли, ни неба. Иногда этот участок закрывают совсем — когда сейсмографы начинают говорить то, что лучше принять к сведению.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Кратер Овакудани</h3>
              <p>Активная вулканическая зона: серные фумаролы, кипящие грязевые котлы, и запах, который появляется раньше, чем вид. Местная специальность — куро-тамаго, яйца, сваренные чёрными в минеральных источниках; продаются по пять штук в сетке, и очередь за ними стоит даже в будний день. Легенда о том, что каждое прибавляет семь лет жизни, — очевидный местный маркетинг, но он пережил всякую иронию, потому что люди едят и молча соглашаются.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Музей под открытым небом</h3>
              <p>Здесь к скульптуре относятся так, как Япония относится ко всему, что считает достойным внимания: серьёзно и без иронии. Роден стоит рядом с Миро, отдельный павильон отдан Пикассо — его керамика и гравюры, которые он делал, когда живопись ему уже надоела. Всё это расставлено по склону холма так, что каждый следующий поворот тропы открывает что-то новое — и ты идёшь между работами, а не вдоль них. Среди скульптур встроены горячие ванночки для ног: выглядит как шутка ровно до того момента, как сидишь в одной и смотришь на Кальдера.</p>
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
