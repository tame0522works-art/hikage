// 実データでの影の計算の速さを測る（Node.js。ブラウザでの描画の時間は含まない）
import { readFileSync } from 'node:fs'
import type { CityData } from '../src/data/types.ts'
import { buildScene, forEachShadowRing, isShaded } from '../src/shadow.ts'
import { sunPosition } from '../src/sun.ts'

const data: CityData = JSON.parse(readFileSync(new URL('../src/data/marunouchi.json', import.meta.url), 'utf8'))
const { lat, lon } = data.origin

function time(label: string, runs: number, f: () => unknown) {
  f()
  const t = performance.now()
  for (let i = 0; i < runs; i++) f()
  console.log(`${label}: ${((performance.now() - t) / runs).toFixed(2)}ms`)
}

let scene = buildScene(data.buildings)
time('buildScene（建物データの読み込み時に1回）', 10, () => (scene = buildScene(data.buildings)))

for (const jst of ['2026-06-21T12:00:00+09:00', '2026-12-22T09:00:00+09:00']) {
  const sun = sunPosition(new Date(jst), lat, lon)
  let rings = 0
  let points = 0
  forEachShadowRing(scene, sun, (_, n) => {
    rings++
    points += n
  })
  time(`影の多角形（${jst}、高度 ${sun.altitude.toFixed(1)}°、多角形 ${rings}・点 ${points}）`, 20, () => forEachShadowRing(scene, sun, () => {}))
}

// 地点を押したときの1日分: 5分ごと 288 時刻（夜は計算しない）
const day = Array.from({ length: 288 }, (_, i) => sunPosition(new Date(Date.parse('2026-12-22T00:00:00+09:00') + i * 5 * 60000), lat, lon))
for (const [label, x, y] of [
  ['行幸通り', -200, 0],
  ['八重洲口', 200, 0],
] as const) {
  time(`1日の日向・日陰（${label}、5分ごと 288 時刻）`, 5, () => day.map((sun) => isShaded(scene, sun, x * 100, y * 100)))
}
