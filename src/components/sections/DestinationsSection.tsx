import Link from "next/link";
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
            Токио, однодневные поездки и многодневные маршруты — с личным гидом и продуманной логистикой.
          </p>
        </div>

        <div className="space-y-[2px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[2px]">
            {[first, second].map((item) => (
              <Link key={item.slug} href={`/from-tokyo/${item.slug}`} className="group block relative overflow-hidden">
                <div className="w-full h-[300px] bg-[var(--bg-warm)] transition-transform duration-500 group-hover:scale-[1.02]" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex flex-col justify-end p-7">
                  <p className="text-white text-[10px] uppercase tracking-[0.16em] opacity-70">{item.duration}</p>
                  <h3 className="mt-2 text-white text-2xl font-medium">{item.title}</h3>
                  <p className="mt-2 text-white text-base leading-[1.9] opacity-75">{item.description}</p>
                </div>
              </Link>
            ))}
          </div>

          {third && (
            <Link href={`/from-tokyo/${third.slug}`} className="group block relative overflow-hidden">
              <div className="w-full h-[200px] bg-[var(--bg-warm)] transition-transform duration-500 group-hover:scale-[1.02]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex flex-col justify-end p-7">
                <p className="text-white text-[10px] uppercase tracking-[0.16em] opacity-70">{third.duration}</p>
                <h3 className="mt-2 text-white text-2xl font-medium">{third.title}</h3>
                <p className="mt-2 text-white text-base leading-[1.9] opacity-75">{third.description}</p>
              </div>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
