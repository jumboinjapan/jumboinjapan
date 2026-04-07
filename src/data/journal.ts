export interface JournalPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  source: "manual" | "instagram";
  instagramUrl?: string;
  coverImage?: string;
}

export const journalPosts: JournalPost[] = [
  {
    slug: "pervye-dni-v-tokio",
    title: "Первые дни в Токио",
    excerpt: "Скоро",
    date: "2025-03-01",
    source: "manual",
  },
  {
    slug: "ryokan-i-onsen",
    title: "Рёкан и онсэн: как выбрать",
    excerpt: "Скоро",
    date: "2025-02-15",
    source: "manual",
  },
  {
    slug: "kuda-idti-vecherom",
    title: "Куда идти вечером в Сибуе",
    excerpt: "Скоро",
    date: "2025-01-20",
    source: "manual",
  },
];
