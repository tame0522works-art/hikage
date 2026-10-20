// 影の計算を確かめる。
// 1. 手で答えの出せる箱の建物で、影の範囲を地点ごとに比べる
// 2. 描画用の多角形（forEachShadowRing を nonzero で塗った結果）と地点判定（isShaded）が、実データで一致すること
//    多角形がすべて反時計回りなら巻き数は 0 未満にならない（重なりで打ち消し合って穴があかない）ことも見る
// 3. 実データの丸ビルで、影の先端が「高さ ÷ tan(太陽高度)」の位置にあること
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Building, CityData } from '../src/data/types.ts'
import { buildScene, forEachShadowRing, isShaded, shadowOffset, type Scene } from '../src/shadow.ts'
import { sunPosition, type SunPosition } from '../src/sun.ts'

const M = 100 // 1m = 100cm

/** 平らな屋根の箱。x, y, w, d, h は m */
function box(x: number, y: number, w: number, d: number, h: number): number[] {
  const [x0, y0, x1, y1, z] = [x * M, y * M, (x + w) * M, (y + d) * M, h * M]
  return [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]
}

function building(id: string, roofs: number[][]): Building {
  const r = roofs[0]
  return { id, base: 0, height: Math.max(...roofs.flatMap((q) => q.filter((_, i) => i % 3 === 2))), outer: r.filter((_, i) => i % 3 !== 2), roofs }
}

/** 塗った結果の巻き数（nonzero で 0 でなければ影） */
function winding(rings: Float64Array[], x: number, y: number): number {
  let w = 0
  for (const r of rings) {
    const n = r.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const [xi, yi, xj, yj] = [r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1]]
      const cross = (xj - xi) * (y - yi) - (x - xi) * (yj - yi)
      if (yi <= y && yj > y && cross > 0) w++
      else if (yi > y && yj <= y && cross < 0) w--
    }
  }
  return w
}

function rings(scene: Scene, sun: SunPosition): Float64Array[] {
  const out: Float64Array[] = []
  forEachShadowRing(scene, sun, (r, n) => out.push(r.slice(0, n * 2)))
  return out
}

/** 期待する影 expected(x, y)（m）と、地点判定・塗った結果の両方を格子で比べる。境界から 1cm 以内は比べない */
function compareGrid(scene: Scene, sun: SunPosition, expected: (x: number, y: number) => boolean | null, range: [number, number, number, number], label: string) {
  const all = rings(scene, sun)
  let n = 0
  for (let x = range[0]; x <= range[2]; x += 0.5) {
    for (let y = range[1]; y <= range[3]; y += 0.5) {
      const e = expected(x, y)
      if (e === null) continue
      assert.equal(isShaded(scene, sun, x * M, y * M), e, `${label}: isShaded(${x}, ${y})`)
      const w = winding(all, x * M, y * M)
      assert.ok(w >= 0, `${label}: (${x}, ${y}) の巻き数が負`)
      assert.equal(w > 0, e, `${label}: 塗った結果 (${x}, ${y})`)
      n++
    }
  }
  return n
}

let points = 0

// 1-a. 10m 立方の箱、真南から高度 45°: 影は真北へ 10m 伸び、0≦x≦10, 0≦y≦20 の長方形
{
  const scene = buildScene([building('cube', [box(0, 0, 10, 10, 10)])])
  const sun = { altitude: 45, azimuth: 180 }
  const [dx, dy] = shadowOffset(sun)!
  assert.ok(Math.abs(dx) < 1e-12 && Math.abs(dy - 1) < 1e-12, '真南の太陽なら影は真北へ、高さと同じ長さ')
  const edge = (v: number, a: number, b: number) => Math.abs(v - a) < 0.01 || Math.abs(v - b) < 0.01
  points += compareGrid(scene, sun, (x, y) => (edge(x, 0, 10) || edge(y, 0, 20) ? null : x > 0 && x < 10 && y > 0 && y < 20), [-5, -5, 15, 25], '立方体・南')
}

// 1-b. 同じ箱、南東（135°）から高度 30°: 影は北西へ 10/tan30° ≈ 17.32m。箱と、ずらした箱の凸包（六角形）になる
{
  const scene = buildScene([building('cube', [box(0, 0, 10, 10, 10)])])
  const sun = { altitude: 30, azimuth: 135 }
  const L = 10 / Math.tan(Math.PI / 6)
  const s = L / Math.SQRT2
  // 凸包の頂点（反時計回り）: (0,0) (10,0) (10,10) (10-s,10+s) (-s,10+s) (-s,s)
  const hull = [[0, 0], [10, 0], [10, 10], [10 - s, 10 + s], [-s, 10 + s], [-s, s]]
  const expected = (x: number, y: number) => {
    let minD = Infinity
    let inside = true
    for (let i = 0; i < hull.length; i++) {
      const [ax, ay] = hull[i]
      const [bx, by] = hull[(i + 1) % hull.length]
      const len = Math.hypot(bx - ax, by - ay)
      const d = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / len
      if (d < 0) inside = false
      minD = Math.min(minD, Math.abs(d))
    }
    return minD < 0.01 ? null : inside
  }
  points += compareGrid(scene, sun, expected, [-20, -5, 15, 30], '立方体・南東')
}

// 1-c. 低層部 20m の上に塔 100m（東半分）、真南から高度 40°: 西半分の影は 20/tan40°、東半分は 100/tan40° 伸びる
{
  const scene = buildScene([building('tower', [box(0, 0, 20, 20, 20), box(20, 0, 20, 20, 100)])])
  const sun = { altitude: 40, azimuth: 180 }
  const k = 1 / Math.tan((40 * Math.PI) / 180)
  const lowEnd = 20 + 20 * k
  const highEnd = 20 + 100 * k
  const near = (v: number, ...xs: number[]) => xs.some((a) => Math.abs(v - a) < 0.01)
  points += compareGrid(
    scene,
    sun,
    (x, y) => {
      if (near(x, 0, 20, 40) || near(y, 0, lowEnd, highEnd)) return null
      if (y < 0 || x < 0 || x > 40) return false
      return x < 20 ? y < lowEnd : y < highEnd
    },
    [-5, -5, 45, 150],
    '低層部と塔',
  )
}

// 1-d. 片流れの屋根（南の軒 5m、北の棟 15m）、真南から高度 45°: 屋根の影は 5〜15m ずれて、北端は 10+15=25m
{
  const roof = [0, 0, 5 * M, 10 * M, 0, 5 * M, 10 * M, 10 * M, 15 * M, 0, 10 * M, 15 * M]
  const scene = buildScene([building('slope', [roof])])
  const sun = { altitude: 45, azimuth: 180 }
  points += compareGrid(scene, sun, (x, y) => (Math.abs(x) < 0.01 || Math.abs(x - 10) < 0.01 || Math.abs(y) < 0.01 || Math.abs(y - 25) < 0.01 ? null : x > 0 && x < 10 && y > 0 && y < 25), [-5, -5, 15, 30], '片流れ')
}

// 1-e. L字（凹んだ）平らな屋根 10m、真南から高度 45°: 凸包にできないので3種類の多角形で塗る。
// 西の棟（0≦x≦10, 0≦y≦30）と南の棟（10≦x≦30, 0≦y≦10）。影はそれぞれを北へ 10m 伸ばした長方形の合併
{
  const L = [0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30].flatMap((v, i, a) => (i % 2 === 0 ? [v * M, a[i + 1] * M, 10 * M] : []))
  const scene = buildScene([building('L', [L])])
  const sun = { altitude: 45, azimuth: 180 }
  const near = (v: number, ...xs: number[]) => xs.some((a) => Math.abs(v - a) < 0.01)
  points += compareGrid(
    scene,
    sun,
    (x, y) => {
      if (near(x, 0, 10, 30) || near(y, 0, 20, 40)) return null
      return (x > 0 && x < 10 && y > 0 && y < 40) || (x > 10 && x < 30 && y > 0 && y < 20)
    },
    [-5, -5, 35, 45],
    'L字',
  )
}

// 1-f. 夜（太陽が地平線の下）はすべて日陰で、描く多角形はない
{
  const scene = buildScene([building('cube', [box(0, 0, 10, 10, 10)])])
  const night = { altitude: -5, azimuth: 300 }
  assert.equal(shadowOffset(night), null)
  assert.equal(isShaded(scene, night, 50 * M, 50 * M), true)
  assert.equal(rings(scene, night).length, 0)
}

// 2. 実データで、地点判定と塗った結果を比べる（冬至の朝・夏至の正午・秋分の夕方）
const data: CityData = JSON.parse(readFileSync(new URL('../src/data/marunouchi.json', import.meta.url), 'utf8'))
const city = buildScene(data.buildings)
const { lat, lon } = data.origin
let samples = 0
let shaded = 0
// 決まった並びの擬似乱数（毎回同じ地点を調べる）
let seed = 20261020
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
for (const jst of ['2026-12-22T09:00:00+09:00', '2026-06-21T12:00:00+09:00', '2026-09-23T16:00:00+09:00']) {
  const sun = sunPosition(new Date(jst), lat, lon)
  const all = rings(city, sun)
  for (let i = 0; i < 300; i++) {
    const x = (-400 + rand() * 1100) * M
    const y = (-700 + rand() * 1800) * M
    const w = winding(all, x, y)
    assert.ok(w >= 0, `${jst} (${x}, ${y}) の巻き数が負`)
    assert.equal(w > 0, isShaded(city, sun, x, y), `${jst} (${x}, ${y}) で地点判定と塗った結果が違う`)
    samples++
    if (w > 0) shaded++
  }
}
// 2'. 範囲を絞って作った影（画面に映る所だけ描くとき）も、範囲の中では全体で作った影と同じ。範囲の外から伸びてくる影も含む
{
  const sun = sunPosition(new Date('2026-12-22T09:00:00+09:00'), lat, lon)
  const rect: [number, number, number, number] = [-250 * M, -100 * M, 50 * M, 150 * M]
  const part: Float64Array[] = []
  forEachShadowRing(city, sun, (r, n) => part.push(r.slice(0, n * 2)), rect)
  const full = rings(city, sun)
  assert.ok(part.length < full.length / 2, `範囲を絞っても多角形が減っていない（${part.length}/${full.length}）`)
  for (let i = 0; i < 400; i++) {
    const x = rect[0] + rand() * (rect[2] - rect[0])
    const y = rect[1] + rand() * (rect[3] - rect[1])
    assert.equal(winding(part, x, y) > 0, winding(full, x, y) > 0, `範囲を絞った影が (${x}, ${y}) で違う`)
  }
}

// 冬至の朝・夏至の正午・秋分の夕方を混ぜれば、日向も日陰も十分に出るはず
assert.ok(shaded > samples * 0.1 && shaded < samples * 0.9, `日陰の割合 ${shaded}/${samples}`)

// 3. 丸ビルの影の先端: 冬至の正午、影の向きに測った最も遠い点が「最高点の高さ ÷ tan(高度)」にあること
{
  const marubiru = data.buildings.find((b) => b.name === '丸の内ビルディング')!
  const scene = buildScene([marubiru])
  const sun = sunPosition(new Date('2026-12-22T11:45:00+09:00'), lat, lon)
  const [dx, dy] = shadowOffset(sun)!
  const len = Math.hypot(dx, dy)
  const [ux, uy] = [dx / len, dy / len]
  // 影の向きに測った、屋根の各点の位置 + 高さ × 影の長さ の最大と、多角形の最も遠い点が一致する
  let expected = -Infinity
  for (const r of marubiru.roofs!) for (let i = 0; i < r.length; i += 3) expected = Math.max(expected, r[i] * ux + r[i + 1] * uy + r[i + 2] * len)
  let farthest = -Infinity
  forEachShadowRing(scene, sun, (r, n) => {
    for (let i = 0; i < n; i++) farthest = Math.max(farthest, r[2 * i] * ux + r[2 * i + 1] * uy)
  })
  assert.ok(Math.abs(farthest - expected) < 1, `丸ビルの影の先端 ${farthest} と期待値 ${expected}`)
  const length = marubiru.height / 100 / Math.tan((sun.altitude * Math.PI) / 180)
  assert.ok(length > 250 && length < 320, `冬至の正午の丸ビルの影の長さ ${length.toFixed(0)}m`)
  console.log(`丸ビル（${marubiru.height / 100}m）の冬至の正午の影: 太陽高度 ${sun.altitude.toFixed(2)}°、長さ ${length.toFixed(1)}m`)
}

console.log(`check:shadow ok（箱の格子 ${points} 地点、実データ ${samples} 地点のうち日陰 ${shaded}）`)
