// 地点を押したときの「その日の日向・日陰」。0 時から step 分ごとに、太陽が出ているか、影の中かを調べる。
import type { Building } from './data/types.ts'
import type { Origin } from './geo.ts'
import { isShaded, type Scene } from './shadow.ts'
import { sunPosition } from './sun.ts'
import { jstDate } from './time.ts'

/** sun: 日が当たる、shade: 建物の影、night: 太陽が地平線の下 */
export type Light = 'sun' | 'shade' | 'night'

export interface Span {
  /** 0 時からの分。to は含まない */
  from: number
  to: number
}

export interface DayLight {
  step: number
  /** i 番目は i × step 分からの step 分間（その始まりの時刻で代表させる） */
  lights: Light[]
  /** 日が当たる時間帯（隣り合うものはつなげる） */
  sunSpans: Span[]
  sunMinutes: number
  /** 太陽が出ている時間（日の出から日の入りまで） */
  dayMinutes: number
}

export function dayLight(scene: Scene, origin: Origin, date: string, x: number, y: number, step: number): DayLight {
  const lights: Light[] = []
  for (let m = 0; m < 24 * 60; m += step) {
    const sun = sunPosition(jstDate(date, m), origin.lat, origin.lon)
    lights.push(sun.altitude <= 0 ? 'night' : isShaded(scene, sun, x, y) ? 'shade' : 'sun')
  }
  const sunSpans: Span[] = []
  lights.forEach((l, i) => {
    if (l !== 'sun') return
    const last = sunSpans[sunSpans.length - 1]
    if (last && last.to === i * step) last.to += step
    else sunSpans.push({ from: i * step, to: (i + 1) * step })
  })
  return {
    step,
    lights,
    sunSpans,
    sunMinutes: lights.filter((l) => l === 'sun').length * step,
    dayMinutes: lights.filter((l) => l !== 'night').length * step,
  }
}

/** 点 (x, y)（cm）がどの建物の LOD1 の底面の中か。中庭（穴）の中なら外とみなす */
export function buildingAt(buildings: Building[], x: number, y: number): Building | null {
  for (const b of buildings) {
    if (!inRing(b.outer, x, y)) continue
    if (b.holes?.some((h) => inRing(h, x, y))) continue
    return b
  }
  return null
}

function inRing(r: number[], x: number, y: number): boolean {
  let c = false
  const n = r.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 ? `${m}分` : m === 0 ? `${h}時間` : `${h}時間${m}分`
}
