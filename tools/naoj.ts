// 国立天文台 暦計算室「天体の高度と方位」で、東京駅の太陽の高度・方位を取得し、check:sun の参照値として保存する。
// 問い合わせは日付ごとに大気差なし・ありの2回（計 12 回）で、1秒ずつ間を空ける。
// 計算できる年は 2009〜2027 年（2026-10-20 時点のフォームの選択肢）。
import { writeFileSync } from 'node:fs'

export const NAOJ_URL = 'https://eco.mtk.nao.ac.jp/cgi-bin/koyomi/cande/horizontal.cgi'

/** 平面座標の原点（tools/convert.ts の ORIGIN）と同じ地点 */
const LAT = 35.68124
const LON = 139.76712

/** 二至二分、作り始めた日、計算できる範囲の両端に近い日 */
const DATES = ['2009-01-15', '2026-03-20', '2026-06-21', '2026-09-23', '2026-10-20', '2026-12-22', '2027-12-15']

export interface SunRow {
  /** 日本標準時 */
  jst: string
  altitude: number
  azimuth: number
}

export interface SunReference {
  source: string
  fetchedAt: string
  lat: number
  lon: number
  note: string
  /** 大気差なし（幾何学的な高度） */
  geometric: SunRow[]
  /** 大気差あり（見かけの高度） */
  apparent: SunRow[]
}

async function query(date: string, refraction: boolean): Promise<SunRow[]> {
  const [year, month, day] = date.split('-').map(Number)
  const form = new URLSearchParams({
    body: '0', // 太陽
    year: String(year),
    month: String(month),
    day: String(day),
    hour: '0',
    min: '0',
    sec: '0',
    choice: '1', // 経緯度を指定する
    choice0: '1',
    anywhere: '1',
    lat: String(LAT),
    lon: String(LON),
    hgt: '0',
    lst: '9', // UT+9h
    div: '10',
    divu: '1', // 10 分ごと
    len: '1',
    lenu: '3', // 1 日間
    ref: refraction ? '1' : '0',
    dms: '1', // 小数で表示
  })
  const res = await fetch(NAOJ_URL, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`${date} の取得に失敗（${res.status}）`)
  const html = new TextDecoder('euc-jp').decode(await res.arrayBuffer())
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  // 場所の指定が効かないと東京の代表点（35.6500°, 139.7333°）で計算されるので、地点を確かめる
  const where = /緯度:([\d.]+)° 経度:([\d.]+)°/.exec(text)
  if (!where || Math.abs(Number(where[1]) - LAT) > 1e-4 || Math.abs(Number(where[2]) - LON) > 1e-4) throw new Error(`${date} の計算地点が違う: ${where?.[0]}`)
  const rows = [...text.matchAll(/(\d{4})\/(\d{2})\/(\d{2}) (\d{1,2}):(\d{2}):(\d{2}) (-?\d+\.\d+) (\d+\.\d+)/g)].map((m) => ({
    jst: `${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:${m[6]}+09:00`,
    altitude: Number(m[7]),
    azimuth: Number(m[8]),
  }))
  if (rows.length !== 144) throw new Error(`${date} の行数が ${rows.length}（0:00〜23:50 の 10 分ごとなら 144）`)
  return rows
}

const ref: SunReference = {
  source: NAOJ_URL,
  fetchedAt: new Date().toISOString().slice(0, 10),
  lat: LAT,
  lon: LON,
  note: '国立天文台 暦計算室「天体の高度と方位」の出力。太陽の中心の高度と方位（北を 0° として東回り）、標高 0m、10 分ごと',
  geometric: [],
  apparent: [],
}
for (const date of DATES) {
  for (const refraction of [false, true]) {
    const rows = await query(date, refraction)
    ;(refraction ? ref.apparent : ref.geometric).push(...rows)
    console.log(`${date} 大気差${refraction ? 'あり' : 'なし'}: ${rows.length} 行`)
    await new Promise((r) => setTimeout(r, 1000))
  }
}
writeFileSync(new URL('./sun-reference.json', import.meta.url), JSON.stringify(ref, null, 1) + '\n')
