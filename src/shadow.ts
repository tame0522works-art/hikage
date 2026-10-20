// 建物の影。屋根面ごとに「屋根面から地面まで垂直に下ろした柱」を考え、その影を地面に落とす。
//
// 柱の影は、次の3種類の多角形を合わせた範囲になる（屋根が平らなら厳密、傾いていれば点ごとの高さで近似）。
//   1. 柱の底面（屋根面を真下に下ろした形）
//   2. 屋根面の影（各点を、高さ × 1/tan(太陽高度) だけ太陽と反対へずらした形）
//   3. 側面の影（底面の辺と、それをずらした辺とを結ぶ四角形）
// どれも反時計回りにそろえておけば、全部を1つのパスにして nonzero で塗るだけで合併になる
// （向きが混ざると重なりで巻き数が打ち消し合い、穴があく）。
//
// 地面は平らとみなし、影は各建物の底面の高さの地面に落とす。ほかの建物の屋上に落ちる影は扱わない。
// 単位は src/data/types.ts と同じ cm。
import type { Building } from './data/types.ts'
import type { SunPosition } from './sun.ts'

/** 屋根面を並べた、影の計算用の形 */
export interface Scene {
  /** 屋根面の点 [x, y, z, ...]（z は底面からの高さ） */
  coords: Float64Array
  /** 屋根面 i の点は coords の start[i] * 3 から count[i] 個 */
  start: Uint32Array
  count: Uint32Array
  /** 屋根面 i の平面の範囲と最も高い点 [minX, minY, maxX, maxY, maxZ] */
  bounds: Float64Array
}

export function buildScene(buildings: Building[]): Scene {
  const faces: number[][] = []
  for (const b of buildings) {
    if (b.roofs?.length) faces.push(...b.roofs)
    else {
      // 屋根面のない建物は、LOD1 の外周を平らな屋根として使う
      const roof: number[] = []
      for (let i = 0; i < b.outer.length; i += 2) roof.push(b.outer[i], b.outer[i + 1], b.height)
      faces.push(roof)
    }
  }
  const total = faces.reduce((n, f) => n + f.length, 0)
  const coords = new Float64Array(total)
  const start = new Uint32Array(faces.length)
  const count = new Uint32Array(faces.length)
  const bounds = new Float64Array(faces.length * 5)
  let p = 0
  faces.forEach((f, i) => {
    start[i] = p / 3
    count[i] = f.length / 3
    coords.set(f, p)
    p += f.length
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = 0
    for (let k = 0; k < f.length; k += 3) {
      x0 = Math.min(x0, f[k])
      y0 = Math.min(y0, f[k + 1])
      x1 = Math.max(x1, f[k])
      y1 = Math.max(y1, f[k + 1])
      z1 = Math.max(z1, f[k + 2])
    }
    bounds.set([x0, y0, x1, y1, z1], i * 5)
  })
  return { coords, start, count, bounds }
}

/**
 * 高さ 1 あたりの影のずれ [dx, dy]（太陽と反対の向き、長さ 1/tan(高度)）。
 * 太陽が地平線より下なら null（夜。すべてが日陰）。
 */
export function shadowOffset(sun: SunPosition): [number, number] | null {
  if (sun.altitude <= 0) return null
  const rad = Math.PI / 180
  const k = 1 / Math.tan(sun.altitude * rad)
  return [-Math.sin(sun.azimuth * rad) * k, -Math.cos(sun.azimuth * rad) * k]
}

/** 平面の多角形 [x0, y0, x1, y1, ...] の符号付き面積の2倍（反時計回りが正） */
function area2(r: ArrayLike<number>, n: number): number {
  let s = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1]
  }
  return s
}

/**
 * 影を作る多角形を1つずつ渡す。ring は [x0, y0, x1, y1, ...]、n は点の数で、必ず反時計回り。
 * ring は使い回すので、とっておくなら写すこと。
 */
export function forEachShadowRing(scene: Scene, sun: SunPosition, emit: (ring: Float64Array, n: number) => void): void {
  const off = shadowOffset(sun)
  if (!off) return
  const [dx, dy] = off
  const { coords, start, count } = scene
  let buf = new Float64Array(64)
  const quad = new Float64Array(8)
  for (let f = 0; f < start.length; f++) {
    const s = start[f] * 3
    const n = count[f]
    if (buf.length < n * 2) buf = new Float64Array(n * 4)
    // 1. 柱の底面（データの時点で反時計回り）
    for (let i = 0; i < n; i++) {
      buf[2 * i] = coords[s + 3 * i]
      buf[2 * i + 1] = coords[s + 3 * i + 1]
    }
    emit(buf, n)
    // 3. 側面の影。高さ 0 の点が並ぶ辺は面積がないので飛ばす
    for (let i = 0; i < n; i++) {
      const a = s + 3 * i
      const b = s + 3 * ((i + 1) % n)
      if (coords[a + 2] === 0 && coords[b + 2] === 0) continue
      quad[0] = coords[a]
      quad[1] = coords[a + 1]
      quad[2] = coords[b]
      quad[3] = coords[b + 1]
      quad[4] = coords[b] + coords[b + 2] * dx
      quad[5] = coords[b + 1] + coords[b + 2] * dy
      quad[6] = coords[a] + coords[a + 2] * dx
      quad[7] = coords[a + 1] + coords[a + 2] * dy
      const a2 = area2(quad, 4)
      if (a2 === 0) continue
      if (a2 < 0) reverse(quad, 4)
      emit(quad, 4)
    }
    // 2. 屋根面の影。傾いた屋根では点ごとにずれが違うので、向きが変わることがある
    for (let i = 0; i < n; i++) {
      buf[2 * i] = coords[s + 3 * i] + coords[s + 3 * i + 2] * dx
      buf[2 * i + 1] = coords[s + 3 * i + 1] + coords[s + 3 * i + 2] * dy
    }
    const a2 = area2(buf, n)
    if (a2 === 0) continue
    if (a2 < 0) reverse(buf, n)
    emit(buf, n)
  }
}

function reverse(r: Float64Array, n: number) {
  for (let i = 0, j = n - 1; i < j; i++, j--) {
    const x = r[2 * i]
    const y = r[2 * i + 1]
    r[2 * i] = r[2 * j]
    r[2 * i + 1] = r[2 * j + 1]
    r[2 * j] = x
    r[2 * j + 1] = y
  }
}

/** 点 (x, y) が多角形の中か（偶奇則。辺の上はどちらにもなりうる） */
function inside(r: ArrayLike<number>, n: number, x: number, y: number): boolean {
  let c = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/**
 * 地点 (x, y) が影の中か。夜は true。
 * 屋根面ごとに「影が届きうる範囲」（底面の範囲と、それを最も高い点の分だけずらした範囲を包む長方形）で先にふるい、
 * 残った屋根面だけ、forEachShadowRing と同じ3種類の多角形で確かめる。
 */
export function isShaded(scene: Scene, sun: SunPosition, x: number, y: number): boolean {
  const off = shadowOffset(sun)
  if (!off) return true
  const [dx, dy] = off
  const { coords, start, count, bounds } = scene
  const quad = new Float64Array(8)
  for (let f = 0; f < start.length; f++) {
    const o = f * 5
    const z = bounds[o + 4]
    const minX = Math.min(bounds[o], bounds[o] + z * dx)
    const maxX = Math.max(bounds[o + 2], bounds[o + 2] + z * dx)
    const minY = Math.min(bounds[o + 1], bounds[o + 1] + z * dy)
    const maxY = Math.max(bounds[o + 3], bounds[o + 3] + z * dy)
    if (x < minX || x > maxX || y < minY || y > maxY) continue
    const s = start[f] * 3
    const n = count[f]
    const base = new Float64Array(n * 2)
    const top = new Float64Array(n * 2)
    for (let i = 0; i < n; i++) {
      base[2 * i] = coords[s + 3 * i]
      base[2 * i + 1] = coords[s + 3 * i + 1]
      top[2 * i] = base[2 * i] + coords[s + 3 * i + 2] * dx
      top[2 * i + 1] = base[2 * i + 1] + coords[s + 3 * i + 2] * dy
    }
    if (inside(base, n, x, y) || inside(top, n, x, y)) return true
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      quad[0] = base[2 * i]
      quad[1] = base[2 * i + 1]
      quad[2] = base[2 * j]
      quad[3] = base[2 * j + 1]
      quad[4] = top[2 * j]
      quad[5] = top[2 * j + 1]
      quad[6] = top[2 * i]
      quad[7] = top[2 * i + 1]
      if (inside(quad, 4, x, y)) return true
    }
  }
  return false
}
