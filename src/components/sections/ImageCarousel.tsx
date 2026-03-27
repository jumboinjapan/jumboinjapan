"use client";

import { useState } from "react";

interface ImageCarouselProps {
  images?: string[];
  alt?: string;
  imageAlts?: string[];
  /** How many images to show per page. Default 3. */
  perPage?: number;
}

const IMAGE_ALT_BY_PATH: Record<string, string> = {
  "/tours/hakone/hakone-1.jpg": "Пиратский корабль на озере Аси с видом на гору Фудзи, Хаконэ",
  "/tours/hakone/hakone-2.jpg": "Витражная башня музея под открытым небом Хаконэ",
  "/tours/hakone/hakone-3.jpg": "Чёрное яйцо Овакудани на фоне горы Фудзи",
  "/tours/nikko/nikko-1.jpg": "Водопад Юдаки с осенними клёнами, Никко",
  "/tours/nikko/nikko-2.jpg": "Водопад Кэгон, Никко",
  "/tours/nikko/nikko-3.jpg": "Горная река в ущелье, Никко",
};

function resolveAltText(src: string, fallbackAlt?: string) {
  if (IMAGE_ALT_BY_PATH[src]) {
    return IMAGE_ALT_BY_PATH[src];
  }

  if (!fallbackAlt) {
    return "Фото тура по Японии";
  }

  return `Фото тура: ${fallbackAlt}`;
}

export function ImageCarousel({ images, alt, imageAlts, perPage = 3 }: ImageCarouselProps) {
  const slides = images?.filter(Boolean) ?? [];
  const [page, setPage] = useState(0);

  if (slides.length === 0) {
    return <div className="w-full bg-stone-200" style={{ aspectRatio: "3/1" }} />;
  }

  const totalPages = Math.ceil(slides.length / perPage);
  const visible = slides.slice(page * perPage, page * perPage + perPage);

  // Pad last page so layout stays stable
  while (visible.length < perPage) {
    visible.push("");
  }

  return (
    <div className="w-full">
      <div className="flex gap-2">
        {visible.map((src, i) => (
          <div
            key={`${page}-${i}`}
            className="flex-1 bg-stone-200 overflow-hidden"
            style={{ aspectRatio: "1/1" }}
          >
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={imageAlts?.[page * perPage + i] ?? resolveAltText(src, alt)}
                width={1200}
                height={1200}
                className="w-full h-full object-cover"
              />
            )}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            aria-label="Предыдущая группа"
            onClick={() => setPage((p) => (p - 1 + totalPages) % totalPages)}
            className="px-4 py-2 text-sm font-medium tracking-wide text-[var(--text)] hover:text-[var(--accent)] transition-colors disabled:opacity-30"
            disabled={totalPages <= 1}
          >
            ← Назад
          </button>

          <div className="flex items-center gap-2">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Страница ${i + 1}`}
                onClick={() => setPage(i)}
                className={`h-1.5 w-6 transition-colors ${
                  i === page ? "bg-[var(--accent)]" : "bg-stone-300 hover:bg-stone-400"
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            aria-label="Следующая группа"
            onClick={() => setPage((p) => (p + 1) % totalPages)}
            className="px-4 py-2 text-sm font-medium tracking-wide text-[var(--text)] hover:text-[var(--accent)] transition-colors disabled:opacity-30"
            disabled={totalPages <= 1}
          >
            Вперёд →
          </button>
        </div>
      )}
    </div>
  );
}
