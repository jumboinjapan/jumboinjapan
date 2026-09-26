# Cormorant Garamond

Local copies of the existing tour typeface, normal and italic, variable weight
300–700 with Latin and Cyrillic glyphs. The shared loader is
`src/lib/album-font.ts`; both tour album and Hakone use it.

Source: [Google Fonts, pinned commit 3dd7884](https://github.com/google/fonts/tree/3dd78844021e948ceb633d1dcee3f7885561b5d9/ofl/cormorantgaramond).
The two original variable TTF files were losslessly wrapped as WOFF2 using
FontTools (`TTFont`, `flavor = 'woff2'`). No glyphs were removed or redesigned.
Redistribution license: [SIL Open Font License 1.1](OFL.txt).

Reason: [Next.js issue 99114](https://github.com/vercel/next.js/issues/99114)
describes the extensionless Google Fonts URLs that intermittently fail font
loading even without a build cache. Local assets avoid that request for this
typeface. Other Google font imports are outside this repair.
