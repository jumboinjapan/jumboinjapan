import { PT_Serif } from 'next/font/google'

// Серифный акцент дизайна опросника «1c Путь» — общий инстанс для формы
// и календаря (Next дедуплицирует, но один источник чище).
export const ptSerif = PT_Serif({ weight: ['400'], style: ['normal', 'italic'], subsets: ['latin', 'cyrillic'] })
