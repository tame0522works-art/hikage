// 手で書いた小さな CityGML で、変換の約束ごとを確かめる。
// 低層部の上に塔がある建物（LOD1 はならした高さ、LOD2 は屋根面ごとの高さ）、中庭、measuredHeight の -9999、
// 壊れた建物の読み飛ばし、平面座標への変換の精度。
import assert from 'node:assert/strict'
import { projector, unprojector } from '../src/geo.ts'
import { parseBuildings, signedArea } from './citygml.ts'

const O = { lat: 35.68, lon: 139.76 }
const DLAT = 0.0001 // 約 11m
const DLON = 0.0001 // 約 9m

/** 原点から見た (i, j) マス目の角の緯度経度 */
const ll = (i: number, j: number) => [O.lat + j * DLAT, O.lon + i * DLON]

function ring(points: number[][], z: number | number[], reverse = false) {
  const ps = reverse ? [...points].reverse() : points
  const all = [...ps, ps[0]]
  return all.map(([i, j], k) => [...ll(i, j), Array.isArray(z) ? z[k % ps.length] : z].join(' ')).join(' ')
}

function polygon(ext: string, ints: string[] = []) {
  return `<gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${ext}</gml:posList></gml:LinearRing></gml:exterior>${ints
    .map((i) => `<gml:interior><gml:LinearRing><gml:posList>${i}</gml:posList></gml:LinearRing></gml:interior>`)
    .join('')}</gml:Polygon>`
}

function building(id: string, body: string, measured: number, name?: string) {
  return `<bldg:Building gml:id="${id}">${name ? `<gml:name>${name}</gml:name>` : ''}<bldg:measuredHeight uom="m">${measured}</bldg:measuredHeight>${body}</bldg:Building>`
}

const lod1 = (faces: string[]) => `<bldg:lod1Solid><gml:Solid><gml:exterior><gml:CompositeSurface>${faces.map((f) => `<gml:surfaceMember>${f}</gml:surfaceMember>`).join('')}</gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod1Solid>`
const roof = (faces: string[]) => `<bldg:boundedBy><bldg:RoofSurface gml:id="r"><bldg:lod2MultiSurface><gml:MultiSurface>${faces.map((f) => `<gml:surfaceMember>${f}</gml:surfaceMember>`).join('')}</gml:MultiSurface></bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy>`

const square = [[0, 0], [4, 0], [4, 4], [0, 4]]
// 塔: 底面 3.0m、LOD1 は 3.0〜53.0m（50m にならす）、LOD2 は西半分が低層部 20m・東半分が塔 150m
const tower = building(
  'tower',
  lod1([polygon(ring(square, 3.0, true)), polygon(ring(square, 53.0))]) +
    roof([polygon(ring([[0, 0], [2, 0], [2, 4], [0, 4]], 23.0)), polygon(ring([[2, 0], [4, 0], [4, 4], [2, 4]], 153.0, true))]),
  150,
  '試験タワー',
)
// 中庭つき、measuredHeight なし、屋根面なし（LOD1 の柱で影を落とす）、片流れの屋根面を別に1つ
const court = building(
  'court',
  lod1([polygon(ring([[10, 0], [16, 0], [16, 6], [10, 6]], 2.0), [ring([[12, 2], [12, 4], [14, 4], [14, 2]], 2.0)]), polygon(ring([[10, 0], [16, 0], [16, 6], [10, 6]], 12.0))]),
  -9999,
)
const slope = building(
  'slope',
  lod1([polygon(ring([[20, 0], [22, 0], [22, 2], [20, 2]], 1.0)), polygon(ring([[20, 0], [22, 0], [22, 2], [20, 2]], 7.0))]) +
    roof([
      polygon(ring([[20, 0], [22, 0], [22, 2], [20, 2]], [5.0, 9.0, 9.0, 5.0])),
      // 真上から見て面積のない（垂直な）面は捨てる
      polygon(ring([[20, 0], [22, 0], [22, 0], [20, 0]], [5.0, 9.0, 10.0, 6.0])),
    ]),
  6,
)
const broken = building('broken', '<bldg:lod2Solid></bldg:lod2Solid>', 10)

const xml = `<core:CityModel>${tower}${court}${slope}${broken}</core:CityModel>`
const { buildings, stats } = parseBuildings(xml, O)

assert.equal(stats.buildings, 4)
assert.deepEqual(stats.skipped, [{ id: 'broken', reason: 'lod1Solid が 0 個' }])
assert.equal(stats.noMeasuredHeight, 1)
assert.equal(stats.heightMismatch, 1, 'tower の measuredHeight 150 と LOD1 の 50 のずれ')
assert.equal(stats.noRoof, 1)
assert.equal(stats.roofFaces, 4)
assert.equal(stats.verticalRoofFaces, 1)

const [t, c, s] = buildings
assert.equal(t.name, '試験タワー')
assert.equal(t.base, 300)
assert.equal(t.height, 15000, '高さは LOD1 の 50m ではなく LOD2 の屋根の最高点')
assert.equal(t.roofs!.length, 2)
for (const r of t.roofs!) {
  const xy = r.filter((_, i) => i % 3 !== 2)
  assert.ok(signedArea(xy) > 0, '屋根面は反時計回り（元が時計回りでもそろえる）')
  assert.equal(r.length, 12, '閉じ点は除く')
}
assert.deepEqual(new Set(t.roofs!.map((r) => r[2])), new Set([2000, 15000]), '屋根の高さは底面から')
assert.ok(signedArea(t.outer) > 0, '底面が時計回りでも外周は反時計回りにそろえる')

assert.equal(c.height, 1000, '屋根面がなければ LOD1 の高さ')
assert.equal(c.roofs, undefined)
assert.equal(c.holes!.length, 1)
assert.ok(signedArea(c.holes![0]) < 0, '穴は時計回り')

const sz = s.roofs![0].filter((_, i) => i % 3 === 2)
assert.deepEqual(sz.toSorted((a, b) => a - b), [400, 400, 800, 800], '片流れは点ごとの高さを保つ')

// 平面座標: 1km ほど離れた点の距離を、2点の平均緯度で曲率半径をとるヒュベニの式と比べる。
// 原点で曲率半径を固定する分のずれは 1km で約 2cm。対象範囲の端（約 1.5km）でも 5cm に収まること
const project = projector(O)
const far = { lat: O.lat + 0.007, lon: O.lon + 0.008 }
const [x, y] = project(far.lat, far.lon)
const a = 6378137
const e2 = (1 / 298.257222101) * (2 - 1 / 298.257222101)
const mu = (((O.lat + far.lat) / 2) * Math.PI) / 180
const w = Math.sqrt(1 - e2 * Math.sin(mu) ** 2)
const hubeny = Math.hypot((((far.lat - O.lat) * Math.PI) / 180) * ((a * (1 - e2)) / w ** 3), (((far.lon - O.lon) * Math.PI) / 180) * (a / w) * Math.cos(mu))
assert.ok(hubeny > 1000 && hubeny < 1200)
assert.ok(Math.abs(Math.hypot(x, y) - hubeny) < 0.05, `平面座標の距離 ${Math.hypot(x, y)} とヒュベニ ${hubeny}`)

// 平面から緯度経度への逆変換（地図タイルの位置に使う）は、もとの緯度経度に戻ること
const [blat, blon] = unprojector(O)(x, y)
assert.ok(Math.abs(blat - far.lat) < 1e-12 && Math.abs(blon - far.lon) < 1e-12, '逆変換で戻らない')

console.log('check:convert ok')
