"use client";

import Image from "next/image";
import { useState } from "react";

interface ImageCarouselProps {
  images?: string[];
  alt?: string;
  /** How many images to show per page. Default 3. */
  perPage?: number;
}

export function ImageCarousel({ images, alt, perPage = 3 }: ImageCarouselProps) {
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
            className="relative flex-1 bg-stone-200 overflow-hidden"
            style={{ aspectRatio: "1/1" }}
          >
            {src && (
              <Image
                fill
                src={src}
                alt={`${alt ?? ""} ${page * perPage + i + 1}`}
                style={{ objectFit: "cover" }}
                sizes="(max-width: 768px) 33vw, 33vw"
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
