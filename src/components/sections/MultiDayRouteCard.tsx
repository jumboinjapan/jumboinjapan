import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Bus, CarFront, Plane, TrainFront } from 'lucide-react'
import type { MultiDayRouteCardSpec, MultiDayTransportMode } from '@/data/multiDayRouteCards'

const transportIcons: Record<MultiDayTransportMode, typeof TrainFront> = {
  train: TrainFront,
  car: CarFront,
  bus: Bus,
  flight: Plane,
}

/**
 * Карточка программы на хабе /multi-day — формат вывода и статических
 * маршрутов, и опубликованных из конструктора. Редизайн 2026-07-10:
 * убраны caps+letter-spacing на кириллице (лейблы обрезались:
 * «ДЛИТЕЛЬНОСТ»), вложенные рамки в «Логистике» (коробка в коробке с
 * кружками) и разнобой CTA; параметры — тихая строка на hairline'ах,
 * а не таблица в собственной раме.
 */
export function MultiDayRouteCard({
  title,
  description,
  durationLabel,
  slug,
  image,
  startCity,
  regionCountLabel,
  regionLabelText = 'Охват',
  transportModes,
  transportLabel,
}: MultiDayRouteCardSpec) {
  return (
    <article className="h-full">
      <Link
        href={`/${slug}`}
        className="group flex h-full flex-col overflow-hidden rounded-lg border border-transparent bg-[var(--surface)] shadow-[var(--shadow-1)] transition-all duration-[var(--duration-base)] ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[var(--shadow-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--bg-warm)]"
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

        <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
          {/* Параметры: тихая строка на разделителях — без рамочной таблицы,
              лейблы в sentence case (кириллический капс с трекингом обрезался) */}
          <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-b border-[var(--border)] pb-3.5">
            <div className="pr-3">
              <p className="text-[11px] font-medium text-[var(--text-muted)]">Длительность</p>
              <p className="mt-0.5 text-[14px] font-medium tracking-[-0.01em] text-[var(--text)]">{durationLabel}</p>
            </div>
            <div className="px-3">
              <p className="text-[11px] font-medium text-[var(--text-muted)]">Старт</p>
              <p className="mt-0.5 truncate text-[14px] font-medium tracking-[-0.01em] text-[var(--text)]">{startCity}</p>
            </div>
            <div className="pl-3">
              <p className="text-[11px] font-medium text-[var(--text-muted)]">{regionLabelText}</p>
              <p className="mt-0.5 truncate text-[14px] font-medium tracking-[-0.01em] text-[var(--text)]">{regionCountLabel}</p>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-2.5 pt-4">
            <h3 className="font-sans text-[20px] font-medium leading-[1.25] tracking-[-0.01em] text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
              {title}
            </h3>
            <p className="font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{description}</p>
          </div>

          {/* Логистика: одна строка, без вложенных рамок и кружков */}
          <div className="mt-4 flex items-center gap-2 border-t border-[var(--border)] pt-3.5 text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5 text-[var(--accent)]">
              {transportModes.map((mode) => {
                const Icon = transportIcons[mode]
                return <Icon key={`${title}-${mode}`} className="h-4 w-4" aria-hidden="true" />
              })}
            </span>
            <span className="text-[13px] font-light leading-[1.6]">{transportLabel}</span>
          </div>

          <span className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--accent)]">
            Посмотреть маршрут
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </div>
      </Link>
    </article>
  )
}
