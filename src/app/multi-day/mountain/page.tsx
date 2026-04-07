import type { Metadata } from "next";
import { UnderConstruction } from "@/components/sections/UnderConstruction";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function MultiDayMountainPage() {
  return (
    <UnderConstruction
      title="Горная Япония"
      message="Подробное описание маршрута по Такаяме, Сиракава-го и Канадзаве готовится к публикации."
    />
  );
}
