// 太陽の高度・方位を、国立天文台 暦計算室の値（tools/sun-reference.json、npm run naoj で取り直せる）と比べる。
// 許す差は 0.02°。高さ 200m の超高層の影の先端で、太陽高度 10° なら約 1.3m、30° なら約 0.25m のずれにあたる。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sunPosition } from '../src/sun.ts'
import type { SunReference, SunRow } from './naoj.ts'

const ref: SunReference = JSON.parse(readFileSync(new URL('./sun-reference.json', import.meta.url), 'utf8'))
const LIMIT = 0.02

function compare(rows: SunRow[], apparent: boolean, minAltitude: number) {
  let maxAlt = 0
  let maxAz = 0
  let n = 0
  for (const r of rows) {
    if (r.altitude < minAltitude) continue
    const p = sunPosition(new Date(r.jst), ref.lat, ref.lon, apparent)
    const dAlt = Math.abs(p.altitude - r.altitude)
    // 方位は 360° をまたぐことがあるので、短い向きの差をとる
    const dAz = Math.abs(((p.azimuth - r.azimuth + 540) % 360) - 180)
    assert.ok(dAlt < LIMIT, `${r.jst} の高度: 計算 ${p.altitude.toFixed(4)}、国立天文台 ${r.altitude}`)
    // 真上近くでは方位が急に回るので、方位の差は地平線に沿った距離（× cos 高度）で見る
    assert.ok(dAz * Math.cos((r.altitude * Math.PI) / 180) < LIMIT, `${r.jst} の方位: 計算 ${p.azimuth.toFixed(4)}、国立天文台 ${r.azimuth}`)
    maxAlt = Math.max(maxAlt, dAlt)
    maxAz = Math.max(maxAz, dAz)
    n++
  }
  return `${n} 時刻、最大の差 高度 ${maxAlt.toFixed(4)}°・方位 ${maxAz.toFixed(4)}°`
}

assert.equal(ref.geometric.length, ref.apparent.length)
// 大気差なしは夜も含めて全時刻を比べる（式の確かさを見る）
const geometric = compare(ref.geometric, false, -90)
// 大気差ありは、式が −1° で値を止めているので −1° 以上で比べる（地平線ちょうど付近でも差は 0.007° ほど）
const apparent = compare(ref.apparent, true, -1)

console.log(`check:sun ok（大気差なし ${geometric}／大気差あり ${apparent}）`)
