// 手で組み立てた ZIP（無圧縮・deflate・ZIP64 の拡張欄）から、名前・中身・壊れた CRC の検出を確かめる
import assert from 'node:assert/strict'
import { crc32, deflateRawSync } from 'node:zlib'
import { extract, listEntries, memorySource } from './zip.ts'

interface File {
  name: string
  data: Uint8Array
  method: 0 | 8
  zip64?: boolean
  badCrc?: boolean
}

function build(files: File[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const body = f.method === 8 ? deflateRawSync(f.data) : f.data
    const crc = f.badCrc ? (crc32(f.data) ^ 1) >>> 0 : crc32(f.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(8, f.method, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, body.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, body)
    // ZIP64 の場合は、32 ビットの欄を 0xffffffff にして実際の値を拡張欄に入れる
    const extra = new DataView(new ArrayBuffer(f.zip64 ? 4 + 24 : 0))
    if (f.zip64) {
      extra.setUint16(0, 0x0001, true)
      extra.setUint16(2, 24, true)
      extra.setBigUint64(4, BigInt(f.data.length), true)
      extra.setBigUint64(12, BigInt(body.length), true)
      extra.setBigUint64(20, BigInt(offset), true)
    }
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(10, f.method, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, f.zip64 ? 0xffffffff : body.length, true)
    c.setUint32(24, f.zip64 ? 0xffffffff : f.data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint16(30, extra.byteLength, true)
    c.setUint32(42, f.zip64 ? 0xffffffff : offset, true)
    central.push(new Uint8Array(c.buffer), name, new Uint8Array(extra.buffer))
    offset += 30 + name.length + body.length
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0))
  let p = 0
  for (const b of all) {
    out.set(b, p)
    p += b.length
  }
  return out
}

const text = (s: string) => new TextEncoder().encode(s)
const big = text('<bldg:Building>'.repeat(5000))
const zip = build([
  { name: 'udx/bldg/53394611_bldg_6697_op.gml', data: big, method: 8 },
  { name: '日本語/stored.txt', data: text('そのまま'), method: 0 },
  { name: 'udx/bldg/zip64.gml', data: text('zip64 extra field'), method: 8, zip64: true },
  { name: 'broken.txt', data: text('crc mismatch'), method: 0, badCrc: true },
])
const src = memorySource(zip)
const entries = await listEntries(src)
assert.deepEqual(
  entries.map((e) => e.name),
  ['udx/bldg/53394611_bldg_6697_op.gml', '日本語/stored.txt', 'udx/bldg/zip64.gml', 'broken.txt'],
)
assert.ok(entries[0].compressedSize < entries[0].size, 'deflate で縮んでいる')
assert.ok(Buffer.from(await extract(src, entries[0])).equals(big))
assert.equal(new TextDecoder().decode(await extract(src, entries[1])), 'そのまま')
assert.equal(new TextDecoder().decode(await extract(src, entries[2])), 'zip64 extra field')
await assert.rejects(extract(src, entries[3]), /CRC が合わない/)

console.log('check:zip ok')
