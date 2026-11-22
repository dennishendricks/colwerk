// Minimal streaming ZIP writer (deflate, data descriptors, no ZIP64), used by the XLSX export.
import { once } from 'node:events'
import { createDeflateRaw, crc32 } from 'node:zlib'
import { encoder, type Write } from './common.ts'

const ZIP_MAX = 0xffffffff

/** Minimal ZIP writer: deflated entries with data descriptors, streamed one after another; central directory at the end. */
export class ZipWriter {
  private offset = 0
  private entries: { name: Uint8Array; crc: number; csize: number; usize: number; offset: number }[] = []
  constructor(
    private out: Write,
    private tooLarge: () => Error,
  ) {}

  private async emit(bytes: Uint8Array) {
    this.offset += bytes.length
    if (this.offset > ZIP_MAX) throw this.tooLarge()
    await this.out(bytes)
  }

  /** Little-endian record: signature followed by `[size, value]` fields. */
  private static record(signature: number, fields: [number, number][], name?: Uint8Array): Uint8Array {
    const length = 4 + fields.reduce((n, [size]) => n + size, 0)
    const bytes = new Uint8Array(length + (name?.length ?? 0))
    const view = new DataView(bytes.buffer)
    view.setUint32(0, signature, true)
    let at = 4
    for (const [size, value] of fields) {
      if (size === 2) view.setUint16(at, value, true)
      else view.setUint32(at, value, true)
      at += size
    }
    if (name) bytes.set(name, length)
    return bytes
  }

  /** Starts an entry; its data is deflated as it is written. */
  entry(name: string): { write(data: Uint8Array): Promise<void>; close(): Promise<void> } {
    const nameBytes = encoder.encode(name)
    const offset = this.offset
    const z = createDeflateRaw()
    let crc = 0
    let csize = 0
    let usize = 0
    let pending = this.emit(
      ZipWriter.record(
        0x04034b50,
        [
          [2, 20],
          [2, 0x0808],
          [2, 8],
          [2, 0],
          [2, 0x0021],
          [4, 0],
          [4, 0],
          [4, 0],
          [2, nameBytes.length],
          [2, 0],
        ],
        nameBytes,
      ),
    )
    z.on('data', (chunk: Buffer) => {
      csize += chunk.length
      pending = pending.then(() => this.emit(chunk))
    })
    return {
      write: async (data) => {
        crc = crc32(data, crc)
        usize += data.length
        if (usize > ZIP_MAX) throw this.tooLarge()
        if (!z.write(data)) await once(z, 'drain')
        await pending
      },
      close: async () => {
        const ended = once(z, 'end')
        z.end()
        await ended
        await pending
        await this.emit(
          ZipWriter.record(0x08074b50, [
            [4, crc >>> 0],
            [4, csize],
            [4, usize],
          ]),
        )
        this.entries.push({ name: nameBytes, crc: crc >>> 0, csize, usize, offset })
      },
    }
  }

  /** Central directory and end record. */
  async finish() {
    const start = this.offset
    for (const e of this.entries) {
      await this.emit(
        ZipWriter.record(
          0x02014b50,
          [
            [2, 20],
            [2, 20],
            [2, 0x0808],
            [2, 8],
            [2, 0],
            [2, 0x0021],
            [4, e.crc],
            [4, e.csize],
            [4, e.usize],
            [2, e.name.length],
            [2, 0],
            [2, 0],
            [2, 0],
            [2, 0],
            [4, 0],
            [4, e.offset],
          ],
          e.name,
        ),
      )
    }
    const size = this.offset - start
    const count = this.entries.length
    await this.emit(
      ZipWriter.record(0x06054b50, [
        [2, 0],
        [2, 0],
        [2, count],
        [2, count],
        [4, size],
        [4, start],
        [2, 0],
      ]),
    )
  }
}
