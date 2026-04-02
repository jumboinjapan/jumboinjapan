import Link from "next/link";
import Image from "next/image";
import { experiences } from "@/data/experiences";

export function DestinationsSection() {
  const [first, second, third] = experiences;

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-12">
        <div className="max-w-3xl space-y-4">
          <p className="text-[9px] tracking-[0.22em] uppercase text-[var(--gold)]">Куда поедем</p>
          <h2 className="font-sans font-medium text-4xl tracking-[-0.02em] md:text-5xl">Направления</h2>
          <p className="font-sans text-base leading-[1.9] text-[var(--text-muted)]">
            Я живу и работаю в Токио, и это один из лучших городов, чтобы начать знакомство с Японией. Буду рад обсудить с вами возможные идеи, маршруты и формат будущего путешествия.
          </p>
        </div>

        <div className="space-y-[2px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[2px]">
            {[first, second].map((item) => (
              <Link key={item.slug} href={`/tours/${item.slug}`} className="group block relative overflow-hidden">
                <div className="w-full h-[300px] bg-[var(--bg-warm)] transition-transform duration-500 group-hover:scale-[1.02]">
                  {item.image && (
                    <Image
                      src={item.image}
                      alt={item.title}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 50vw"
                    />
                  )}
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/40 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6">
                  <p className="text-white text-[9px] uppercase tracking-[0.18em] opacity-60 mb-1">{item.duration}</p>
                  <h3 className="text-white text-xl font-medium leading-snug mb-2">{item.title}</h3>
                  <p className="text-white text-sm leading-[1.55] opacity-80">{item.description}</p>
                </div>
              </Link>
            ))}
          </div>

          {third && (
            <Link href={`/tours/${third.slug}`} className="group block relative overflow-hidden">
              <div className="w-full h-[240px] bg-[var(--bg-warm)] transition-transform duration-500 group-hover:scale-[1.02]">
                {third.image && (
                  <Image
                    src={third.image}
                    alt={third.title}
                    fill
                    className="object-cover"
                    sizes="100vw"
                  />
                )}
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <p className="text-white text-[9px] uppercase tracking-[0.18em] opacity-60 mb-1">{third.duration}</p>
                <h3 className="text-white text-xl font-medium leading-snug mb-2">{third.title}</h3>
                <p className="text-white text-sm leading-[1.55] opacity-80 w-full">{third.description}</p>
              </div>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
