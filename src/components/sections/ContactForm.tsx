"use client";

import { useState } from "react";

import { trackEvent } from "@/lib/analytics";

type FormState = "idle" | "success" | "error";

export function ContactForm() {
  const [state, setState] = useState<FormState>("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [profileUrl, setProfileUrl] = useState<string | null>(null);
  // Время монтирования — для антиспам-проверки на сервере (боты шлют мгновенно).
  const [mountedAt] = useState(() => Date.now());

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setState("idle");

    const formData = new FormData(event.currentTarget);
    const payload = {
      name: String(formData.get("name") ?? ""),
      contact: String(formData.get("contact") ?? ""),
      travelDate: String(formData.get("travelDate") ?? ""),
      groupSize: String(formData.get("groupSize") ?? ""),
      interests: String(formData.get("interests") ?? ""),
      // Антиспам: honeypot (скрытое поле, люди его не видят) и время заполнения.
      hp: String(formData.get("website") ?? ""),
      elapsedSeconds: Math.round((Date.now() - mountedAt) / 1000),
    };

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = (await response.json().catch(() => null)) as { profileUrl?: string } | null;
      setProfileUrl(data?.profileUrl ?? null);
      event.currentTarget.reset();
      setState("success");
      trackEvent("generate_lead", { form: "contact" });
    } catch {
      setState("error");
      trackEvent("contact_form_error", { form: "contact" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border bg-[var(--surface)] p-5 md:p-6">
      {/* Honeypot: поле скрыто от людей, но боты-автозаполнители его заполняют. */}
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">
          Имя
        </label>
        <input
          id="name"
          name="name"
          required
          className="min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="contact" className="text-sm font-medium">
          Email или Telegram
        </label>
        <input
          id="contact"
          name="contact"
          required
          className="min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="travelDate" className="text-sm font-medium">
          Когда планируете поездку
        </label>
        <input
          id="travelDate"
          name="travelDate"
          className="min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="groupSize" className="text-sm font-medium">
          Количество человек
        </label>
        <select
          id="groupSize"
          name="groupSize"
          className="min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            Выберите вариант
          </option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3-4">3–4</option>
          <option value="5+">5+</option>
        </select>
      </div>

      <div className="space-y-2">
        <label htmlFor="interests" className="text-sm font-medium">
          Расскажите о своих интересах
        </label>
        <textarea
          id="interests"
          name="interests"
          rows={5}
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex min-h-11 w-full items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-wide text-white uppercase transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--bg-warm)]"
      >
        {isSubmitting ? "Отправка..." : "Обсудить маршрут"}
      </button>

      {state === "success" ? (
        <div className="space-y-3">
          <p className="text-sm text-green-700">Спасибо! Сообщение отправлено.</p>
          {profileUrl ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-warm)] p-4">
              <p className="text-sm font-light leading-[1.7] text-[var(--text-muted)]">
                Если удобнее, о поездке можно рассказать сейчас — это минуты три. По ответам я соберу первый
                набросок маршрута. Это необязательно: можно просто дождаться моего ответа.
              </p>
              <a
                href={profileUrl}
                onClick={() => trackEvent("questionnaire_open", { source: "contact_form_success" })}
                className="mt-3 inline-flex min-h-10 items-center border border-[var(--accent)] px-5 py-2 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
              >
                Рассказать о поездке
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
      {state === "error" ? (
        <p className="text-sm text-red-700">Не удалось отправить форму. Попробуйте позже.</p>
      ) : null}
    </form>
  );
}
