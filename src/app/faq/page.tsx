const questions = [
  "Как заранее планировать поездку?",
  "Можно ли адаптировать маршрут под детей?",
  "Вы работаете с трансферами и ресторанами?",
  "На каких языках проходит сопровождение?",
];

export default function FaqPage() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <h1 className="font-serif text-4xl">FAQ</h1>
        <div className="space-y-3">
          {questions.map((question) => (
            <article key={question} className="rounded-sm border border-border bg-[var(--surface)] p-4">
              <h2 className="font-medium">{question}</h2>
              <p className="mt-2 text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
