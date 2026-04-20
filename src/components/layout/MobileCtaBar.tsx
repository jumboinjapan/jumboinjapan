"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const BAR_HEIGHT = 56;

export function MobileCtaBar() {
  const [topOffset, setTopOffset] = useState<number | null>(null);

  useEffect(() => {
    const updatePosition = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        setTopOffset(null);
        return;
      }

      const nextTop = Math.max(0, Math.round(viewport.height + viewport.offsetTop - BAR_HEIGHT));
      setTopOffset(nextTop);
    };

    updatePosition();

    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", updatePosition);
    viewport?.addEventListener("scroll", updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("orientationchange", updatePosition);

    return () => {
      viewport?.removeEventListener("resize", updatePosition);
      viewport?.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("orientationchange", updatePosition);
    };
  }, []);

  return (
    <div
      className="fixed inset-x-0 z-40 bg-[var(--accent)] lg:hidden"
      style={{
        top: topOffset === null ? "auto" : `${topOffset}px`,
        bottom: topOffset === null ? 0 : "auto",
        paddingBottom: "env(safe-area-inset-bottom)",
        transform: "translateZ(0)",
      }}
    >
      <Link
        href="/contact"
        className="flex h-14 w-full items-center justify-center px-4 text-sm font-medium tracking-wide text-white uppercase"
      >
        Обсудить маршрут
      </Link>
    </div>
  );
}
