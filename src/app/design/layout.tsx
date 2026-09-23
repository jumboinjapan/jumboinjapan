import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  if (process.env.VERCEL_ENV === 'production') notFound()
  return children
}
