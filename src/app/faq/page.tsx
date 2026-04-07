import type { Metadata } from "next";
import { UnderConstruction } from "@/components/sections/UnderConstruction";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function FaqPage() {
  return (
    <UnderConstruction
      title="FAQ"
      message="Раздел с ответами на частые вопросы готовится к публикации. Если у вас есть вопрос — напишите мне напрямую."
    />
  );
}
