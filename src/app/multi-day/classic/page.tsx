import type { Metadata } from "next";
import { UnderConstruction } from "@/components/sections/UnderConstruction";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function MultiDayClassicPage() {
  return (
    <UnderConstruction
      title="Классическая Япония"
      message="Подробное описание маршрута «Токио — Хаконэ — Киото — Нара — Осака» готовится к публикации."
    />
  );
}
