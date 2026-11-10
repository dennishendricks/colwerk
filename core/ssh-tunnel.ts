import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import process from 'node:process'
import { Client } from 'ssh2'
import { AppError, type ConnectionConfig } from './types.ts'

export interface Tunnel {
  /** Local port on 127.0.0.1 that is forwarded to the target. */
  port: number
  /** Why the last forward to the target failed (e.g. the target refused), to explain the driver's reset connection. */
  forwardError?: AppError
  close(): Promise<void>
}

/** OpenSSH's notation of a host key: `SHA256:` and the unpadded base64 of the key's SHA-256. */
export const hostKeyFingerprint = (key: Buffer) =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`

function sshError(e: unknown, c: ConnectionConfig): AppError {
  if (e instanceof AppError) return e
  const err = e as { message?: string; level?: string; code?: string }
  const detail = err.message ?? String(e)
  if (err.level === 'client-authentication') {
    return new AppError('sshAuthFailed', `SSH login failed: ${detail}`, { params: { detail } })
  }
  return new AppError('sshUnreachable', `SSH server ${c.sshHost}:${c.sshPort ?? 22} not reachable: ${detail}`, {
    code: err.code,
    params: { host: c.sshHost ?? '', port: c.sshPort ?? 22, detail },
  })
}

/**
 * Opens an SSH connection to `c.sshHost` and forwards a local port on 127.0.0.1 to `target`. Host keys are trusted on
 * first use: without `c.sshHostKey` any key is accepted and passed to `onNewHostKey` once the login succeeded.
 * `onClose` is called when the SSH connection ends by itself.
 */
export async function openTunnel(
  c: ConnectionConfig,
  target: { host: string; port: number },
  onNewHostKey: (fingerprint: string) => void,
  onClose: () => void,
): Promise<Tunnel> {
  // On Windows the OpenSSH agent's pipe; Pageant is not tried.
  const agent =
    c.sshAuth === 'agent'
      ? (process.env.SSH_AUTH_SOCK ?? (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined))
      : undefined
  if (c.sshAuth === 'agent' && !agent) {
    throw new AppError('sshNoAgent', 'No SSH agent found: SSH_AUTH_SOCK is not set.')
  }
  let privateKey: string | undefined
  if (c.sshAuth === 'key') {
    try {
      privateKey = await readFile(c.sshKeyFile ?? '', 'utf8')
    } catch (e) {
      throw new AppError('sshKeyUnreadable', `SSH key not readable: ${(e as Error).message}`, {
        params: { detail: (e as Error).message },
      })
    }
  }

  const client = new Client()
  let fingerprint = ''
  let mismatch: AppError | undefined
  let up = false
  const ready = new Promise<void>((resolve, reject) => {
    client.on('ready', resolve)
    client.on('error', reject)
    client.on('close', () => reject(new Error('Connection closed')))
  })
  client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) =>
    finish(prompts.map(() => c.sshSecret ?? '')),
  )
  client.connect({
    host: c.sshHost,
    port: c.sshPort ?? 22,
    username: c.sshUser,
    password: c.sshAuth === 'password' ? c.sshSecret : undefined,
    // Some servers ask for the password through keyboard-interactive only (PAM).
    tryKeyboard: c.sshAuth === 'password',
    privateKey,
    passphrase: c.sshAuth === 'key' ? c.sshSecret : undefined,
    agent,
    readyTimeout: 10_000,
    keepaliveInterval: 30_000,
    hostVerifier: (key: Buffer) => {
      fingerprint = hostKeyFingerprint(key)
      if (c.sshHostKey && c.sshHostKey !== fingerprint) {
        mismatch = new AppError('sshHostKeyChanged', `The SSH host key changed (now ${fingerprint}).`, {
          params: { fingerprint, expected: c.sshHostKey },
        })
        return false
      }
      return true
    },
  })
  try {
    await ready
  } catch (e) {
    client.destroy()
    throw mismatch ?? sshError(e, c)
  }
  up = true

  const sockets = new Set<{ destroy(): void }>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    client.forwardOut('127.0.0.1', socket.remotePort ?? 0, target.host, target.port, (err, channel) => {
      if (err) {
        tunnel.forwardError = new AppError(
          'sshForwardRefused',
          `The SSH server could not connect to ${target.host}:${target.port}: ${err.message}`,
          { params: { host: target.host, port: target.port, detail: err.message } },
        )
        return socket.destroy()
      }
      tunnel.forwardError = undefined
      channel.on('error', () => socket.destroy())
      socket.on('close', () => channel.destroy())
      socket.pipe(channel).pipe(socket)
    })
  })
  const tunnel: Tunnel = {
    port: 0,
    close: async () => {
      up = false
      for (const s of sockets) s.destroy()
      client.end()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  // A dropped SSH connection ends the tunnel; the workbench opens a new one on the next session.
  client.on('close', () => {
    if (!up) return
    up = false
    for (const s of sockets) s.destroy()
    server.close()
    onClose()
  })
  client.on('error', () => {})
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
  } catch (e) {
    up = false
    client.end()
    throw e
  }
  tunnel.port = (server.address() as { port: number }).port
  if (!c.sshHostKey) onNewHostKey(fingerprint)
  return tunnel
}
