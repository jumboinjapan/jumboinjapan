"use client";

import { useMemo, useState } from "react";

interface ImageCarouselProps {
  images?: string[];
  alt?: string;
  imageAlts?: string[];
  /** How many images to show per page on desktop screens. Default 3. */
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
  const mobilePerPage = 1;
  const [page, setPage] = useState(0);

  const totalPages = Math.max(Math.ceil(slides.length / perPage), 1);
  const safePage = Math.min(page, totalPages - 1);

  const visibleDesktop = useMemo(() => {
    const items = slides.slice(safePage * perPage, safePage * perPage + perPage);

    while (items.length < perPage) {
      items.push("");
    }

    return items;
  }, [page, perPage, safePage, slides]);

  const visibleMobile = useMemo(() => {
    const items = slides.slice(safePage * mobilePerPage, safePage * mobilePerPage + mobilePerPage);

    while (items.length < mobilePerPage) {
      items.push("");
    }

    return items;
  }, [safePage, slides]);

  if (slides.length === 0) {
    return <div className="aspect-[3/1] w-full bg-[var(--surface)]" />;
  }

  return (
    <div className="w-full space-y-4">
      <div className="grid gap-2 md:hidden">
        {visibleMobile.map((src, i) => (
          <div key={`mobile-${safePage}-${i}`} className="aspect-[4/3] overflow-hidden bg-[var(--surface)]">
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={imageAlts?.[safePage * mobilePerPage + i] ?? resolveAltText(src, alt)}
                width={1200}
                height={900}
                className="h-full w-full object-cover"
                loading={safePage === 0 && i === 0 ? undefined : "lazy"}
              />
            )}
          </div>
        ))}
      </div>

      <div className="hidden gap-2 md:flex">
        {visibleDesktop.map((src, i) => (
          <div key={`desktop-${safePage}-${i}`} className="aspect-square flex-1 overflow-hidden bg-[var(--surface)]">
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={imageAlts?.[safePage * perPage + i] ?? resolveAltText(src, alt)}
                width={1200}
                height={1200}
                className="h-full w-full object-cover"
                loading={safePage === 0 && i === 0 ? undefined : "lazy"}
              />
            )}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            aria-label="Предыдущая группа"
            onClick={() => setPage((current) => (current - 1 + totalPages) % totalPages)}
            className="inline-flex min-h-[44px] items-center px-2 text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] disabled:opacity-30"
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
                aria-current={i === safePage ? "page" : undefined}
                onClick={() => setPage(i)}
                className={`h-1.5 w-8 transition-colors ${
                  i === safePage ? "bg-[var(--accent)]" : "bg-[var(--border)] hover:bg-[var(--surface)]"
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            aria-label="Следующая группа"
            onClick={() => setPage((current) => (current + 1) % totalPages)}
            className="inline-flex min-h-[44px] items-center px-2 text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] disabled:opacity-30"
            disabled={totalPages <= 1}
          >
            Вперёд →
          </button>
        </div>
      )}
    </div>
  );
}
