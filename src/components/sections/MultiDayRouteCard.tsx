import Image from 'next/image'
import Link from 'next/link'
import { Bus, CarFront, Plane, TrainFront } from 'lucide-react'
import type { MultiDayRouteCardSpec, MultiDayTransportMode } from '@/data/multiDayRouteCards'

const transportIcons: Record<MultiDayTransportMode, typeof TrainFront> = {
  train: TrainFront,
  car: CarFront,
  bus: Bus,
  flight: Plane,
}

export function MultiDayRouteCard({
  title,
  description,
  durationLabel,
  slug,
  image,
  startCity,
  regionCountLabel,
  transportModes,
  transportLabel,
}: MultiDayRouteCardSpec) {
  return (
    <article className="h-full">
      <Link
        href={`/${slug}`}
        className="group flex h-full flex-col overflow-hidden rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--bg-warm)]"
        aria-label={`${title} — подробнее`}
      >
        <div className="card-image w-full shrink-0 overflow-hidden">
          <Image
            src={image}
            alt={title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        </div>

        <div className="mt-5 flex flex-1 flex-col gap-4">
          <div className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
            <div className="bg-[var(--bg)] px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Длительность</p>
              <p className="mt-1 text-[13px] font-light leading-[1.6] text-[var(--text-muted)]">{durationLabel}</p>
            </div>
            <div className="bg-[var(--bg)] px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Старт</p>
              <p className="mt-1 text-[13px] font-light leading-[1.6] text-[var(--text-muted)]">{startCity}</p>
            </div>
            <div className="bg-[var(--bg)] px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Охват</p>
              <p className="mt-1 text-[13px] font-light leading-[1.6] text-[var(--text-muted)]">{regionCountLabel}</p>
            </div>
          </div>

          <div className="flex min-h-[9.75rem] flex-1 flex-col gap-3">
            <h3 className="font-sans text-[20px] font-medium leading-[1.25] tracking-[-0.01em] text-[var(--text)]">
              {title}
            </h3>
            <p className="font-sans text-[14px] font-light leading-[1.82] text-[var(--text-muted)]">{description}</p>
          </div>

          <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Логистика</p>
            <div className="mt-2 flex items-center gap-2 text-[var(--text-muted)]">
              {transportModes.map((mode, index) => {
                const Icon = transportIcons[mode]
                return (
                  <div key={`${title}-${mode}`} className="flex items-center gap-2">
                    {index > 0 && <span className="text-[12px] text-[var(--text-muted)]">+</span>}
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] text-[var(--accent)]">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[13px] font-light leading-[1.7] text-[var(--text-muted)]">{transportLabel}</p>
          </div>

          <span className="mt-auto inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors group-hover:text-[var(--accent)] group-hover:underline">
            Посмотреть маршрут →
          </span>
        </div>
      </Link>
    </article>
  )
}
