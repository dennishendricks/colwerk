import { toHex } from './values.ts'

// Geometries arrive as WKB (DuckDB), EWKB (PostGIS) or a 4-byte SRID followed by WKB (MySQL) and are shown as
// ISO WKT, with a PostGIS-style `SRID=…;` prefix when the value carries an SRID.

const TYPES = [
  '',
  'POINT',
  'LINESTRING',
  'POLYGON',
  'MULTIPOINT',
  'MULTILINESTRING',
  'MULTIPOLYGON',
  'GEOMETRYCOLLECTION',
]
const EWKB_Z = 0x80000000
const EWKB_M = 0x40000000
const EWKB_SRID = 0x20000000

/** WKB or EWKB as WKT; other geometry types (curves, surfaces) and malformed values stay hex. */
export function wkbToText(bytes: Uint8Array, srid = 0): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let o = 0

  function geometry(keyword: boolean): string {
    const le = view.getUint8(o++) === 1
    const u32 = () => ((o += 4), view.getUint32(o - 4, le))
    const f64 = () => ((o += 8), view.getFloat64(o - 8, le))
    const raw = u32()
    if (raw & EWKB_SRID) srid = u32() || srid
    // ISO: type + 1000 (Z), 2000 (M), 3000 (ZM); EWKB: flag bits.
    const iso = Math.floor((raw & 0xffff) / 1000)
    const type = (raw & 0xffff) % 1000
    const z = !!(raw & EWKB_Z) || iso === 1 || iso === 3
    const m = !!(raw & EWKB_M) || iso === 2 || iso === 3
    if (!TYPES[type]) throw new RangeError(`WKB type ${raw}`)
    const coords = () => Array.from({ length: 2 + Number(z) + Number(m) }, f64)
    const coordsText = () => coords().join(' ')
    const list = (item: () => string) => {
      const items = Array.from({ length: u32() }, item)
      return items.length ? `(${items.join(', ')})` : 'EMPTY'
    }
    let body: string
    if (type === 1) {
      const p = coords()
      body = p.every(Number.isNaN) ? 'EMPTY' : `(${p.join(' ')})`
    } else if (type === 2) {
      body = list(coordsText)
    } else if (type === 3) {
      body = list(() => list(coordsText))
    } else {
      body = list(() => geometry(type === 7))
    }
    return keyword ? `${TYPES[type]}${z || m ? ` ${z ? 'Z' : ''}${m ? 'M' : ''}` : ''} ${body}` : body
  }

  try {
    const wkt = geometry(true)
    return srid ? `SRID=${srid};${wkt}` : wkt
  } catch {
    return toHex(bytes)
  }
}

/** PostGIS: hex-encoded EWKB, as `geometry` and `geography` are sent in text format. */
export function hexEwkbToText(hex: string): string {
  return wkbToText(Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16)))
}

/** MySQL/MariaDB: the SRID (4 bytes, little-endian) followed by WKB. */
export function mysqlGeometryToText(bytes: Uint8Array): string {
  return wkbToText(bytes.subarray(4), new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true))
}
