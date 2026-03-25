import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";

export default function KyotoSecondPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel images={["/tours/kyoto-2/kyoto-1.jpg","/tours/kyoto-2/kyoto-2.jpg","/tours/kyoto-2/kyoto-3.jpg"]} alt="Киото 2" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Киото. Продолжение знакомства</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Очень сложно охватить всё самое интересное за один день. Продолжаем покорять древнюю столицу Японии.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Гинкакудзи</h3>
              <p>«Серебряный павильон» — буддийский храм конца XV века, построенный сёгуном Асикага Ёсимаса как загородная резиденция. Несмотря на название, павильон никогда не был покрыт серебром — «серебряный» оттенок связан с отражением лунного света. Символ эстетики ваби-саби. Вокруг — знаменитый сад с белым песком, мхом, камнями и соснами.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Философская тропа</h3>
              <p>Одна из самых живописных прогулочных дорог Киото, протянувшаяся вдоль канала у подножия Восточных гор. Названа в честь философа Нисиды Китаро. Особенно красива в сезон сакуры и багряных клёнов. По пути — кафе, галереи и небольшое святилище Отойо дзиндзя с каменными фигурами мышей — символов учёности и долголетия.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Эйкандо (Зэнрин-дзи)</h3>
              <p>«Обитель клёнов» — храм IX века, прославившийся в XI столетии настоятелем Эйканом, помогавшим бедным и больным. Особая гордость — статуя «оглядывающегося Будды», крайне редкий образ в японском буддийском искусстве. Осенью здесь расстилается огненный ковёр из багряных листьев.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Нандзэн-дзи</h3>
              <p>Главный монастырь школы Риндзай, основан в XIII веке по воле императора Камэяма. У входа — массивные деревянные ворота Санмон, с верхней галереи которых открывается знаменитый вид на Киото. На территории — каменный сад в строгом дзэнском стиле и необычный кирпичный акведук XIX века.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Арасияма</h3>
              <p>Одно из самых поэтичных мест Киото, излюбленный уголок столичной аристократии ещё в эпоху Хэйан. Мост Тогэцу-кё, дзэнский храм Тэнрюдзи, бамбуковый лес Сагано. Также здесь — музей старинных кукол, вилла императора Го Сага, сад мхов Сайходзи, парк с дикими обезьянами и храм Отаги Нэнбуцудзи с тысячью архатов. Арасияма удалена от центра — закладывайте минимум полдня.</p>
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
