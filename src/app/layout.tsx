import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileCtaBar } from "@/components/layout/MobileCtaBar";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin", "cyrillic"],
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  title: "JumboInJapan",
  description: "Личный гид по Японии премиум-сегмента",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body
        className={`${inter.variable} ${playfairDisplay.variable} bg-[var(--bg)] font-sans text-[var(--text)] leading-relaxed`}
      >
        <div className="min-h-screen pb-20 lg:pb-0">
          <Header />
          <main className="pt-20 md:pt-24">{children}</main>
          <Footer />
        </div>
        <MobileCtaBar />
      </body>
    </html>
  );
}
