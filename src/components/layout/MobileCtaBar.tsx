import Link from "next/link";

export function MobileCtaBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 h-14 bg-[var(--accent)] lg:hidden">
      <Link
        href="/contact"
        className="flex h-full w-full items-center justify-center px-4 text-sm font-medium tracking-widest text-white uppercase"
      >
        Обсудить маршрут
      </Link>
    </div>
  );
}
