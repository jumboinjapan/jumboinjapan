import type { Metadata } from 'next'
import { PoiReviewWorkspace } from '@/components/admin/PoiReviewWorkspace'

export const metadata: Metadata = { title: 'Разбор импорта POI' }
export default function PoiReviewPage() {
  return <PoiReviewWorkspace />
}
