import type { Locale } from 'vue-i18n'

/**
 * The language chosen in the application menu (app/plugins/locale.ts applies it on start). A cookie,
 * since localStorage is tied to the port, which the desktop app picks anew on every start.
 */
export const useChosenLocale = () => useCookie<Locale | undefined>('colwerk-locale', { maxAge: 10 * 365 * 24 * 3600 })
