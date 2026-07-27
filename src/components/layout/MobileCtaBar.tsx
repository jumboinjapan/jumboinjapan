import Link from "next/link";

// Панель закреплена у нижнего края стандартным fixed + bottom: 0.
// Прежняя версия вычисляла позицию JS-ом через visualViewport
// (top-offset пересчитывался на каждый scroll/resize) — на iOS панель
// заметно дёргалась при прокрутке и сворачивании адресной строки.
// Современные браузеры корректно держат fixed-элементы у нижнего края
// вьюпорта без скриптов; env(safe-area-inset-bottom) учитывает вырез
// и жестовую полосу iPhone.
export function MobileCtaBar() {
  return (
    // <nav>, а не <div>: панель лежит вне шапки, подвала и main, поэтому
    // была единственным содержимым вне ориентиров — axe отмечал это на
    // 15 из 16 мобильных страниц, а навигация по landmark'ам просто
    // проходила мимо основного мобильного пути к разговору.
    <nav
      aria-label="Быстрые действия"
      className="fixed inset-x-0 bottom-0 z-40 bg-[var(--accent)] xl:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Link
        href="/contact"
        className="flex h-14 w-full items-center justify-center px-4 text-sm font-medium tracking-wide text-white uppercase"
      >
        Обсудить маршрут
      </Link>
    </nav>
  );
}
