// Native file dialogs through the platform's command line tools: macOS `osascript`, Windows PowerShell
// with Windows Forms, Linux `zenity` or `kdialog`. The server runs on the user's machine, so the dialog
// opens there. Neither desktop backend offers downloads or the paths of picked files to the page.
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { AppError } from './types.ts'

function run(cmd: string, args: string[], env?: Record<string, string>): Promise<{ code: number, stdout: string, stderr: string } | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    // undefined: the tool is not installed.
    child.on('error', e => (e as { code?: string }).code === 'ENOENT' ? resolve(undefined) : reject(e))
    child.on('close', code => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/**
 * Shows an open or save dialog; resolves with the chosen absolute path, undefined if cancelled. `title` comes
 * from the UI in its language; like the name, it never goes into script text.
 */
export async function fileDialog(kind: 'open' | 'save', defaultName = '', title = ''): Promise<string | undefined> {
  const r = process.platform === 'darwin' ? await macos(kind, defaultName, title) : process.platform === 'win32' ? await windows(kind, defaultName, title) : await linux(kind, defaultName, title)
  if (!r) throw new AppError('noFileDialog', 'No file dialog available: install zenity or kdialog')
  if (r.cancelled) return undefined
  if (r.code !== 0) {
    const detail = r.stderr.trim() || 'unknown error'
    throw new AppError('fileDialogFailed', `File dialog: ${detail}`, { params: { detail } })
  }
  return r.stdout.replace(/\r?\n$/, '') || undefined
}

async function macos(kind: 'open' | 'save', name: string, title: string) {
  // Name and title go in as arguments, not into the script text. `activate` brings the dialog to the front.
  const choose = kind === 'save' ? 'choose file name with prompt (item 2 of argv) default name (item 1 of argv)' : 'choose file with prompt (item 2 of argv)'
  const r = await run('osascript', ['-e', 'on run argv', '-e', 'activate', '-e', `POSIX path of (${choose})`, '-e', 'end run', name, title])
  // -128: "User canceled."
  return r && { ...r, cancelled: r.code !== 0 && r.stderr.includes('-128') }
}

async function windows(kind: 'open' | 'save', name: string, title: string) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$d = New-Object System.Windows.Forms.${kind === 'save' ? 'SaveFileDialog' : 'OpenFileDialog'}
$d.Title = $env:DBM_DIALOG_TITLE
$d.FileName = $env:DBM_DIALOG_NAME
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($d.ShowDialog($owner) -ne 'OK') { exit 1 }
[Console]::Out.Write($d.FileName)
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], { DBM_DIALOG_NAME: name, DBM_DIALOG_TITLE: title })
  return r && { ...r, cancelled: r.code === 1 }
}

async function linux(kind: 'open' | 'save', name: string, title: string) {
  // Both exit with 1 when cancelled.
  const zenity = await run('zenity', ['--file-selection', `--title=${title}`, ...(kind === 'save' ? ['--save', `--filename=${name}`] : [])])
  const r = zenity ?? await run('kdialog', kind === 'save' ? ['--getsavefilename', name] : ['--getopenfilename'])
  return r && { ...r, cancelled: r.code === 1 }
}
