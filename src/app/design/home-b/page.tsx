import { HomeAlbum } from '@/components/home-preview/HomeAlbum'
import { homeMetadata } from '@/components/home-preview/home-metadata'

const pageUrl = 'https://jumbo-design-preview-2026.vercel.app/design/home-b'
export const metadata = { ...homeMetadata, alternates: { canonical: pageUrl }, openGraph: { ...homeMetadata.openGraph, url: pageUrl } }

export default function HomeAlbumPreview() {
  return <HomeAlbum preview />
}
