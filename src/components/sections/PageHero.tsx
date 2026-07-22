import Image from "next/image";

// Параметры затемнения-кармана (макет 2c) — все ручки в одном месте:
// на светлых фото крутить только эти константы.
const POCKET_COLOR = "rgba(10,5,2,0.72)";
const POCKET_GRADIENT_BOTTOM = `linear-gradient(to bottom, transparent, ${POCKET_COLOR} 78%)`;
const POCKET_GRADIENT_TOP = `linear-gradient(to top, transparent, ${POCKET_COLOR} 78%)`;
// Мобильное «одеяло» — до P-2 (текст в поток); после P-2 заменяется швом.
const MOBILE_SCRIM_BOTTOM = "linear-gradient(to bottom, transparent 30%, rgba(10,5,2,0.82) 100%)";
const MOBILE_SCRIM_TOP = "linear-gradient(to bottom, rgba(15,8,3,0.7) 0%, transparent 50%)";

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
    <section className="relative aspect-[16/9] md:aspect-[2/1] md:max-h-[92vh] md:min-h-[560px] md:max-w-[2048px] md:mx-auto">
      <Image
        src={image}
        alt={alt ?? title}
        fill
        className="object-cover"
        style={{ objectPosition }}
        priority
        unoptimized
      />
      {/* Мобиле: полноширинный градиент (заменяется швом в P-2) */}
      <div
        className="absolute inset-0 md:hidden"
        style={{ background: isTop ? MOBILE_SCRIM_TOP : MOBILE_SCRIM_BOTTOM }}
      />
      {/* Десктоп: локальный карман под текстом вместо одеяла на весь кадр */}
      <div
        className="absolute hidden md:block"
        style={
          isTop
            ? { left: 0, right: "40%", top: 0, bottom: "34%", background: POCKET_GRADIENT_TOP }
            : { left: 0, right: "40%", top: "34%", bottom: 0, background: POCKET_GRADIENT_BOTTOM }
        }
      />
      <div className={`absolute left-0 right-0 px-5 md:px-16 ${isTop ? "top-0 pt-12 md:pt-20" : "bottom-0 pb-12 md:pb-20"}`}>
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
