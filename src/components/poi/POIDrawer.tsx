'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  MapPin,
  ExternalLink,
  Clock,
  Ticket,
  ChevronDown,
  Shrub,
  Castle,
  Landmark,
  Waves,
  ShoppingBag,
  Eye,
  Mountain,
  Sparkles,
} from 'lucide-react';
import type { Poi } from '@/types/poi';
import { Playfair_Display } from 'next/font/google';

const playfair = Playfair_Display({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '700'],
  display: 'swap',
});

/* ── Helpers ─────────────────────────────────────────── */

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  'Shinto Shrine': Landmark,
  'Buddhist Temple': Landmark,
  Museum: Landmark,
  Park: Shrub,
  Castle: Castle,
  Market: ShoppingBag,
  Onsen: Waves,
  District: MapPin,
  Viewpoint: Eye,
  Garden: Shrub,
  Mountain: Mountain,
};

function getCategoryIcon(category: string) {
  return CATEGORY_ICONS[category] ?? Sparkles;
}

/** Parse "Пн: 9:00–17:00 | Вт: 9:00–17:00 | ..." into per-day entries */
function parseHours(raw: string) {
  if (!raw) return [];
  return raw.split('|').map((s) => s.trim()).filter(Boolean);
}

const DAY_ABBREVS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function todayAbbrev(): string {
  const jst = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }),
  );
  return DAY_ABBREVS[jst.getDay()];
}

function formatTickets(poi: Poi): string | null {
  if (!poi.has_tickets) return 'Бесплатный вход';
  if (poi.tickets && poi.tickets.length > 0) {
    const parts = poi.tickets
      .filter((t) => t.available)
      .map((t) => {
        const label = t.name_ru || t.type;
        return t.price != null && t.price > 0
          ? `${label} ¥${t.price.toLocaleString()}`
          : `${label} бесплатно`;
      });
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (poi.min_ticket_price > 0) {
    return poi.min_ticket_price === poi.max_ticket_price
      ? `Вход ¥${poi.min_ticket_price.toLocaleString()}`
      : `Вход ¥${poi.min_ticket_price.toLocaleString()}–¥${poi.max_ticket_price.toLocaleString()}`;
  }
  return null;
}

/* ── Seigaiha SVG placeholder ─────────────────────────── */

function SeigaihaPlaceholder({ category }: { category: string }) {
  const Icon = getCategoryIcon(category);
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-[#F5F0E8]">
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.07]"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 200 200"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <pattern id="seigaiha" x="0" y="0" width="40" height="30" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="30" r="20" fill="none" stroke="#8B4A3C" strokeWidth="1" />
            <circle cx="20" cy="30" r="15" fill="none" stroke="#8B4A3C" strokeWidth="1" />
            <circle cx="20" cy="30" r="10" fill="none" stroke="#8B4A3C" strokeWidth="1" />
            <circle cx="0" cy="30" r="20" fill="none" stroke="#8B4A3C" strokeWidth="1" />
            <circle cx="0" cy="30" r="15" fill="none" stroke="#8B4A3C" strokeWidth="1" />
            <circle cx="0" cy="30" r="10" fill="none" stroke="#8B4A3C" strokeWidth="1" />
            <circle cx="40" cy="30" r="20" fill="none" stroke="#8B4A3C" strokeWidth="1" />
            <circle cx="40" cy="30" r="15" fill="none" stroke="#8B4A3C" strokeWidth="1" />
            <circle cx="40" cy="30" r="10" fill="none" stroke="#8B4A3C" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="200" height="200" fill="url(#seigaiha)" />
      </svg>
      <Icon className="relative z-10 h-16 w-16 text-[#8B4A3C] opacity-30" strokeWidth={1.2} />
    </div>
  );
}

/* ── Main Component ───────────────────────────────────── */

interface POIDrawerProps {
  poi: Poi | null;
  isOpen: boolean;
  onClose: () => void;
  onParentClick?: (id: string) => void;
}

export function POIDrawer({ poi, isOpen, onClose, onParentClick }: POIDrawerProps) {
  const [expanded, setExpanded] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset expanded state when POI changes
  useEffect(() => {
    setExpanded(false);
  }, [poi?.id]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  if (!poi) return null;

  const heroImage = poi.images?.[0];
  const hours = parseHours(poi.hours_ru);
  const today = todayAbbrev();
  const ticketLine = formatTickets(poi);

  // Split description into paragraphs
  const paragraphs = poi.description_ru.split('\n').filter(Boolean);
  const firstParagraph = paragraphs[0] ?? '';
  const restParagraphs = paragraphs.slice(1);
  const hasMore = restParagraphs.length > 0;

  return (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        onClick={handleOverlayClick}
        className={`fixed inset-0 z-50 transition-opacity duration-280 ${
          isOpen ? 'bg-black/30' : 'pointer-events-none bg-black/0'
        }`}
        style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        {/* Desktop: Side Drawer / Mobile: Bottom Sheet */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label={poi.name_ru}
          className={`
            absolute bg-[#FAFAF7] shadow-2xl
            transition-transform duration-280
            
            /* Mobile: bottom sheet */
            inset-x-0 bottom-0 max-h-[95dvh] rounded-t-2xl
            
            /* Desktop: side drawer */
            md:inset-y-0 md:right-0 md:left-auto md:w-[480px] md:max-h-none md:rounded-t-none md:rounded-l-none

            ${isOpen
              ? 'translate-y-0 md:translate-x-0'
              : 'translate-y-full md:translate-y-0 md:translate-x-full'
            }
          `}
          style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
        >
          {/* Mobile drag handle */}
          <div className="flex justify-center pt-2 pb-0 md:hidden">
            <div className="h-1 w-10 rounded-full bg-[#8B4A3C]/20" />
          </div>

          <div className="flex h-full flex-col overflow-y-auto overscroll-contain">
            {/* Hero */}
            <div className="relative h-[45%] min-h-[200px] shrink-0 md:min-h-[260px]">
              {heroImage ? (
                <>
                  <img
                    src={heroImage}
                    alt={poi.name_en}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                </>
              ) : (
                <>
                  <SeigaihaPlaceholder category={poi.category} />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#FAFAF7]/80 to-transparent" />
                </>
              )}

              {/* Close button */}
              <button
                onClick={onClose}
                aria-label="Закрыть"
                className="absolute top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/50"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Title overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <span className="mb-2 inline-block rounded-full bg-[#8B4A3C]/90 px-3 py-1 text-xs font-medium tracking-wide text-white uppercase backdrop-blur-sm">
                  {poi.category}
                </span>
                <h2
                  className={`${playfair.className} text-[28px] leading-tight font-bold ${
                    heroImage ? 'text-white' : 'text-[#1c1209]'
                  }`}
                >
                  {poi.name_ru}
                </h2>
                <p
                  className={`mt-1 text-sm italic ${
                    heroImage ? 'text-white/70' : 'text-[#6b5b4e]'
                  }`}
                >
                  {poi.name_en}
                </p>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 space-y-4 p-5">
              {/* Parent POI */}
              {poi.parent_poi && (
                <button
                  type="button"
                  onClick={() => onParentClick?.(poi.parent_poi!.id)}
                  className="text-sm text-[#6b5b4e] transition-colors hover:text-[#8B4A3C]"
                >
                  ← {poi.parent_poi.name_ru}
                  <span className="ml-1 italic opacity-60">{poi.parent_poi.name_en}</span>
                </button>
              )}

              {/* Description */}
              <div className="text-[15px] leading-relaxed text-[#1c1209]">
                <p>{firstParagraph}</p>
                {hasMore && !expanded && (
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#8B4A3C] transition-colors hover:text-[#8f2514]"
                  >
                    Читать далее
                    <ChevronDown className="h-4 w-4" />
                  </button>
                )}
                {expanded &&
                  restParagraphs.map((p, i) => (
                    <p key={i} className="mt-3">
                      {p}
                    </p>
                  ))}
              </div>

              <hr className="border-[#e8c4a0]/40" />

              {/* Working hours */}
              {hours.length > 0 && (
                <div className="space-y-1">
                  <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#1c1209]">
                    <Clock className="h-4 w-4 text-[#8B4A3C]" />
                    Часы работы
                  </div>
                  <div className="grid grid-cols-1 gap-0.5 text-sm">
                    {hours.map((line, i) => {
                      const isToday = line.startsWith(today);
                      return (
                        <span
                          key={i}
                          className={`rounded px-2 py-0.5 ${
                            isToday
                              ? 'bg-[#8B4A3C]/10 font-medium text-[#8B4A3C]'
                              : 'text-[#6b5b4e]'
                          }`}
                        >
                          {line}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tickets */}
              {ticketLine && (
                <div className="flex items-center gap-2 text-sm text-[#6b5b4e]">
                  <Ticket className="h-4 w-4 text-[#8B4A3C]" />
                  {ticketLine}
                </div>
              )}

              {(hours.length > 0 || ticketLine) && <hr className="border-[#e8c4a0]/40" />}

              {/* Action buttons */}
              <div className="flex gap-3 pb-4">
                {poi.maps_link && (
                  <a
                    href={poi.maps_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#8B4A3C]/30 px-4 py-2.5 text-sm font-medium text-[#8B4A3C] transition-colors hover:bg-[#8B4A3C]/5"
                  >
                    <MapPin className="h-4 w-4" />
                    Google Maps
                  </a>
                )}
                {poi.official_website && (
                  <a
                    href={poi.official_website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-[#6b5b4e] transition-colors hover:bg-[#8B4A3C]/5 hover:text-[#8B4A3C]"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Сайт
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
