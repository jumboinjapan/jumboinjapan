/** Регистрирует ts-alias-hooks.mjs; см. комментарий там. */
import { register } from 'node:module'
register(new URL('./ts-alias-hooks.mjs', import.meta.url))
