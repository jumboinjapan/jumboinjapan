import type { Metadata } from 'next'
import HomePage from '@/components/home-preview/ClassicHome'
import { PreviewSwitch } from '@/components/home-preview/PreviewSwitch'
import styles from '@/components/home-preview/HomePreview.module.css'

export const metadata: Metadata = { title: 'Главная А — большое фото', alternates: { canonical: '/design/home-a' } }

// Same homepage markup and copy. Only a scoped CSS treatment is applied.
export default function HomeClassicPreview() {
  return <div className={styles.preview}>
    <PreviewSwitch active="a" />
    <div className={styles.classic}><HomePage /></div>
  </div>
}
