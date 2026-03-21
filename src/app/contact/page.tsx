import { ContactForm } from "@/components/sections/ContactForm";

export default function ContactPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-2">
        <div className="max-w-2xl space-y-4">
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Обсудить маршрут</h1>
          <p className="text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
          <div className="w-full aspect-[4/3] rounded-sm bg-stone-200" />
        </div>
        <ContactForm />
      </div>
    </section>
  );
}
