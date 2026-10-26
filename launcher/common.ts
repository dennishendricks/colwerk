export function createToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
}

/** Reserves a random free port on 127.0.0.1. */
export function freePort(): number {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  const { port } = listener.addr as Deno.NetAddr
  listener.close()
  return port
}

/** The token travels in the URL fragment, which is never sent to the server or written to access logs. */
export function appUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/#token=${token}`
}
