// 地図の表示範囲。中心（平面の m）と縮尺（1px あたりの m）で持ち、画面の座標（CSS px）と相互に変換する。
// 平面の y は北が正、画面の y は下が正なので、ここで向きを反転する。

export interface View {
  /** 画面中央の平面座標（m） */
  cx: number
  cy: number
  /** 1 CSS px あたりの m */
  mpp: number
}

export interface Size {
  width: number
  height: number
}

/** 動かせる範囲と縮尺の限度 */
export interface Limits {
  /** 中心を置ける範囲（m） [minX, minY, maxX, maxY] */
  area: [number, number, number, number]
  minMpp: number
  maxMpp: number
}

export function toScreen(v: View, s: Size, x: number, y: number): [number, number] {
  return [s.width / 2 + (x - v.cx) / v.mpp, s.height / 2 - (y - v.cy) / v.mpp]
}

export function toLocal(v: View, s: Size, sx: number, sy: number): [number, number] {
  return [v.cx + (sx - s.width / 2) * v.mpp, v.cy - (sy - s.height / 2) * v.mpp]
}

export function clampView(v: View, l: Limits): View {
  const mpp = Math.min(l.maxMpp, Math.max(l.minMpp, v.mpp))
  return {
    cx: Math.min(l.area[2], Math.max(l.area[0], v.cx)),
    cy: Math.min(l.area[3], Math.max(l.area[1], v.cy)),
    mpp,
  }
}

/** 画面の点 (sx, sy) を動かさずに、縮尺を factor 倍（>1 で引き、<1 で寄る）にする */
export function zoomAt(v: View, s: Size, sx: number, sy: number, factor: number, l: Limits): View {
  const [x, y] = toLocal(v, s, sx, sy)
  const mpp = Math.min(l.maxMpp, Math.max(l.minMpp, v.mpp * factor))
  // 寄せたあとも (x, y) が同じ (sx, sy) に来るよう中心を動かす
  return clampView({ mpp, cx: x - (sx - s.width / 2) * mpp, cy: y + (sy - s.height / 2) * mpp }, l)
}

export function panBy(v: View, dx: number, dy: number, l: Limits): View {
  return clampView({ ...v, cx: v.cx - dx * v.mpp, cy: v.cy + dy * v.mpp }, l)
}
