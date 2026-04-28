import type { Metadata } from 'next'

import { LayoutDecisionPreviewPoll } from '@/components/preview/LayoutDecisionPreviewPoll'

export const metadata: Metadata = {
  title: 'Preview — Layout Poll',
  description: 'Review-only questionnaire for Hakone and Tokyo Day One layout decisions.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-snippet': 0,
      'max-image-preview': 'none',
      'max-video-preview': 0,
    },
  },
}

export default function PreviewLayoutPollPage() {
  return <LayoutDecisionPreviewPoll />
}
