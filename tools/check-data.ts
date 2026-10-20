// 同梱する src/data/marunouchi.json の形と、よく知られた建物の高さを確かめる。
// 高さの比較は、LOD1 のならした高さ（丸ビルなら 99.9m）を誤って使っていないかを見るためのもの。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { CityData, Ring } from '../src/data/types.ts'
import { signedArea } from './citygml.ts'

const data: CityData = JSON.parse(readFileSync(new URL('../src/data/marunouchi.json', import.meta.url), 'utf8'))

assert.match(data.attribution, /Project PLATEAU.*加工して作成/)
assert.ok(data.sources.length > 0)
for (const s of data.sources) {
  assert.match(s.dataset, /^https:\/\/www\.geospatial\.jp\/ckan\/dataset\/plateau-/)
  assert.match(s.fetchedAt, /^\d{4}-\d{2}-\d{2}$/)
}
assert.equal(new Set(data.buildings.map((b) => b.id)).size, data.buildings.length, 'id の重複')

const isInt = (r: number[]) => r.every(Number.isInteger)
const bbox = (r: Ring) => {
  const xs = r.filter((_, i) => i % 2 === 0)
  const ys = r.filter((_, i) => i % 2 === 1)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/**
 * 屋根面が LOD1 の輪郭から外れていても、元データどおりなので残す建物。
 * 丸の内駅舎の西にある高さ約 20m の細長い建物で、LOD2 の屋根面の一片（幅約 6m、高さ 16.4m）が LOD1 の輪郭より南へ 34m 延びている。
 * 影には LOD2 を使うので、こちらを正とする（2026-10-20 確認）。
 */
const ROOF_OUTSIDE_OK = new Set(['bldg_5c10c04e-d235-4783-85c3-01b691187319'])

let roofs = 0
for (const b of data.buildings) {
  const where = `${b.id}${b.name ? `（${b.name}）` : ''}`
  assert.ok(b.outer.length >= 6 && b.outer.length % 2 === 0 && isInt(b.outer), `${where} の外周`)
  assert.ok(signedArea(b.outer) > 0, `${where} の外周が反時計回りでない`)
  for (const h of b.holes ?? []) assert.ok(signedArea(h) < 0 && isInt(h), `${where} の穴`)
  // 東京の地面は標高 -5〜+30m ほど。高さは日本一の超高層（約 330m）を超えない
  assert.ok(b.base > -500 && b.base < 3000, `${where} の底面の標高 ${b.base}`)
  assert.ok(b.height > 0 && b.height < 33000, `${where} の高さ ${b.height}`)
  // 屋根面は建物の輪郭の上にある（ひさしの出を見込んで 2m の余裕）
  const [x0, y0, x1, y1] = bbox(b.outer)
  for (const r of b.roofs ?? []) {
    roofs++
    assert.ok(r.length >= 9 && r.length % 3 === 0 && isInt(r), `${where} の屋根面`)
    const xy = r.filter((_, i) => i % 3 !== 2)
    assert.ok(signedArea(xy) > 0, `${where} の屋根面が反時計回りでない`)
    const [rx0, ry0, rx1, ry1] = bbox(xy)
    const inside = rx0 > x0 - 200 && ry0 > y0 - 200 && rx1 < x1 + 200 && ry1 < y1 + 200
    assert.ok(inside || ROOF_OUTSIDE_OK.has(b.id), `${where} の屋根面が輪郭から外れている`)
    for (let i = 2; i < r.length; i += 3) assert.ok(r[i] >= 0 && r[i] <= b.height, `${where} の屋根の高さ`)
  }
}

// 公表されている高さ（およそ）と比べる。LOD1 の値だと丸ビル・ノースタワーは 100m 前後になり、ここで落ちる
const KNOWN: [string, number, number][] = [
  ['丸の内ビルディング', 170, 190],
  ['新丸の内ビルディング', 190, 205],
  ['グラントウキョウ  ノースタワー', 195, 210],
  ['JPタワー', 195, 205],
]
for (const [name, lo, hi] of KNOWN) {
  const b = data.buildings.find((x) => x.name === name)
  assert.ok(b, `${name} が見つからない`)
  assert.ok(b.height >= lo * 100 && b.height <= hi * 100, `${name} の高さ ${b.height / 100}m が ${lo}〜${hi}m の外`)
}
// 東京駅の丸の内駅舎は3階建て（ドームの頂部で約 35m）
const station = data.buildings.filter((b) => b.name === '東京駅')
assert.ok(station.length > 0 && station.every((b) => b.height < 5000), '東京駅の駅舎の高さ')

console.log(`check:data ok（建物 ${data.buildings.length}、屋根面 ${roofs}）`)
