import type { ConnectionColor } from '#core'

// Literal class names so that Tailwind generates them; the 500 shades stand out on light and dark backgrounds.
export const connectionColorClasses: Record<ConnectionColor, { label: string, bg: string, borderLeft: string }> = {
  red: { label: 'Rot', bg: 'bg-red-500', borderLeft: 'border-l-red-500' },
  orange: { label: 'Orange', bg: 'bg-orange-500', borderLeft: 'border-l-orange-500' },
  yellow: { label: 'Gelb', bg: 'bg-yellow-500', borderLeft: 'border-l-yellow-500' },
  green: { label: 'Grün', bg: 'bg-green-500', borderLeft: 'border-l-green-500' },
  blue: { label: 'Blau', bg: 'bg-blue-500', borderLeft: 'border-l-blue-500' },
  purple: { label: 'Lila', bg: 'bg-purple-500', borderLeft: 'border-l-purple-500' },
}
