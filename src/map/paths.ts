// 多角形を canvas の Path2D にする。
// Chrome では moveTo / lineTo を数十万回呼ぶと非常に遅い（影の約 5 万多角形・27 万点で 2.7 秒）が、
// SVG のパス文字列にまとめて new Path2D(文字列) にすると約 0.1 秒で済む（2026-10-20、ブラウザ枠で実測）。
import type { Rect, Scene } from '../shadow.ts'
import { forEachShadowRing } from '../shadow.ts'
import type { SunPosition } from '../sun.ts'

function ringToSvg(r: ArrayLike<number>, n: number): string {
  // 座標は cm。画面では 1cm 未満の違いは見えないので整数に丸め、文字列を短くする
  let s = `M${Math.round(r[0])} ${Math.round(r[1])}`
  for (let i = 1; i < n; i++) s += `L${Math.round(r[2 * i])} ${Math.round(r[2 * i + 1])}`
  return s + 'Z'
}

/** 多角形の並び（[x0, y0, ...]、平面座標 cm）を1本の Path2D にする */
export function ringsToPath(rings: ArrayLike<number>[]): Path2D {
  return new Path2D(rings.map((r) => ringToSvg(r, r.length / 2)).join(''))
}

/**
 * 影の多角形を、chunk 個ずつの Path2D に分けて返す。
 * Chrome は多角形が数万個を超える1本のパスを塗ると急に遅くなる（6.4 万個で 29ms、9.6 万個で数十秒）ので分ける。
 * 分けても重なりが濃くならないよう、塗る側（MapView）で別の canvas に不透明で塗ってから重ねる。
 * rect を渡すと、そこに影が届きうる屋根面だけにする。
 */
export function shadowPaths(scene: Scene, sun: SunPosition, chunk: number, rect?: Rect): Path2D[] {
  const paths: Path2D[] = []
  let parts: string[] = []
  forEachShadowRing(scene, sun, (r, n) => {
    parts.push(ringToSvg(r, n))
    if (parts.length === chunk) {
      paths.push(new Path2D(parts.join('')))
      parts = []
    }
  }, rect)
  if (parts.length) paths.push(new Path2D(parts.join('')))
  return paths
}
