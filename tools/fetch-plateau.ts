// PLATEAU の配布 ZIP から、対象メッシュの建物ファイルだけを raw/ に取り出す。
// 取り出した記録（どの ZIP のどのファイルか、大きさ、CRC、取得日）を raw/manifest.json に残し、変換の出典に使う。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { BUILDING_FILE, MESHES, SOURCES } from './plateau-sources.ts'
import { extract, httpSource, listEntries } from './zip.ts'

export interface ManifestFile {
  ward: string
  dataset: string
  zip: string
  entry: string
  mesh: string
  path: string
  size: number
  crc: number
  fetchedAt: string
}

const ROOT = new URL('../raw/', import.meta.url)
mkdirSync(ROOT, { recursive: true })
const manifestUrl = new URL('manifest.json', ROOT)
const previous: ManifestFile[] = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl, 'utf8')) : []
const manifest: ManifestFile[] = []

for (const s of SOURCES) {
  const src = await httpSource(s.zip)
  const entries = await listEntries(src)
  console.log(`${s.ward}: ZIP ${(src.size / 1e9).toFixed(2)}GB, ${entries.length} ファイル`)
  for (const mesh of MESHES) {
    const hits = entries.filter((e) => BUILDING_FILE.exec(e.name)?.[1] === mesh)
    if (hits.length === 0) console.log(`  ${mesh}: 建物ファイルなし`)
    for (const e of hits) {
      const file = e.name.split('/').pop()!
      const path = file
      const out = new URL(path, ROOT)
      const old = previous.find((m) => m.path === path)
      // 同じ CRC・大きさのファイルが手元にあれば取り直さない
      if (old && old.crc === e.crc && existsSync(out) && statSync(out).size === e.size) {
        console.log(`  ${mesh}: ${path} は取得済み`)
        manifest.push(old)
        continue
      }
      const t = performance.now()
      const data = await extract(src, e)
      writeFileSync(out, data)
      console.log(`  ${mesh}: ${path} ${(e.size / 1e6).toFixed(1)}MB（圧縮 ${(e.compressedSize / 1e6).toFixed(1)}MB、${((performance.now() - t) / 1000).toFixed(1)}秒）`)
      manifest.push({ ward: s.ward, dataset: s.dataset, zip: s.zip, entry: e.name, mesh, path, size: e.size, crc: e.crc, fetchedAt: new Date().toISOString().slice(0, 10) })
    }
  }
}

writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n')
