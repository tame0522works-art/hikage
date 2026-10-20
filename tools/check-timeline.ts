// 地点の1日の日向・日陰を確かめる。
// 昼の長さは国立天文台 暦計算室「日の出入り」の東京の値（2026-06-21 は 4:25〜19:00、2026-12-22 は 6:47〜16:32）と、
// 5 分刻みの粗さの分（±10 分）で比べる。出典: https://eco.mtk.nao.ac.jp/koyomi/dni/2026/s1306.html ・ s1312.html（2026-10-20 確認）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Building, CityData } from '../src/data/types.ts'
import { buildScene, isShaded } from '../src/shadow.ts'
import { sunPosition } from '../src/sun.ts'
import { jstDate } from '../src/time.ts'
import { buildingAt, dayLight, formatDuration } from '../src/timeline.ts'

const M = 100
const ORIGIN = { lat: 35.68124, lon: 139.76712 }
const STEP = 5

function wall(): Building {
  // 東西 100m・南北 10m・高さ 30m の壁。南面は y = -10m、北面は y = 0
  const [x0, y0, x1, y1, z] = [-50 * M, -10 * M, 50 * M, 0, 30 * M]
  const outer = [x0, y0, x1, y0, x1, y1, x0, y1]
  return { id: 'wall', base: 0, height: z, outer, roofs: [[x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]] }
}

const scene = buildScene([wall()])

for (const [date, rise, set] of [
  ['2026-06-21', 4 * 60 + 25, 19 * 60],
  ['2026-12-22', 6 * 60 + 47, 16 * 60 + 32],
] as const) {
  // 建物から遠い地点では、日が出ている間はずっと日向
  const open = dayLight(scene, ORIGIN, date, 0, 1000 * M, STEP)
  assert.equal(open.lights.length, (24 * 60) / STEP)
  assert.equal(open.lights[0], 'night')
  assert.equal(open.lights[open.lights.length - 1], 'night')
  assert.ok(Math.abs(open.dayMinutes - (set - rise)) <= 10, `${date} の昼の長さ ${open.dayMinutes} 分（暦計算室 ${set - rise} 分）`)
  assert.equal(open.sunMinutes, open.dayMinutes)
  assert.equal(open.sunSpans.length, 1)
  assert.ok(Math.abs(open.sunSpans[0].from - rise) <= 10 && Math.abs(open.sunSpans[0].to - set) <= 10, `${date} の日向の時間帯`)

  // 壁の北 20m: 時刻ごとの判定が isShaded と一致し、時間帯をつなげた長さが合計と一致する
  const north = dayLight(scene, ORIGIN, date, 0, 20 * M, STEP)
  north.lights.forEach((l, i) => {
    const sun = sunPosition(jstDate(date, i * STEP), ORIGIN.lat, ORIGIN.lon)
    const expected = sun.altitude <= 0 ? 'night' : isShaded(scene, sun, 0, 20 * M) ? 'shade' : 'sun'
    assert.equal(l, expected, `${date} ${i * STEP} 分`)
  })
  assert.equal(north.sunSpans.reduce((s, x) => s + x.to - x.from, 0), north.sunMinutes)
  for (const s of north.sunSpans) assert.ok(s.from < s.to && s.from % STEP === 0 && s.to % STEP === 0)
  for (let i = 1; i < north.sunSpans.length; i++) assert.ok(north.sunSpans[i - 1].to < north.sunSpans[i].from, '隣り合う日向はつなげる')
}

// 壁の北 20m は、冬至の正午（高度約 31°、影 50m）は日陰、夏至の正午（高度約 77°、影 7m）は日向
const noon = (date: string) => dayLight(scene, ORIGIN, date, 0, 20 * M, STEP).lights[(11 * 60 + 45) / STEP]
assert.equal(noon('2026-12-22'), 'shade')
assert.equal(noon('2026-06-21'), 'sun')

// 建物の中か: 中庭（穴）の中は外とみなす
const court: Building = {
  id: 'court',
  base: 0,
  height: 1000,
  outer: [0, 0, 3000, 0, 3000, 3000, 0, 3000],
  holes: [[1000, 1000, 1000, 2000, 2000, 2000, 2000, 1000]],
}
assert.equal(buildingAt([court], 500, 500)?.id, 'court')
assert.equal(buildingAt([court], 1500, 1500), null, '中庭は外')
assert.equal(buildingAt([court], 4000, 500), null)

assert.equal(formatDuration(45), '45分')
assert.equal(formatDuration(120), '2時間')
assert.equal(formatDuration(195), '3時間15分')

// 実データ: 行幸通り。丸ビル（北端 y=35m）と新丸ビル（南端 y=94m）の間。夏至は冬至より日向が長い
const data: CityData = JSON.parse(readFileSync(new URL('../src/data/marunouchi.json', import.meta.url), 'utf8'))
const city = buildScene(data.buildings)
const [gx, gy] = [-280 * M, 65 * M]
assert.equal(buildingAt(data.buildings, gx, gy), null, '行幸通りの地点が建物の中になっている')
const summer = dayLight(city, data.origin, '2026-06-21', gx, gy, STEP)
const winter = dayLight(city, data.origin, '2026-12-22', gx, gy, STEP)
assert.ok(summer.sunMinutes > winter.sunMinutes)
console.log(`check:timeline ok（行幸通りの日向: 夏至 ${formatDuration(summer.sunMinutes)}／冬至 ${formatDuration(winter.sunMinutes)}）`)
