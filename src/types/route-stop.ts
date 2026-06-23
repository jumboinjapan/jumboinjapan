import type { TicketDisplayLine } from '@/lib/ticket-display'

export interface RouteStop {
  eyebrow: string
  title: string
  description: string
  workingHours?: string
  minPrice?: number | null
  ticketSummary?: string | null
  ticketDetails?: string[]
  ticketDisplayLines?: TicketDisplayLine[]
}
