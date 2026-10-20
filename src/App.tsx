import { useMemo, useState } from 'react'
import data from './data/marunouchi.json'
import type { CityData } from './data/types.ts'
import MapView from './map/MapView.tsx'
import { ringsToPath, shadowPaths } from './map/paths.ts'
import { TILE_ORIGIN } from './map/tiles.ts'
import type { Limits, View } from './map/view.ts'
import { buildScene, type Rect } from './shadow.ts'
import { sunPosition } from './sun.ts'
import { formatMinutes, jstDate, toJst } from './time.ts'
import { buildingAt, dayLight } from './timeline.ts'
import DayBar from './ui/DayBar.tsx'

const city = data as CityData
const scene = buildScene(city.buildings)
const STEP = 5
const CHUNK = 20000

/** 建物の輪郭（平面座標 cm）。穴は evenodd で抜く */
const buildingsPath = ringsToPath(city.buildings.flatMap((b) => [b.outer, ...(b.holes ?? [])]))

/** 建物のある範囲（m）。地図の中心はここから外へ出さない */
const LIMITS: Limits = (() => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of city.buildings) {
    for (let i = 0; i < b.outer.length; i += 2) {
      x0 = Math.min(x0, b.outer[i] / 100)
      x1 = Math.max(x1, b.outer[i] / 100)
      y0 = Math.min(y0, b.outer[i + 1] / 100)
      y1 = Math.max(y1, b.outer[i + 1] / 100)
    }
  }
  return { area: [x0, y0, x1, y1], minMpp: 0.1, maxMpp: 4 }
})()

/** 最初は原点（東京駅の代表点、線路の中ほど）の 150m 西、丸の内駅舎と駅前広場のあたりを 1px 0.6m で見せる */
const INITIAL: View = { cx: -150, cy: 0, mpp: 0.6 }

/** 開いた時刻。夜なら、その日の正午を見せる */
function initialTime() {
  const now = toJst(new Date())
  const minutes = Math.round(now.minutes / STEP) * STEP
  const sun = sunPosition(jstDate(now.date, minutes), city.origin.lat, city.origin.lon)
  return { date: now.date, minutes: sun.altitude > 0 ? minutes : 12 * 60 }
}

export default function App() {
  const [start] = useState(initialTime)
  const [date, setDate] = useState(start.date)
  const [minutes, setMinutes] = useState(start.minutes)

  const sun = useMemo(() => sunPosition(jstDate(date, minutes), city.origin.lat, city.origin.lon), [date, minutes])
  // 影は地図が「いま映している範囲」を渡して作らせる（画面の外の屋根面は計算しない）
  const shadows = useMemo(() => (sun.altitude > 0 ? (rect: Rect) => shadowPaths(scene, sun, CHUNK, rect) : null), [sun])

  /** 押した地点（平面座標 m） */
  const [picked, setPicked] = useState<[number, number] | null>(null)
  const inBuilding = useMemo(() => (picked ? buildingAt(city.buildings, picked[0] * 100, picked[1] * 100) : null), [picked])
  const day = useMemo(() => (picked && !inBuilding ? dayLight(scene, city.origin, date, picked[0] * 100, picked[1] * 100, STEP) : null), [picked, inBuilding, date])

  return (
    <div className="app">
      <header className="bar">
        <h1>hikage</h1>
        <p className="lead">東京駅・丸の内の建物の影</p>
      </header>
      <main className="stage">
        <MapView origin={city.origin} limits={LIMITS} initial={INITIAL} buildings={buildingsPath} shadows={shadows} marker={picked} onPick={(x, y) => setPicked([x, y])} />
      </main>
      <section className="controls" aria-label="日時">
        <label className="date">
          日付
          <input type="date" value={date} min="2000-01-01" max="2099-12-31" onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <div className="pick">
          {day ? (
            <DayBar day={day} minutes={minutes} onSeek={setMinutes} onClose={() => setPicked(null)} />
          ) : inBuilding ? (
            <p className="hint">
              {inBuilding.name ?? '建物'}の中です。屋外の地点を押すと、その日の日向と日陰が出ます。
              <button type="button" className="day-close" onClick={() => setPicked(null)} aria-label="地点の表示を閉じる">
                ×
              </button>
            </p>
          ) : (
            <p className="hint">地図を押すと、その地点のこの日の日向と日陰が出ます。</p>
          )}
        </div>
        <label className="time">
          <span className="clock">{formatMinutes(minutes)}</span>
          <input type="range" min={0} max={24 * 60 - STEP} step={STEP} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="時刻" />
        </label>
        <p className="sun">{sun.altitude > 0 ? `太陽 高度 ${sun.altitude.toFixed(1)}°・方位 ${sun.azimuth.toFixed(1)}°` : '太陽は地平線の下（夜）'}</p>
      </section>
      <footer className="credit">
        <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">
          地理院タイル（淡色地図）
        </a>
        ／{city.attribution}（
        {city.sources.map((s, i) => (
          <span key={s.entry}>
            {i > 0 && '・'}
            <a href={s.dataset} target="_blank" rel="noreferrer">
              {s.entry.split('/').pop()}
            </a>
          </span>
        ))}
        ）
      </footer>
      <link rel="preconnect" href={TILE_ORIGIN} />
    </div>
  )
}
