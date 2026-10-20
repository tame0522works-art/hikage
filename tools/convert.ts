// raw/ に取り出した CityGML を、アプリが読む src/data/marunouchi.json に変換する。
// 元データは2ファイルで 400MB あるが、要るのは LOD1 の底面と LOD2 の屋根面だけなので、数 MB に縮む。
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import type { Building, CityData } from '../src/data/types.ts'
import type { Origin } from '../src/geo.ts'
import { parseBuildings } from './citygml.ts'
import type { ManifestFile } from './fetch-plateau.ts'

/** 東京駅 丸の内駅舎の中央付近。平面座標の原点にするだけなので、厳密な位置である必要はない */
const ORIGIN: Origin = { lat: 35.68124, lon: 139.76712 }

const raw = new URL('../raw/', import.meta.url)
const manifest: ManifestFile[] = JSON.parse(readFileSync(new URL('manifest.json', raw), 'utf8'))
const byId = new Map<string, Building>()
let duplicates = 0
for (const f of manifest) {
  const t = performance.now()
  const path = new URL(f.path, raw)
  const { buildings, stats } = parseBuildings(readFileSync(path, 'utf8'), ORIGIN)
  for (const b of buildings) {
    if (byId.has(b.id)) duplicates++
    else byId.set(b.id, b)
  }
  console.log(
    `${f.path}（${(statSync(path).size / 1e6).toFixed(0)}MB、${((performance.now() - t) / 1000).toFixed(1)}秒）: ` +
      `建物 ${stats.buildings}、採用 ${buildings.length}、measuredHeight なし ${stats.noMeasuredHeight}、` +
      `measuredHeight と LOD1 の差 10cm 以上 ${stats.heightMismatch}、` +
      `屋根面 ${stats.roofFaces}（垂直で捨てた ${stats.verticalRoofFaces}）、屋根なし ${stats.noRoof}`,
  )
  for (const s of stats.skipped) console.log(`  捨てた: ${s.id}（${s.reason}）`)
}
if (duplicates) console.log(`メッシュ間で重複した建物: ${duplicates}`)

const sources = manifest.map((f) => ({ entry: f.entry, zip: f.zip, dataset: f.dataset, fetchedAt: f.fetchedAt }))
const data: CityData = {
  attribution: '「3D都市モデル（Project PLATEAU）千代田区（2025年度）」（国土交通省）の建築物モデル（LOD1・LOD2）を加工して作成',
  sources,
  origin: ORIGIN,
  buildings: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
}
const out = new URL('../src/data/marunouchi.json', import.meta.url)
const json = JSON.stringify(data)
writeFileSync(out, json + '\n')
console.log(`src/data/marunouchi.json: 建物 ${data.buildings.length}、${(json.length / 1e3).toFixed(0)}KB`)
