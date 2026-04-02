import Image from "next/image";

interface PageHeroProps {
  image: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  objectPosition?: string;
  textPosition?: "top" | "bottom";
}

export function PageHero({ image, eyebrow, title, subtitle, objectPosition = "center", textPosition = "bottom" }: PageHeroProps) {
  const isTop = textPosition === "top";
  return (
    <section className="relative aspect-[16/9] md:aspect-auto md:h-[92vh] md:min-h-[560px]">
      <Image
        src={image}
        alt={title}
        fill
        className="object-cover"
        style={{ objectPosition }}
        priority
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
