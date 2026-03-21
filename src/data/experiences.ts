export interface Experience {
  title: string;
  description: string;
  duration: string;
  slug: string;
}

export const experiences: Experience[] = [
  {
    title: "Обзорный городской тур",
    description: "Токио — это десятки городов в одном. Первые два дня — это попытка понять, что здесь вообще происходит, и сделать это правильно.",
    duration: "4–8 часов",
    slug: "city-tour",
  },
  {
    title: "Между городами",
    description: "Камакура, Никко, Хаконэ, Фудзи — однодневные поездки из Токио. На синкансэне или на машине, с гидом, который знает, куда ехать и где остановиться.",
    duration: "День и больше",
    slug: "intercity",
  },
  {
    title: "Многодневные туры",
    description: "[Placeholder]",
    duration: "2–14 дней",
    slug: "multi-day",
  },
];
