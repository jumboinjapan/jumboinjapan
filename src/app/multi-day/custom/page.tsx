import type { Metadata } from "next";
import { UnderConstruction } from "@/components/sections/UnderConstruction";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function MultiDayCustomPage() {
  return (
    <UnderConstruction
      title="Своим маршрутом"
      message="Раздел с индивидуальными маршрутами готовится к публикации. Напишите мне — обсудим ваши интересы."
    />
  );
}
