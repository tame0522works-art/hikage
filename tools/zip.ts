// ZIP の中央ディレクトリを読み、必要なファイルだけを取り出す。
// PLATEAU の配布 ZIP は区ごとに 0.6〜2GB あるが、使うのは数ファイルなので、HTTP の Range で必要な範囲だけ読む。
import { crc32, inflateRawSync } from 'node:zlib'

export interface RangeSource {
  size: number
  /** [start, end) を読む */
  read(start: number, end: number): Promise<Uint8Array>
}

export interface ZipEntry {
  name: string
  method: number
  crc: number
  compressedSize: number
  size: number
  localHeaderOffset: number
}

const EOCD = 0x06054b50
const EOCD64 = 0x06064b50
const EOCD64_LOCATOR = 0x07064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

function view(b: Uint8Array) {
  return new DataView(b.buffer, b.byteOffset, b.byteLength)
}

function u64(v: DataView, at: number): number {
  const n = v.getBigUint64(at, true)
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP の値が大きすぎる')
  return Number(n)
}

export async function listEntries(src: RangeSource): Promise<ZipEntry[]> {
  // 終端レコードは末尾にあり、後ろにコメント（最大 65535 バイト）が付くことがある
  const tailStart = Math.max(0, src.size - 22 - 0xffff)
  const tail = await src.read(tailStart, src.size)
  const tv = view(tail)
  let at = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD) {
      at = i
      break
    }
  }
  if (at < 0) throw new Error('ZIP の終端レコードが見つからない')
  let count = tv.getUint16(at + 10, true)
  let cdSize = tv.getUint32(at + 12, true)
  let cdOffset = tv.getUint32(at + 16, true)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // ZIP64: 終端レコードの直前にある位置情報から、64 ビット版の終端レコードを読む
    const loc = at - 20
    if (loc < 0 || tv.getUint32(loc, true) !== EOCD64_LOCATOR) throw new Error('ZIP64 の位置情報がない')
    const eocd64At = u64(tv, loc + 8)
    const e = view(await src.read(eocd64At, eocd64At + 56))
    if (e.getUint32(0, true) !== EOCD64) throw new Error('ZIP64 の終端レコードが壊れている')
    count = u64(e, 32)
    cdSize = u64(e, 40)
    cdOffset = u64(e, 48)
  }
  const cd = await src.read(cdOffset, cdOffset + cdSize)
  const cv = view(cd)
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (cv.getUint32(p, true) !== CENTRAL) throw new Error(`中央ディレクトリの ${i} 件目が壊れている`)
    const nameLen = cv.getUint16(p + 28, true)
    const extraLen = cv.getUint16(p + 30, true)
    const commentLen = cv.getUint16(p + 32, true)
    const entry: ZipEntry = {
      name: decoder.decode(cd.subarray(p + 46, p + 46 + nameLen)),
      method: cv.getUint16(p + 10, true),
      crc: cv.getUint32(p + 16, true),
      compressedSize: cv.getUint32(p + 20, true),
      size: cv.getUint32(p + 24, true),
      localHeaderOffset: cv.getUint32(p + 42, true),
    }
    // ZIP64 の拡張欄には、32 ビットで表せなかった値だけが、この順で入る
    let x = p + 46 + nameLen
    const extraEnd = x + extraLen
    while (x + 4 <= extraEnd) {
      const id = cv.getUint16(x, true)
      const len = cv.getUint16(x + 2, true)
      if (id === 0x0001) {
        let q = x + 4
        if (entry.size === 0xffffffff) {
          entry.size = u64(cv, q)
          q += 8
        }
        if (entry.compressedSize === 0xffffffff) {
          entry.compressedSize = u64(cv, q)
          q += 8
        }
        if (entry.localHeaderOffset === 0xffffffff) entry.localHeaderOffset = u64(cv, q)
      }
      x += 4 + len
    }
    entries.push(entry)
    p = extraEnd + commentLen
  }
  return entries
}

export async function extract(src: RangeSource, entry: ZipEntry): Promise<Uint8Array> {
  const head = view(await src.read(entry.localHeaderOffset, entry.localHeaderOffset + 30))
  if (head.getUint32(0, true) !== LOCAL) throw new Error(`${entry.name} のローカルヘッダが壊れている`)
  // ローカルヘッダの拡張欄の長さは中央ディレクトリと違うことがあるので、ここで読み直す
  const start = entry.localHeaderOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true)
  const raw = await src.read(start, start + entry.compressedSize)
  let data: Uint8Array
  if (entry.method === 0) data = raw
  else if (entry.method === 8) data = inflateRawSync(raw)
  else throw new Error(`${entry.name} の圧縮方式 ${entry.method} には対応していない`)
  if (data.length !== entry.size) throw new Error(`${entry.name} の大きさが合わない`)
  if (crc32(data) !== entry.crc) throw new Error(`${entry.name} の CRC が合わない`)
  return data
}

/** HTTP の Range 要求で読む。サーバーが Range に対応していなければ止める（2GB を丸ごと落とさない） */
export async function httpSource(url: string): Promise<RangeSource> {
  const head = await fetch(url, { method: 'HEAD' })
  if (!head.ok) throw new Error(`${url} に接続できない（${head.status}）`)
  if (head.headers.get('accept-ranges') !== 'bytes') throw new Error(`${url} は Range に対応していない`)
  const size = Number(head.headers.get('content-length'))
  return {
    size,
    async read(start, end) {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } })
      if (res.status !== 206) throw new Error(`${url} の部分取得に失敗（${res.status}）`)
      const b = new Uint8Array(await res.arrayBuffer())
      if (b.length !== end - start) throw new Error(`${url} の部分取得の長さが合わない`)
      return b
    },
  }
}

export function memorySource(b: Uint8Array): RangeSource {
  return { size: b.length, read: async (start, end) => b.subarray(start, end) }
}
