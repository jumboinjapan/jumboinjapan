import Link from "next/link";
import { eventCategories, getFilteredEvents } from "@/lib/events";

type EventsPageProps = {
  searchParams?: Promise<{
    category?: string;
    month?: string;
    q?: string;
  }>;
};

const categoryLabels: Record<(typeof eventCategories)[number], string> = {
  art: "Искусство",
  festival: "Фестивали",
  market: "Маркеты",
  nature: "Сезонные",
  food: "Еда",
  music: "Музыка",
};

function formatEventDate(dateString: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${dateString}T00:00:00`));
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const activeCategory = resolvedSearchParams.category?.toLowerCase() ?? "";

  const events = getFilteredEvents({
    category: resolvedSearchParams.category,
    month: resolvedSearchParams.month,
    q: resolvedSearchParams.q,
  });

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-24">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="max-w-3xl space-y-3">
          <h1 className="font-sans text-3xl font-medium tracking-tight md:text-4xl">Мероприятия</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Редакционный календарь выставок, фестивалей и сезонных событий в Японии.
          </p>
        </div>

        <div className="overflow-x-auto">
          <div className="flex min-w-max flex-nowrap gap-2 pb-1">
            <Link
              href="/events"
              className={`inline-flex min-h-11 shrink-0 items-center justify-center px-5 py-2 text-sm font-medium tracking-wide uppercase transition-colors ${
                activeCategory === ""
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "border border-[var(--text)] text-[var(--text)] hover:bg-[var(--text)] hover:text-[var(--bg)]"
              }`}
            >
              Все
            </Link>
            {eventCategories.map((category) => {
              const isActive = activeCategory === category;

              return (
                <Link
                  key={category}
                  href={`/events?category=${category}`}
                  className={`inline-flex min-h-11 shrink-0 items-center justify-center px-5 py-2 text-sm font-medium tracking-wide uppercase transition-colors ${
                    isActive
                      ? "bg-[var(--text)] text-[var(--bg)]"
                      : "border border-[var(--text)] text-[var(--text)] hover:bg-[var(--text)] hover:text-[var(--bg)]"
                  }`}
                >
                  {categoryLabels[category]}
                </Link>
              );
            })}
          </div>
        </div>

        {events.length > 0 ? (
          <div className="grid gap-6">
            {events.map((event) => (
              <article key={event.id} className="border border-[var(--border)] bg-white p-6 md:p-7">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                      {categoryLabels[event.category]}
                    </p>
                    <h2 className="font-sans text-2xl font-medium tracking-tight">{event.title}</h2>
                    <p className="text-sm text-[var(--text-muted)]">{event.titleJa}</p>
                  </div>
                  {event.featured ? (
                    <span className="inline-flex w-fit items-center border border-[var(--text)] px-3 py-1 text-xs font-medium tracking-wide uppercase">
                      Featured
                    </span>
                  ) : null}
                </div>

                <div className="mt-5 grid gap-2 text-sm text-[var(--text)] md:grid-cols-2">
                  <p>
                    <span className="text-[var(--text-muted)]">Даты:</span> {formatEventDate(event.dateStart)} —{" "}
                    {formatEventDate(event.dateEnd)}
                  </p>
                  <p>
                    <span className="text-[var(--text-muted)]">Место:</span> {event.venue} ({event.venueJa})
                  </p>
                  <p>
                    <span className="text-[var(--text-muted)]">Район:</span> {event.neighborhood}
                  </p>
                  <p>
                    <span className="text-[var(--text-muted)]">Цена:</span> {event.price}
                  </p>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)]">{event.description}</p>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link
                    href={event.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center border border-[var(--text)] px-5 py-2 text-sm font-medium tracking-wide uppercase transition-colors hover:bg-[var(--text)] hover:text-[var(--bg)]"
                  >
                    Открыть сайт
                  </Link>
                  <Link
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[var(--text-muted)] underline underline-offset-4"
                  >
                    Источник
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="border border-[var(--border)] bg-white p-6 text-sm text-[var(--text-muted)] md:p-7">
            По текущему фильтру ничего не найдено.
          </div>
        )}
      </div>
    </section>
  );
}
