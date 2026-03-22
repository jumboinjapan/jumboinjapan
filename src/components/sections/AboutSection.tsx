import { about } from "@/data/about";

export function AboutSection() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 lg:grid-cols-[260px_1fr] lg:gap-14 lg:items-start">
        <div className="w-full h-[260px] lg:w-[260px] lg:h-[340px] border border-[var(--border)] bg-[var(--bg-warm)] flex items-center justify-center text-[var(--text-muted)] text-sm">
          Фото гида
        </div>

        <div className="space-y-7">
          <div className="space-y-3">
            <p className="text-[9px] uppercase tracking-[0.22em] text-[var(--gold)]">О гиде</p>
            <h2 className="font-sans font-medium text-4xl tracking-[-0.02em] md:text-5xl">Эдуард Ревидович</h2>
            <p className="max-w-[62ch] font-sans text-base font-light leading-[1.9] text-[var(--text-muted)]">{about.bio}</p>
          </div>

          <div className="grid grid-cols-3 gap-4 border-t border-b border-[var(--border)] py-5">
            <div className="space-y-1">
              <p className="font-sans text-[40px] font-light tracking-[-0.02em]">20+</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">лет</p>
            </div>
            <div className="space-y-1">
              <p className="font-sans text-[40px] font-light tracking-[-0.02em]">3</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">языка</p>
            </div>
            <div className="space-y-1">
              <p className="font-sans text-[40px] font-light tracking-[-0.02em]">300+</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">туров</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
