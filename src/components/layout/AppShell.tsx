"use client";

import { usePathname } from "next/navigation";

import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileCtaBar } from "@/components/layout/MobileCtaBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin") ?? false;
  // Публичная программа гостя (/p/<token>) — чистый документ без сайт-хрома,
  // как и печатные страницы админки.
  const isBareRoute = isAdminRoute || (pathname?.startsWith("/p/") ?? false);
  const showMobileCta = pathname !== "/contact";

  if (isBareRoute) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <>
      <div className={`min-h-screen ${showMobileCta ? "pb-20 lg:pb-0" : "pb-0"}`}>
        <Header />
        <main className="pt-20 md:pt-24">{children}</main>
        <Footer />
      </div>
      {showMobileCta ? <MobileCtaBar /> : null}
    </>
  );
}
