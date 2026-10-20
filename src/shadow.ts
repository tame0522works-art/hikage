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

/** 屋根面 f が真上から見て凸か（点はデータの時点で反時計回り。一直線に並ぶ点は許す） */
function isConvex(coords: Float64Array, s: number, n: number): boolean {
  for (let i = 0; i < n; i++) {
    const a = s + 3 * i
    const b = s + 3 * ((i + 1) % n)
    const c = s + 3 * ((i + 2) % n)
    const cross = (coords[b] - coords[a]) * (coords[c + 1] - coords[b + 1]) - (coords[b + 1] - coords[a + 1]) * (coords[c] - coords[b])
    if (cross < 0) return false
  }
  return true
}

function isFlat(coords: Float64Array, s: number, n: number): boolean {
  for (let i = 1; i < n; i++) if (coords[s + 3 * i + 2] !== coords[s + 2]) return false
  return true
}

/**
 * 点 pts（[x0, y0, ...] の先頭 m 個）の凸包を、反時計回りで out に書き、点の数を返す（Andrew の単調鎖）。
 * order は並べ替えに使う作業用の配列。
 */
function convexHull(pts: Float64Array, m: number, order: Uint32Array, out: Float64Array): number {
  // 1面の点は 10 個前後なので、比較関数つきの sort より挿入ソートのほうがずっと速い
  for (let i = 0; i < m; i++) {
    const x = pts[2 * i]
    const y = pts[2 * i + 1]
    let j = i - 1
    while (j >= 0 && (pts[2 * order[j]] > x || (pts[2 * order[j]] === x && pts[2 * order[j] + 1] > y))) {
      order[j + 1] = order[j]
      j--
    }
    order[j + 1] = i
  }
  const sorted = order.subarray(0, m)
  const cross = (o: number, a: number, b: number) =>
    (out[2 * a] - out[2 * o]) * (pts[2 * b + 1] - out[2 * o + 1]) - (out[2 * a + 1] - out[2 * o + 1]) * (pts[2 * b] - out[2 * o])
  let k = 0
  const push = (i: number) => {
    out[2 * k] = pts[2 * i]
    out[2 * k + 1] = pts[2 * i + 1]
    k++
  }
  // 下側の鎖、続いて上側の鎖。一直線に並ぶ点は除く
  for (const i of sorted) {
    while (k >= 2 && cross(k - 2, k - 1, i) <= 0) k--
    push(i)
  }
  const lower = k + 1
  for (let j = m - 2; j >= 0; j--) {
    const i = sorted[j]
    while (k >= lower && cross(k - 2, k - 1, i) <= 0) k--
    push(i)
  }
  return k - 1
}

/**
 * 影を作る多角形を1つずつ渡す。ring は [x0, y0, x1, y1, ...]、n は点の数で、必ず反時計回り。
 * ring は使い回すので、とっておくなら写すこと。
 *
 * 屋根面が凸なら、柱は凸な立体で、それを平行な光で地面に写した影も凸になり、底面の点とずらした屋根の点の凸包に等しい。
 * そのときは3種類に分けず、凸包1つだけを渡す（データの屋根面の大半が凸で、多角形の数が数分の1になる）。
 */
export function forEachShadowRing(scene: Scene, sun: SunPosition, emit: (ring: Float64Array, n: number) => void): void {
  const off = shadowOffset(sun)
  if (!off) return
  const [dx, dy] = off
  const { coords, start, count } = scene
  let buf = new Float64Array(64)
  let pts = new Float64Array(128)
  let order = new Uint32Array(64)
  const quad = new Float64Array(8)
  for (let f = 0; f < start.length; f++) {
    const s = start[f] * 3
    const n = count[f]
    if (buf.length < n * 4) buf = new Float64Array(n * 8)
    if (pts.length < n * 4) {
      pts = new Float64Array(n * 8)
      order = new Uint32Array(n * 4)
    }
    if (isConvex(coords, s, n) && isFlat(coords, s, n)) {
      // 平らな凸多角形を d だけ伸ばした形: 1周しながら、d の向きを向いた辺はずらした側、背を向けた辺は元の側を通る。
      // 向きの変わる2つの頂点では、元の点とずらした点の両方を置く
      const ex = coords[s + 2] * dx
      const ey = coords[s + 2] * dy
      let k = 0
      for (let i = 0; i < n; i++) {
        const p = s + 3 * ((i + n - 1) % n)
        const a = s + 3 * i
        const b = s + 3 * ((i + 1) % n)
        // 反時計回りの辺 (ux, uy) の外向きの法線は (uy, -ux)
        const front = (coords[a + 1] - coords[p + 1]) * ex - (coords[a] - coords[p]) * ey > 0
        const nextFront = (coords[b + 1] - coords[a + 1]) * ex - (coords[b] - coords[a]) * ey > 0
        if (!front) {
          buf[2 * k] = coords[a]
          buf[2 * k + 1] = coords[a + 1]
          k++
        }
        if (front || nextFront) {
          buf[2 * k] = coords[a] + ex
          buf[2 * k + 1] = coords[a + 1] + ey
          k++
        }
        if (front && !nextFront) {
          buf[2 * k] = coords[a]
          buf[2 * k + 1] = coords[a + 1]
          k++
        }
      }
      emit(buf, k)
      continue
    }
    if (isConvex(coords, s, n)) {
      for (let i = 0; i < n; i++) {
        const x = coords[s + 3 * i]
        const y = coords[s + 3 * i + 1]
        const z = coords[s + 3 * i + 2]
        pts[4 * i] = x
        pts[4 * i + 1] = y
        pts[4 * i + 2] = x + z * dx
        pts[4 * i + 3] = y + z * dy
      }
      const h = convexHull(pts, 2 * n, order, buf)
      if (h >= 3) emit(buf, h)
      continue
    }
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
