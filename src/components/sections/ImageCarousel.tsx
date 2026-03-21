"use client";

import Image from "next/image";
import { useState } from "react";

interface ImageCarouselProps {
  images?: string[];
  alt?: string;
}

export function ImageCarousel({ images, alt }: ImageCarouselProps) {
  const slides = images?.filter(Boolean) ?? [];

  if (slides.length === 0) {
    return <div className="aspect-[21/9] w-full bg-stone-200" />;
  }

  if (slides.length === 1) {
    return (
      <div className="relative overflow-hidden aspect-[21/9] w-full bg-stone-200">
        <Image fill src={slides[0]} style={{ objectFit: "cover" }} alt={alt ?? ""} />
      </div>
    );
  }

  const [currentIndex, setCurrentIndex] = useState(0);

  const showPrev = () => {
    setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const showNext = () => {
    setCurrentIndex((prev) => (prev + 1) % slides.length);
  };

  return (
    <div className="relative overflow-hidden aspect-[21/9] w-full bg-stone-200">
      <Image fill src={slides[currentIndex]} style={{ objectFit: "cover" }} alt={alt ?? ""} />

      <button
        type="button"
        aria-label="Предыдущее изображение"
        onClick={showPrev}
        className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 px-3 py-2 text-white hover:bg-black/60"
      >
        ←
      </button>

      <button
        type="button"
        aria-label="Следующее изображение"
        onClick={showNext}
        className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 px-3 py-2 text-white hover:bg-black/60"
      >
        →
      </button>

      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2">
        {slides.map((_, index) => (
          <button
            key={index}
            type="button"
            aria-label={`Показать изображение ${index + 1}`}
            onClick={() => setCurrentIndex(index)}
            className={`h-2 w-2 rounded-full ${index === currentIndex ? "bg-white" : "bg-white/50"}`}
          />
        ))}
      </div>
    </div>
  );
}
