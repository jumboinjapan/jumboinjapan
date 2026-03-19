import Link from "next/link";

export function MobileCtaBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--accent-light)] bg-[var(--accent)] p-3 lg:hidden">
      <Link
        href="/contact"
        className="flex min-h-11 w-full items-center justify-center rounded-sm bg-white px-4 py-2 text-sm font-semibold text-[var(--accent)]"
      >
        Обсудить маршрут
      </Link>
    </div>
  );
}
