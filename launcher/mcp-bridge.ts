// `colwerk mcp`: MCP server on stdio for clients that start a command. Forwards every JSON-RPC message
// to the running app's `/mcp` endpoint (stateless, so each message stands alone) and writes the replies
// to stdout. The port is looked up per message, so the app may be started or restarted later.
import { mcpToken } from '../core/mcp-token.ts'
import { readInstance } from './common.ts'

const NOT_RUNNING = 'Colwerk is not running. Start the app and try again.'

const stdout = Deno.stdout.writable.getWriter()
const encoder = new TextEncoder()
const send = (message: unknown) => stdout.write(encoder.encode(`${JSON.stringify(message)}\n`))

// Read from the keychain once, and again after any failure (e.g. the token was replaced).
let token: Promise<string | undefined> | undefined

async function forward(line: string): Promise<void> {
  let message: { id?: string | number }
  try {
    message = JSON.parse(line)
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }
  try {
    const instance = readInstance()
    const current = await (token ??= mcpToken())
    if (!instance || !current) throw new Error(NOT_RUNNING)
    const res = await fetch(`http://127.0.0.1:${instance.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${current}` },
      body: line,
    }).catch(() => {
      throw new Error(NOT_RUNNING)
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`Colwerk answered ${res.status}: ${body}`)
    // Notifications get 202 without body; replies come as JSON or as server-sent events.
    if (!body) return
    if (!res.headers.get('content-type')?.includes('text/event-stream')) return await send(JSON.parse(body))
    for (const data of body.split('\n').filter(l => l.startsWith('data:'))) await send(JSON.parse(data.slice(5)))
  } catch (e) {
    token = undefined
    if (message.id !== undefined) await send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: (e as Error).message } })
  }
}

export async function runBridge(): Promise<void> {
  const pending = new Set<Promise<void>>()
  let buffer = ''
  // Concurrently, so a long query does not hold up other requests; each reply is one `write`.
  for await (const chunk of Deno.stdin.readable.pipeThrough(new TextDecoderStream())) {
    const lines = (buffer + chunk).split('\n')
    buffer = lines.pop()!
    for (const line of lines.filter(l => l.trim())) {
      const p = forward(line).catch(() => {})
      pending.add(p)
      p.finally(() => pending.delete(p))
    }
  }
  await Promise.all(pending)
}
