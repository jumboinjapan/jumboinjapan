"use client";

import { usePathname } from "next/navigation";

import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileCtaBar } from "@/components/layout/MobileCtaBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin") ?? false;

  if (isAdminRoute) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <>
      <div className="min-h-screen pb-20 lg:pb-0">
        <Header />
        <main className="pt-20 md:pt-24">{children}</main>
        <Footer />
      </div>
      <MobileCtaBar />
    </>
  );
}
