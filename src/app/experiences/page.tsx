import { ExperiencesGrid } from "@/components/sections/ExperiencesGrid";

export default function ExperiencesPage() {
  return (
    <>
      <section className="px-4 py-10 md:px-6 md:py-14">
        <div className="mx-auto w-full max-w-6xl space-y-3">
          <h1 className="font-serif text-4xl">Маршруты и форматы</h1>
          <p className="max-w-2xl text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
        </div>
      </section>
      <ExperiencesGrid />
    </>
  );
}
