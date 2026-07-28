import Image from "next/image";

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
  return (
    // Высота задаётся напрямую, без aspect-ratio. При aspect-[16/9] герой на
    // 390px получал 219px высоты, а блок текста прибит к нижнему краю и
    // растёт вверх: надзаголовок уезжал на 30px ВЫШЕ картинки — на кремовый
    // фон и под фиксированную шапку, где его не было видно вообще (аудит
    // 2026-07-27; axe показывал 1.48:1, и это оказалось правдой).
    //
    // Осторожно: aspect-ratio нельзя оставлять вместе с min-height — браузер
    // тогда вычисляет из высоты ШИРИНУ (416 × 16/9 = 740px) и страница
    // уезжает в горизонтальный скролл. Проверено на 320/390/768/1024/1440.
    <section className="relative h-[26rem] md:h-[92vh] md:min-h-[560px]">
      <Image
        src={image}
        alt={alt ?? title}
        fill
        className="object-cover"
        style={{ objectPosition }}
        priority
        sizes="100vw"
        // q=90 вместо `unoptimized`: артефакты, из-за которых оптимизацию
        // когда-то выключили целиком (01fccf1), появлялись на дефолтном
        // q=75. На 90 их не видно, а телефон получает свою ширину вместо
        // сырого файла на 2508px. Список допустимых quality — next.config.ts.
        quality={90}
      />
      <div
        className="absolute inset-0"
        style={{
          background: isTop
            ? "linear-gradient(to bottom, rgba(15,8,3,0.7) 0%, transparent 50%)"
            : "linear-gradient(to bottom, transparent 30%, rgba(10,5,2,0.82) 100%)",
        }}
      />
      <div className={`absolute left-0 right-0 px-5 md:px-16 ${isTop ? "top-0 pt-12 md:pt-20" : "bottom-0 pb-12 md:pb-20"}`}>
        {/* Был захардкоженный #d4955a. Над светлым фото в верхнем варианте
            градиента он давал 3.02:1 — ниже AA, и ничто это не стерегло.
            --accent-soft проходит оба варианта (4.71:1 и 7.75:1) и уже
            используется как надзаголовок в лид-зоне главной. */}
        {eyebrow && (
          <p className="text-xs font-medium tracking-[0.16em] uppercase text-[var(--accent-soft)] mb-4">
            {eyebrow}
          </p>
        )}
        <h1 className="font-medium text-[clamp(32px,5vw,60px)] leading-[1.1] text-white max-w-2xl mb-5">
          {title}
        </h1>
        {subtitle && (
          <p className="text-body-sm font-light leading-[1.75] text-white/70 max-w-lg">
            {subtitle}
          </p>
        )}
      </div>
    </section>
  );
}
