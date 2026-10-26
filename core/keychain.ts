// Stores secrets per data directory in the OS keychain through the platform's command line tools:
// macOS `security`, Linux `secret-tool` (libsecret), Windows PowerShell with the Credential Manager API.
// The secret is always passed on stdin, never as an argument (arguments are visible to other processes).
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import process from 'node:process'

const SERVICE = 'colwerk'

/** The platform has no usable keychain; the caller falls back to a key file. */
export class KeychainUnavailable extends Error {}

export interface Keychain {
  /** The stored secret, undefined if none is stored. */
  get(): Promise<string | undefined>
  set(secret: string): Promise<void>
}

function run(cmd: string, args: string[], input = ''): Promise<{ code: number, stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', e => reject((e as { code?: string }).code === 'ENOENT' ? new KeychainUnavailable(`${cmd} not found`) : e))
    child.on('close', code => resolve({ code: code ?? -1, stdout, stderr }))
    child.stdin.end(input)
  })
}

const failed = (r: { stderr: string }) => new Error(`Keychain: ${r.stderr.trim() || 'unknown error'}`)

/** The keychain of this platform, for a secret of the data directory `dir` (the encryption key without `purpose`). */
export function keychain(dir: string, purpose?: 'mcp'): Keychain {
  // The account identifies the data directory; hashed, so it contains no spaces or quotes.
  const account = createHash('sha256').update(dir).digest('hex').slice(0, 16) + (purpose ? `-${purpose}` : '')
  if (process.platform === 'darwin') return macos(account)
  if (process.platform === 'win32') return windows(`${SERVICE}/${account}`)
  return linux(account)
}

function macos(account: string): Keychain {
  return {
    async get() {
      const r = await run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'])
      if (r.code === 44) return undefined
      if (r.code !== 0) throw failed(r)
      return r.stdout.trim()
    },
    async set(secret) {
      // Interactive mode reads the command from stdin; `-U` updates an existing item.
      const r = await run('security', ['-i'], `add-generic-password -U -s ${SERVICE} -a ${account} -w ${secret}\n`)
      if (r.code !== 0 || r.stderr.trim()) throw failed(r)
    },
  }
}

function linux(account: string): Keychain {
  return {
    async get() {
      const r = await run('secret-tool', ['lookup', 'service', SERVICE, 'account', account])
      if (r.code === 0) return r.stdout.trim()
      // Exit 1 without message: not found. A message means no Secret Service (e.g. no D-Bus session).
      if (r.code === 1 && !r.stderr.trim()) return undefined
      throw new KeychainUnavailable(r.stderr.trim())
    },
    async set(secret) {
      const r = await run('secret-tool', ['store', `--label=${SERVICE}`, 'service', SERVICE, 'account', account], secret)
      if (r.code !== 0) throw failed(r)
    },
  }
}

// CredReadW/CredWriteW through P/Invoke; exit code 3 = not found.
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DbmCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWriteW(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) return null;
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    } finally { CredFree(p); }
  }
  public static void Write(string target, string secret) {
    var bytes = Encoding.Unicode.GetBytes(secret);
    var c = new CREDENTIAL { Type = 1, TargetName = target, CredentialBlobSize = bytes.Length, Persist = 2, UserName = "${SERVICE}" };
    c.CredentialBlob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, c.CredentialBlob, bytes.Length);
      if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception();
    } finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
}
'@
`

function windows(target: string): Keychain {
  const powershell = (body: string, input?: string) => {
    const script = `${WINDOWS_SCRIPT}\n${body}`
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    return run('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], input)
  }
  return {
    async get() {
      const r = await powershell(`$s = [DbmCred]::Read('${target}'); if ($null -eq $s) { exit 3 }; [Console]::Out.Write($s)`)
      if (r.code === 3) return undefined
      if (r.code !== 0) throw failed(r)
      return r.stdout.trim()
    },
    async set(secret) {
      const r = await powershell(`[DbmCred]::Write('${target}', [Console]::In.ReadToEnd().Trim())`, secret)
      if (r.code !== 0) throw failed(r)
    },
  }
}
