// SSH tunnel through the openssh container of docker-compose.yml to the postgres container (skipped without it).
import { test } from 'bun:test'
import { resolve } from 'node:path'
import { assert, assertEquals, assertRejects } from './assert.ts'
import { tlsOptions } from '../core/drivers/tls.ts'
import { hostKeyFingerprint } from '../core/ssh-tunnel.ts'
import { AppError, type ConnectionConfig } from '../core/types.ts'
import { Workbench } from '../core/workbench.ts'
import { reachable } from './helpers.ts'

const ssh = { host: '127.0.0.1', port: 52222 }
const up = await reachable(ssh as ConnectionConfig)

// The database is reached by its compose service name, which only the SSH server can resolve.
const base: ConnectionConfig = {
  id: 'ssh-pg',
  name: 'pg over ssh',
  dialect: 'postgres',
  host: 'postgres',
  port: 5432,
  database: 'dbm',
  user: 'dbm',
  password: 'dbm',
  ssh: true,
  sshHost: ssh.host,
  sshPort: ssh.port,
  sshUser: 'dbm',
  sshAuth: 'password',
  sshSecret: 'dbm',
}

function workbench(config: ConnectionConfig, hostKeys: string[] = []) {
  return new Workbench(
    async () => config,
    async (_, fingerprint) => void hostKeys.push(fingerprint),
  )
}

const select = (wb: Workbench, tab: string, id: string) => wb.execute(tab, id, 'select 42 as x', 10, 10)

// The driver connects to 127.0.0.1; the workbench passes the original host as `sslServerName` for the check.
test('TLS options carry the server name to check the certificate against', async () => {
  assertEquals(
    (await tlsOptions({ ...base, ssl: true, sslServerName: 'db.example.com' }))?.servername,
    'db.example.com',
  )
})

test('host key fingerprint is the unpadded base64 SHA-256, as OpenSSH prints it', () => {
  // SHA-256 of the empty string.
  assertEquals(hostKeyFingerprint(Buffer.alloc(0)), 'SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU')
})

test.skipIf(!up)('queries run through the tunnel, which is shared and closed with the last session', async () => {
  const hostKeys: string[] = []
  const wb = workbench(base, hostKeys)
  await wb.test(base)
  assertEquals((await select(wb, 'a', base.id)).resultSets[0]!.rows, [[42]])
  assertEquals((await select(wb, 'b', base.id)).resultSets[0]!.rows, [[42]])
  assertEquals(hostKeys.length, 1, 'trust on first use records the host key once')
  assert(hostKeys[0]!.startsWith('SHA256:'))
  const tunnels = (wb as unknown as { tunnels: Map<string, unknown> }).tunnels
  assertEquals(tunnels.size, 1)
  await wb.closeAll()
  assertEquals(tunnels.size, 0)
})

test.skipIf(!up)('private key login', async () => {
  const config = {
    ...base,
    sshAuth: 'key' as const,
    sshKeyFile: resolve('docker/ssh/id_ed25519'),
    sshSecret: undefined,
  }
  await workbench(config).test(config)
})

test.skipIf(!up)('a known host key is checked, a changed one is refused', async () => {
  const hostKeys: string[] = []
  await workbench(base, hostKeys).test(base) // test() does not record
  const wb = workbench(base, hostKeys)
  await select(wb, 't', base.id)
  const known = { ...base, sshHostKey: hostKeys[0] }
  await workbench(known).test(known)
  const changed = { ...base, sshHostKey: 'SHA256:AAAA' }
  const error = await assertRejects(() => workbench(changed).test(changed), AppError)
  assertEquals((error as AppError).key, 'sshHostKeyChanged')
  assertEquals((error as AppError).params?.expected, 'SHA256:AAAA')
  await wb.closeAll()
})

test.skipIf(!up)('wrong password and refused forward give readable errors', async () => {
  const wrong = { ...base, sshSecret: 'nope' }
  assertEquals(((await assertRejects(() => workbench(wrong).test(wrong), AppError)) as AppError).key, 'sshAuthFailed')
  const closed = { ...base, host: 'postgres', port: 1 }
  assertEquals(
    ((await assertRejects(() => workbench(closed).test(closed), AppError)) as AppError).key,
    'sshForwardRefused',
  )
})
