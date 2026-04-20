"use client";

import Link from "next/link";

export function MobileCtaBar() {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 bg-[var(--accent)] lg:hidden"
      style={{
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
