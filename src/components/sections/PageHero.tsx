import Image from "next/image";

// P-3 v2: бесшовный радиальный скрим (макет 2c, фикс жёсткой кромки кармана).
// Один градиент на весь кадр, гаснет плавно во все стороны от текстового угла.
// Все ручки в одном месте: на светлых фото крутить только эти константы.
const SCRIM_RADIAL_BOTTOM =
  "radial-gradient(115% 95% at 18% 100%, rgba(10,5,2,0.78) 0%, rgba(10,5,2,0.5) 45%, transparent 72%)";
const SCRIM_RADIAL_TOP =
  "radial-gradient(115% 95% at 18% 0%, rgba(10,5,2,0.78) 0%, rgba(10,5,2,0.5) 45%, transparent 72%)";
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
  // P-1 v2 (2026-07-23): на обычных экранах hero рендерится как в проде —
  // 92vh во всю ширину (~1.74–1.93:1 на ноутбуках/16:9). Чиним только
  // ультраширь: max-w-[2560px] по центру, шире — поля на var(--bg).
  return (
    <section className="relative md:h-[92vh] md:min-h-[560px] md:max-w-[2560px] md:mx-auto">
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
      {/* Десктоп: бесшовный радиальный скрим от текстового угла — без кромок */}
      <div
        className="pointer-events-none absolute inset-0 hidden md:block"
        style={{ background: isTop ? SCRIM_RADIAL_TOP : SCRIM_RADIAL_BOTTOM }}
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
