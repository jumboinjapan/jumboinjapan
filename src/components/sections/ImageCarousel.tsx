"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

interface ImageCarouselProps {
  images?: string[];
  alt?: string;
  imageAlts?: string[];
  /** Фокус-точки кропа (CSS object-position) параллельно images; дефолт center.
      Один и тот же focal применяется на десктопе (1:1) и мобиле (4:3) —
      сюжет в кадре совпадает между брейкпоинтами. */
  imageFocals?: string[];
  /** How many images to show per page on desktop screens. Default 3. */
  perPage?: number;
}

const IMAGE_ALT_BY_PATH: Record<string, string> = {
  "/tours/hakone/hakone-1.jpg": "Пиратский корабль на озере Аси с видом на гору Фудзи, Хаконе",
  "/tours/hakone/hakone-2.jpg": "Витражная башня музея под открытым небом Хаконе",
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

export function ImageCarousel({ images, alt, imageAlts, imageFocals, perPage = 3 }: ImageCarouselProps) {
  const slides = useMemo(() => images?.filter(Boolean) ?? [], [images]);
  const [page, setPage] = useState(0);

  const totalPages = Math.max(Math.ceil(slides.length / perPage), 1);
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * perPage;

  // Только реальные элементы — без пустых заглушек, добивающих ряд.
  const visible = useMemo(
    () => slides.slice(pageStart, pageStart + perPage),
    [pageStart, perPage, slides],
  );

  if (slides.length === 0) {
    return <div className="aspect-[3/1] w-full bg-[var(--surface)]" />;
  }

  return (
    <div className="w-full space-y-4">
      {/* Мобиле: та же страница, что и на десктопе, кадры 4:3 в столбик —
          пагинация синхронна между брейкпоинтами, все фото достижимы
          (раньше totalPages считался от десктопных 3/страницу, а мобиле
          листал по одному — хвост фото был недоступен). */}
      <div className="grid gap-2 md:hidden">
        {visible.map((src, i) => (
          <div key={`mobile-${pageStart + i}`} className="relative aspect-[4/3] overflow-hidden bg-[var(--surface)]">
            <Image
              src={src}
              alt={imageAlts?.[pageStart + i] ?? resolveAltText(src, alt)}
              fill
              sizes="100vw"
              className="object-cover"
              style={{ objectPosition: imageFocals?.[pageStart + i] ?? "center" }}
              priority={pageStart + i === 0}
            />
          </div>
        ))}
      </div>

      {/* Десктоп: жёсткая сетка repeat(perPage, 1fr) — неполный ряд
          не растягивает ячейки. */}
      <div
        className="hidden gap-2 md:grid"
        style={{ gridTemplateColumns: `repeat(${perPage}, minmax(0, 1fr))` }}
      >
        {visible.map((src, i) => (
          <div key={`desktop-${pageStart + i}`} className="relative aspect-square overflow-hidden bg-[var(--surface)]">
            <Image
              src={src}
              alt={imageAlts?.[pageStart + i] ?? resolveAltText(src, alt)}
              fill
              sizes="(min-width: 768px) 33vw, 100vw"
              className="object-cover"
              style={{ objectPosition: imageFocals?.[pageStart + i] ?? "center" }}
              priority={pageStart + i === 0}
            />
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
