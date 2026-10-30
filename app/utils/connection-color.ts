import type { ConnectionColor } from '#core'

// Labels are in the locale files (`colors.<key>`). Literal class names so that Tailwind generates them; the 500 shades stand out on light and dark backgrounds.
export const connectionColorClasses: Record<ConnectionColor, { bg: string, borderLeft: string }> = {
  red: { bg: 'bg-red-500', borderLeft: 'border-l-red-500' },
  orange: { bg: 'bg-orange-500', borderLeft: 'border-l-orange-500' },
  yellow: { bg: 'bg-yellow-500', borderLeft: 'border-l-yellow-500' },
  green: { bg: 'bg-green-500', borderLeft: 'border-l-green-500' },
  blue: { bg: 'bg-blue-500', borderLeft: 'border-l-blue-500' },
  purple: { bg: 'bg-purple-500', borderLeft: 'border-l-purple-500' },
}
