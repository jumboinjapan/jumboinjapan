import Link from 'next/link'
import styles from './HomePreview.module.css'

export function PreviewSwitch({ active }: { active: 'a' | 'b' }) {
  return <nav className={styles.switcher} aria-label="Варианты главной страницы">
    <span>Главная / два взгляда</span>
    <div>
      <Link href="/design/home-a" aria-current={active === 'a' ? 'page' : undefined}>А <span>· Большое фото</span></Link>
      <Link href="/design/home-b" aria-current={active === 'b' ? 'page' : undefined}>Б <span>· Архитектурный альбом</span></Link>
    </div>
  </nav>
}
