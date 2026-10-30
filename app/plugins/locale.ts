// Applies the language chosen in the application menu; without one, the detected system language stays.
export default defineNuxtPlugin({
  enforce: 'post',
  async setup(nuxtApp) {
    const chosen = useChosenLocale().value
    if (chosen) await nuxtApp.$i18n.setLocale(chosen)
  },
})
