const TOKEN_KEY = 'dbm-token'

/** Reads the session token from `#token=…` (dev server, self-hosted binary) and keeps it for reloads. */
function takeToken(): string | null {
  const match = location.hash.match(/token=([0-9a-f]+)/)
  if (match) {
    sessionStorage.setItem(TOKEN_KEY, match[1]!)
    history.replaceState(null, '', location.pathname + location.search)
  }
  return sessionStorage.getItem(TOKEN_KEY)
}

export const sessionToken = ref(takeToken())
window.addEventListener('hashchange', () => (sessionToken.value = takeToken()))

// Desktop app: the launcher hands the token over through a binding (see launcher/main.ts).
const desktopToken = (window as { bindings?: { sessionToken(): Promise<string> } }).bindings?.sessionToken()

const fetcher = $fetch.create({
  async onRequest({ options }) {
    options.headers.set('x-dbm-token', sessionToken.value ?? await desktopToken ?? '')
  },
}) as (url: string, options?: object) => Promise<unknown>

export function api<T = unknown>(url: string, options?: { method?: 'GET' | 'POST' | 'DELETE', body?: unknown }): Promise<T> {
  return fetcher(url, options) as Promise<T>
}

export function errorMessage(e: unknown): string {
  const err = e as { data?: { message?: string }, message?: string }
  return err.data?.message ?? err.message ?? String(e)
}

/**
 * Reads the server-sent events at `url` and calls `onEvent` for each; reconnects when the stream ends
 * or fails. `fetch` instead of `EventSource`, which cannot send the token header.
 */
export async function subscribe(url: string, onEvent: (event: string, data: string) => void): Promise<never> {
  for (;;) {
    try {
      const res = await fetch(url, { headers: { 'x-dbm-token': sessionToken.value ?? await desktopToken ?? '' } })
      const reader = res.ok ? res.body?.pipeThrough(new TextDecoderStream()).getReader() : undefined
      let buffer = ''
      for (let chunk = await reader?.read(); chunk && !chunk.done; chunk = await reader!.read()) {
        buffer += chunk.value
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop()!
        for (const block of blocks) {
          const field = (name: string) => block.split('\n').filter(l => l.startsWith(`${name}:`)).map(l => l.slice(name.length + 1).trimStart()).join('\n')
          onEvent(field('event'), field('data'))
        }
      }
    } catch {
      // Server restarted or connection dropped: try again below.
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
}
