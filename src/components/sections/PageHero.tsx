import Image from "next/image";

// Параметры затемнения-кармана (макет 2c) — все ручки в одном месте:
// на светлых фото крутить только эти константы.
const POCKET_COLOR = "rgba(10,5,2,0.72)";
const POCKET_GRADIENT_BOTTOM = `linear-gradient(to bottom, transparent, ${POCKET_COLOR} 78%)`;
const POCKET_GRADIENT_TOP = `linear-gradient(to top, transparent, ${POCKET_COLOR} 78%)`;
// Подложка мобильного текстового блока (макет 2b): тон затемнения.
const PLINTH_COLOR = "#17100a";

interface PageHeroProps {
  image: string;
  alt?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  objectPosition?: string;
  textPosition?: "top" | "bottom";
}

export function PageHero({ image, alt, eyebrow, title, subtitle, objectPosition = "center", textPosition = "bottom" }: PageHeroProps) {
  const isTop = textPosition === "top";
  // Потолок пропорции по ШИРИНЕ (2026-07-22, макет 2a): до 2048px лента
  // full-bleed ровно 2:1, шире — 2048×1024 по центру с полями на var(--bg).
  // max-h-[92vh] — страховка низких окон (дрейф до ~2.2–2.3, текст не режется).
  return (
    <section className="relative md:aspect-[2/1] md:max-h-[92vh] md:min-h-[560px] md:max-w-[2048px] md:mx-auto">
      {/* Мобиле: кадр 16:9 целиком в потоке; md+: картинка растянута на секцию */}
      <div className="relative aspect-[16/9] md:absolute md:inset-0 md:aspect-auto">
        <Image
          src={image}
          alt={alt ?? title}
          fill
          className="object-cover"
          style={{ objectPosition }}
          priority
          sizes="100vw"
        />
        {/* Шов: низ фото вплавляется в подложку текстового блока (только мобиле) */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] md:hidden"
          style={{ background: `linear-gradient(to bottom, transparent, ${PLINTH_COLOR})` }}
        />
      </div>
      {/* Десктоп: локальный карман под текстом вместо одеяла на весь кадр */}
      <div
        className="absolute hidden md:block"
        style={
          isTop
            ? { left: 0, right: "40%", top: 0, bottom: "34%", background: POCKET_GRADIENT_TOP }
            : { left: 0, right: "40%", top: "34%", bottom: 0, background: POCKET_GRADIENT_BOTTOM }
        }
      />
      {/* Мобиле: текст в потоке на тёмной подложке (bg-[#17100a] = PLINTH_COLOR);
          md+: поверх кадра, как раньше */}
      <div
        className={`relative bg-[#17100a] px-5 pt-4 pb-[22px] md:absolute md:left-0 md:right-0 md:bg-transparent md:px-16 md:pt-0 md:pb-0 ${isTop ? "md:top-0 md:pt-20" : "md:bottom-0 md:pb-20"}`}
      >
        {eyebrow && (
          <p className="text-xs font-medium tracking-[0.16em] uppercase text-[#d4955a] mb-4">
            {eyebrow}
          </p>
        )}
        <h1 className="font-sans font-medium text-[clamp(32px,5vw,60px)] tracking-[-0.03em] leading-[1.1] text-white max-w-2xl mb-5">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[15px] font-light leading-[1.75] text-white/70 max-w-lg">
            {subtitle}
          </p>
        )}
      </div>
    </section>
  );
}
