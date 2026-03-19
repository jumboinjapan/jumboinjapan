"use client";

import { useState } from "react";

type FormState = "idle" | "success" | "error";

export function ContactForm() {
  const [state, setState] = useState<FormState>("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

      event.currentTarget.reset();
      setState("success");
    } catch {
      setState("error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-sm border border-border bg-[var(--surface)] p-5 md:p-6">
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">
          Имя
        </label>
        <input
          id="name"
          name="name"
          required
          className="min-h-11 w-full rounded-sm border border-border bg-white px-3 py-2 text-sm"
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
          className="min-h-11 w-full rounded-sm border border-border bg-white px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="travelDate" className="text-sm font-medium">
          Когда планируете поездку
        </label>
        <input
          id="travelDate"
          name="travelDate"
          className="min-h-11 w-full rounded-sm border border-border bg-white px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="groupSize" className="text-sm font-medium">
          Количество человек
        </label>
        <select
          id="groupSize"
          name="groupSize"
          className="min-h-11 w-full rounded-sm border border-border bg-white px-3 py-2 text-sm"
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
          className="w-full rounded-sm border border-border bg-white px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-light)] disabled:opacity-70"
      >
        {isSubmitting ? "Отправка..." : "Обсудить маршрут"}
      </button>

      {state === "success" ? (
        <p className="text-sm text-green-700">Спасибо! Сообщение отправлено.</p>
      ) : null}
      {state === "error" ? (
        <p className="text-sm text-red-700">Не удалось отправить форму. Попробуйте позже.</p>
      ) : null}
    </form>
  );
}
