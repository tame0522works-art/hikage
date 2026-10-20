// 日時は端末の時間帯によらず日本標準時（UTC+9、夏時刻なし）で扱う

const JST = 9 * 60 * 60_000

/** 日本標準時の日付（YYYY-MM-DD）と、0 時からの分 → 時刻 */
export function jstDate(date: string, minutes: number): Date {
  return new Date(Date.parse(`${date}T00:00:00+09:00`) + minutes * 60_000)
}

/** 時刻 → 日本標準時の日付（YYYY-MM-DD）と、0 時からの分 */
export function toJst(d: Date): { date: string; minutes: number } {
  const j = new Date(d.getTime() + JST)
  return { date: j.toISOString().slice(0, 10), minutes: j.getUTCHours() * 60 + j.getUTCMinutes() }
}

export function formatMinutes(m: number): string {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}
