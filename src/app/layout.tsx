import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileCtaBar } from "@/components/layout/MobileCtaBar";
import "./globals.css";



export const metadata: Metadata = {
  metadataBase: new URL("https://jumboinjapan.vercel.app"),
  alternates: {
    canonical: "./",
  },
  title: "JumboInJapan",
  description: "Личный гид по Японии премиум-сегмента",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${GeistSans.variable}`}>
      <body className={`${GeistSans.className} bg-[var(--bg)] font-sans text-[var(--text)] antialiased`}>

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
