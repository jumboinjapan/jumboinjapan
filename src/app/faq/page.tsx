const questions = [
  "Как заранее планировать поездку?",
  "Можно ли адаптировать маршрут под детей?",
  "Вы работаете с трансферами и ресторанами?",
  "На каких языках проходит сопровождение?",
];

export default function FaqPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">
        <div className="max-w-2xl space-y-4">
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">FAQ</h1>
        </div>
        <div className="space-y-3">
          {questions.map((question) => (
            <article key={question} className="border-b border-[var(--border)] py-6">
              <h2 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25]">{question}</h2>
              <p className="mt-2 text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
