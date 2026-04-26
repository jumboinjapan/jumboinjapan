import { MissionControlCommandCenter } from '@/components/admin/MissionControlCommandCenter'

export const metadata = {
  title: 'Mission Control • Command Center',
  description: 'Single activity funnel. Doctrine enforced. Calm operational workspace.',
  robots: {
    index: false,
    follow: false,
  },
}

export default function MissionControlPage() {
  return <MissionControlCommandCenter />
}
