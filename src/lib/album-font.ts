import localFont from 'next/font/local'

// Keep the approved typeface local: Google's extensionless font URLs can break
// the Next.js font loader even on a clean build. Source and OFL accompany assets.
export const albumFont = localFont({
  src: [
    { path: '../assets/fonts/cormorant-garamond/regular.woff2', weight: '300 700', style: 'normal' },
    { path: '../assets/fonts/cormorant-garamond/italic.woff2', weight: '300 700', style: 'italic' },
  ],
  display: 'swap',
  variable: '--font-album',
  adjustFontFallback: 'Times New Roman',
})
