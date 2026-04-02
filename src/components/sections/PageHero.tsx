import Image from "next/image";

interface PageHeroProps {
  image: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  objectPosition?: string;
}

export function PageHero({ image, eyebrow, title, subtitle, objectPosition = "center" }: PageHeroProps) {
  return (
    <section className="relative aspect-[16/9] md:aspect-auto md:h-[92vh] md:min-h-[560px]">
      <Image
        src={image}
        alt={title}
        fill
        className="object-cover"
        style={{ objectPosition }}
        priority
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, transparent 40%, rgba(15,8,3,0.7) 100%)",
        }}
      />
      <div className="absolute bottom-0 left-0 right-0 px-5 pb-12 md:px-16 md:pb-20">
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
