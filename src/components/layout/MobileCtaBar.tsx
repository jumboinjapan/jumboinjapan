"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function MobileCtaBar() {
  const [bottomOffset, setBottomOffset] = useState(0);

  useEffect(() => {
    const updateOffset = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        setBottomOffset(0);
        return;
      }

      const nextOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setBottomOffset(Math.round(nextOffset));
    };

    updateOffset();

    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", updateOffset);
    viewport?.addEventListener("scroll", updateOffset);
    window.addEventListener("resize", updateOffset);
    window.addEventListener("scroll", updateOffset, { passive: true });

    return () => {
      viewport?.removeEventListener("resize", updateOffset);
      viewport?.removeEventListener("scroll", updateOffset);
      window.removeEventListener("resize", updateOffset);
      window.removeEventListener("scroll", updateOffset);
    };
  }, []);

  return (
    <div
      className="fixed inset-x-0 z-40 bg-[var(--accent)] lg:hidden"
      style={{
        bottom: `${bottomOffset}px`,
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
