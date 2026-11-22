/** Decodes the bytes of a text file by its byte order mark (UTF-16 LE/BE, UTF-8), otherwise as UTF-8; drops the mark. */
export function decodeText(bytes: Uint8Array): string {
  const [a, b, c] = bytes
  if (a === 0xff && b === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (a === 0xfe && b === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  return new TextDecoder().decode(a === 0xef && b === 0xbb && c === 0xbf ? bytes.subarray(3) : bytes)
}
