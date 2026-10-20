// 押した地点の1日の日向・日陰を、0〜24 時の帯で見せる。帯を押す（なぞる）とその時刻に移る。
import type { KeyboardEvent, PointerEvent } from 'react'
import { formatMinutes } from '../time.ts'
import { formatDuration, type DayLight, type Light } from '../timeline.ts'

interface Props {
  day: DayLight
  minutes: number
  onSeek: (minutes: number) => void
  onClose: () => void
}

const LABEL: Record<Light, string> = { sun: '日向', shade: '日陰', night: '夜' }

/** 同じ状態が続く区間にまとめる */
function runs(day: DayLight) {
  const out: { light: Light; from: number; to: number }[] = []
  day.lights.forEach((light, i) => {
    const last = out[out.length - 1]
    if (last?.light === light) last.to += day.step
    else out.push({ light, from: i * day.step, to: (i + 1) * day.step })
  })
  return out
}

export default function DayBar({ day, minutes, onSeek, onClose }: Props) {
  const now = day.lights[Math.min(day.lights.length - 1, Math.floor(minutes / day.step))]
  const seek = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const m = Math.round((((e.clientX - r.left) / r.width) * 24 * 60) / day.step) * day.step
    onSeek(Math.max(0, Math.min(24 * 60 - day.step, m)))
  }
  // キーボードでは時刻のスライダーと同じように動かす（←→ で 5 分、Shift か PageUp/PageDown で 1 時間、Home/End で端）
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = 24 * 60 - day.step
    const small = e.shiftKey ? 60 : day.step
    const keys: Record<string, number> = {
      ArrowLeft: minutes - small,
      ArrowDown: minutes - small,
      ArrowRight: minutes + small,
      ArrowUp: minutes + small,
      PageDown: minutes - 60,
      PageUp: minutes + 60,
      Home: 0,
      End: last,
    }
    if (!(e.key in keys)) return
    e.preventDefault()
    onSeek(Math.max(0, Math.min(last, keys[e.key])))
  }
  return (
    <section className="day" aria-label="押した地点の1日の日向と日陰">
      <div className="day-head">
        <p className="day-summary">
          <span className={`day-now ${now}`}>{formatMinutes(minutes)} は{LABEL[now]}</span>
          {day.sunMinutes === 0
            ? '　この日は日が当たりません'
            : `　日向 ${formatDuration(day.sunMinutes)}（${day.sunSpans.map((s) => `${formatMinutes(s.from)}〜${formatMinutes(s.to)}`).join('、')}）`}
        </p>
        <button type="button" className="day-close" onClick={onClose} aria-label="地点の表示を閉じる">
          ×
        </button>
      </div>
      <div
        className="day-bar"
        onPointerDown={(e) => {
          try {
            // 帯の外へ指がはみ出しても、なぞり続けられるようにする
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // 捕まえられなくても、押した時刻には移る
          }
          seek(e)
        }}
        onPointerMove={(e) => e.buttons && seek(e)}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="slider"
        aria-label="押した地点のこの日の日向と日陰（時刻を選ぶ）"
        aria-valuemin={0}
        aria-valuemax={24 * 60 - day.step}
        aria-valuenow={minutes}
        aria-valuetext={`${formatMinutes(minutes)}、${LABEL[now]}`}>
        {runs(day).map((r) => (
          <span key={r.from} className={`day-run ${r.light}`} style={{ left: `${(r.from / 1440) * 100}%`, width: `${((r.to - r.from) / 1440) * 100}%` }} />
        ))}
        <span className="day-cursor" style={{ left: `${(minutes / 1440) * 100}%` }} />
      </div>
      <div className="day-ticks" aria-hidden="true">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {h}
          </span>
        ))}
      </div>
    </section>
  )
}
