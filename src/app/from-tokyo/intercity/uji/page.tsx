import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";

export default function UjiPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Удзи</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Небольшой, почти сонный городок Удзи раскинулся вдоль живописной одноимённой реки между Киото и Нарой. Утренние туманы, стелющиеся над водой, вдохновляли поэтов и придворных. Особый микроклимат и чистейшая вода реки стали идеальными условиями для выращивания самого изысканного чая в стране — именно отсюда родом самые премиальные сорта японского чая.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Прогулка по чайной улочке к Павильону Феникса</h3>
              <p>Маршрут к главной достопримечательности Удзи проходит через уютную торговую улочку, окружённую традиционными лавками. Здесь всё дышит чайной культурой: магазины с вековой историей предлагают сорта матья и гёкуро, а также знаменитые сладости — матья-моти, чайное мороженое и заварные эклеры с зелёным кремом.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Павильон Феникса Бёдо-ин</h3>
              <p>Храм Бёдоин и его Павильон Феникса — жемчужины Удзи. Построен в середине XI века как воплощение буддийского «рая на земле». Его отражение в пруду и дало зданию имя — Хоодо, «Павильон Феникса». Редкий пример архитектуры эпохи Хэйан, дошедший до наших дней почти в неизменном виде. Внутри — сидящий Амида-будда работы мастера Дзётё. Посещение самого павильона требует отдельного бронирования.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Музей повести о Гэндзи</h3>
              <p>Специализированный музей, посвящённый шедевру «Повесть о Гэндзи» придворной дамы Мурасаки Сикибу. Удзи — ключевая локация последних глав романа. Реконструкции костюмов, дворцов и анимированные эпизоды.</p>
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
