/** "182 ms", "2.4 s", "1 min 05 s", "1 h 02 min". */
export function formatDuration(ms: number): string {
  if (Math.round(ms) < 1000) return `${Math.round(ms)} ms`
  const tenths = Math.round(ms / 100)
  if (tenths < 600) return `${(tenths / 10).toFixed(1)} s`
  const total = Math.round(ms / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (total < 3600) return `${Math.floor(total / 60)} min ${pad(total % 60)} s`
  return `${Math.floor(total / 3600)} h ${pad(Math.floor((total % 3600) / 60))} min`
}

/** Wall-clock time as hh:mm:ss (24 h, local time). */
export function formatClock(timestamp: number): string {
  const d = new Date(timestamp)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}
