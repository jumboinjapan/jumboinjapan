import { ExperiencesGrid } from "@/components/sections/ExperiencesGrid";

export default function ExperiencesPage() {
  return (
    <>
      <section className="px-4 py-10 md:px-6 md:py-14">
        <div className="mx-auto w-full max-w-6xl space-y-3">
          <h1 className="font-sans font-bold text-5xl tracking-tight leading-[1.05] md:text-7xl">Как узнавать Японию?</h1>
          <p className="text-[var(--text-muted)]">{"Япония открывается по-разному: через скоростные поезда, автотуры, прогулки по городам, горные маршруты и более размеренные поездки с комфортной логистикой. У каждого путешественника свои интересы, свои привычки, свои возможности и свой бюджет. Именно поэтому при планировании тура в Японию так важно найти формат путешествия, который будет удобен и по-настоящему подходить именно вам."}</p>
        </div>
      </section>
      <ExperiencesGrid />
    </>
  );
}
