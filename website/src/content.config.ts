// Starlight's collections: the docs under src/content/docs, and the UI strings of the landing page and footer in
// English and German under src/content/i18n (read with Astro.locals.t).
import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders'
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema'
import en from './content/i18n/en.json'

// Our own UI strings (landing.*, footer.*): every key of en.json, required in each language and known to Astro.locals.t
const strings = Object.fromEntries(Object.keys(en).map((key) => [key, z.string()])) as {
  [K in keyof typeof en]: z.ZodString
}

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema({ extend: z.object(strings) }) }),
}
