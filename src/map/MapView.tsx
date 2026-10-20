// 地図。地理院タイル・影・建物の順に1枚の canvas に描く。
// 影と建物は平面座標（cm）の Path2D のまま、canvas の変換行列で画面に合わせるので、動かしたときに作り直さない。
import { useEffect, useMemo, useRef } from 'react'
import { projector, unprojector, type Origin } from '../geo.ts'
import type { Rect } from '../shadow.ts'
import { TILE_SIZE, tileLatLon, tileUrl, tileXY, tileZoomFor } from './tiles.ts'
import { panBy, toLocal, toScreen, zoomAt, type Limits, type Size, type View } from './view.ts'

interface Props {
  origin: Origin
  limits: Limits
  initial: View
  buildings: Path2D
  /**
   * 範囲（平面座標 cm）を渡すと、そこにかかる影のパス（反時計回りの多角形を分けて入れたもの）を返す。null なら夜（全体を暗くする）。
   * 地図は映す範囲の周りに余白をとって頼み、動かして余白の外に出たときだけ頼み直す
   */
  shadows: ((rect: Rect) => Path2D[]) | null
  /** 押した地点（平面座標 m）。印を描く */
  marker: [number, number] | null
  /** 地図を（動かさずに）押したとき、その地点の平面座標（m）を渡す */
  onPick: (x: number, y: number) => void
}

/** 影を頼むとき、映す範囲の周りにとる余白（幅・高さに対する割合） */
const SHADOW_MARGIN = 0.5

/** 押してから離すまでにこれより動いたら、押したのではなく動かしたとみなす（CSS px） */
const TAP_SLOP = 6

const SHADOW = 'rgb(28, 44, 120)'
const SHADOW_ALPHA = 0.45
const NIGHT = 'rgba(15, 20, 45, 0.55)'
const BUILDING_FILL = '#fbf6ea'
const BUILDING_LINE = '#6f6857'
const MARKER = '#d9480f'
/** 地図は影と建物の下地なので、色を抜いて薄くする（淡色地図の線路の赤や黄色が影より目立たないように） */
const TILE_FILTER = 'grayscale(1) brightness(1.06) contrast(0.75)'

export default function MapView({ origin, limits, initial, buildings, shadows, marker, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef<View>(initial)
  const sizeRef = useRef<Size>({ width: 0, height: 0 })
  const tilesRef = useRef(new Map<string, HTMLImageElement>())
  const drawRef = useRef<() => void>(() => {})
  const pendingRef = useRef(false)
  const layerRef = useRef<HTMLCanvasElement | null>(null)
  const shadowCacheRef = useRef<{ source: (rect: Rect) => Path2D[]; rect: Rect; paths: Path2D[] } | null>(null)
  const limitsRef = useRef(limits)
  limitsRef.current = limits
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const project = useMemo(() => projector(origin), [origin])
  const unproject = useMemo(() => unprojector(origin), [origin])

  // 描く内容（影・建物）が変わるたびに描き方を差し替える
  drawRef.current = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const { width, height } = sizeRef.current
    const dpr = window.devicePixelRatio || 1
    const v = viewRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#e8e8e4'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 1. 地理院タイル。画面の四隅を含むタイルを並べ、各タイルの角を平面座標に直して置く
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const z = tileZoomFor(v.mpp, origin.lat, dpr)
    const [nwLat, nwLon] = unproject(...toLocal(v, sizeRef.current, 0, 0))
    const [seLat, seLon] = unproject(...toLocal(v, sizeRef.current, width, height))
    const [x0, y0] = tileXY(nwLat, nwLon, z).map(Math.floor)
    const [x1, y1] = tileXY(seLat, seLon, z).map(Math.floor)
    ctx.filter = TILE_FILTER
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const img = tile(z, tx, ty)
        if (!img.complete || img.naturalWidth === 0) continue
        const [la, lo] = tileLatLon(tx, ty, z)
        const [lb, lob] = tileLatLon(tx + 1, ty + 1, z)
        const [ax, ay] = toScreen(v, sizeRef.current, ...project(la, lo))
        const [bx, by] = toScreen(v, sizeRef.current, ...project(lb, lob))
        // 隣のタイルとの間に髪の毛ほどの隙間が出ないよう、端を整数に丸める
        const l = Math.floor(ax), t = Math.floor(ay)
        ctx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE, l, t, Math.ceil(bx) - l, Math.ceil(by) - t)
      }
    }
    ctx.filter = 'none'

    // 2. 影と 3. 建物。平面座標（cm）→ 画面（デバイス px）
    const k = dpr / (100 * v.mpp)
    ctx.setTransform(k, 0, 0, -k, dpr * (width / 2 - v.cx / v.mpp), dpr * (height / 2 + v.cy / v.mpp))
    if (shadows) {
      // 影は別の canvas に不透明で塗ってから半透明で重ねる（パスを分けても、重なった所が濃くならない）
      const layer = (layerRef.current ??= document.createElement('canvas'))
      if (layer.width !== canvas.width || layer.height !== canvas.height) {
        layer.width = canvas.width
        layer.height = canvas.height
      }
      const lc = layer.getContext('2d')!
      lc.setTransform(1, 0, 0, 1, 0, 0)
      lc.clearRect(0, 0, layer.width, layer.height)
      lc.setTransform(ctx.getTransform())
      lc.fillStyle = SHADOW
      for (const p of shadowsInView(v)) lc.fill(p, 'nonzero')
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = SHADOW_ALPHA
      ctx.drawImage(layer, 0, 0)
      ctx.restore()
    }
    ctx.fillStyle = BUILDING_FILL
    ctx.fill(buildings, 'evenodd')
    ctx.strokeStyle = BUILDING_LINE
    ctx.lineWidth = 1.2 / k
    ctx.stroke(buildings)
    if (!shadows) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = NIGHT
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    if (marker) {
      const [mx, my] = toScreen(v, sizeRef.current, marker[0], marker[1])
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.beginPath()
      ctx.arc(mx, my, 7, 0, Math.PI * 2)
      ctx.fillStyle = MARKER
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    }
  }

  /** 映す範囲にかかる影のパス。前に頼んだ範囲（余白つき）に収まっていて、影の元が同じなら使い回す */
  function shadowsInView(v: View): Path2D[] {
    const [ax, ay] = toLocal(v, sizeRef.current, 0, 0)
    const [bx, by] = toLocal(v, sizeRef.current, sizeRef.current.width, sizeRef.current.height)
    const view: Rect = [ax * 100, by * 100, bx * 100, ay * 100]
    const cache = shadowCacheRef.current
    if (cache && cache.source === shadows && cache.rect[0] <= view[0] && cache.rect[1] <= view[1] && cache.rect[2] >= view[2] && cache.rect[3] >= view[3]) {
      return cache.paths
    }
    const mx = (view[2] - view[0]) * SHADOW_MARGIN
    const my = (view[3] - view[1]) * SHADOW_MARGIN
    const rect: Rect = [view[0] - mx, view[1] - my, view[2] + mx, view[3] + my]
    const paths = shadows!(rect)
    shadowCacheRef.current = { source: shadows!, rect, paths }
    return paths
  }

  function tile(z: number, x: number, y: number): HTMLImageElement {
    const key = `${z}/${x}/${y}`
    let img = tilesRef.current.get(key)
    if (!img) {
      img = new Image()
      // 地理院タイルは CORS を許可している（Access-Control-Allow-Origin: *）。anonymous で読めば資格情報を送らず、
      // canvas も汚染されないので、描いた結果を読み出して確かめられる
      img.crossOrigin = 'anonymous'
      img.onload = requestDraw
      img.src = tileUrl(z, x, y)
      tilesRef.current.set(key, img)
    }
    return img
  }

  function requestDraw() {
    if (pendingRef.current) return
    pendingRef.current = true
    const run = () => {
      if (!pendingRef.current) return
      pendingRef.current = false
      drawRef.current()
    }
    requestAnimationFrame(run)
    // 画面が隠れていると requestAnimationFrame が呼ばれないので、少し待って描く
    setTimeout(run, 100)
  }

  useEffect(() => {
    requestDraw()
  })

  // 大きさの追従と、ドラッグ・ホイール・2本指での操作
  useEffect(() => {
    const canvas = canvasRef.current!
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const r = canvas.getBoundingClientRect()
      sizeRef.current = { width: r.width, height: r.height }
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
      drawRef.current()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const pointers = new Map<number, { x: number; y: number }>()
    // 1本指で押して、ほとんど動かさずに離したら「地点を押した」
    let tap: { id: number; x: number; y: number } | null = null
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onDown = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // すでに離されたポインターなどでは捕まえられない。捕まえられなくても操作は続ける
      }
      const p = local(e)
      pointers.set(e.pointerId, p)
      tap = pointers.size === 1 ? { id: e.pointerId, ...p } : null
    }
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const p = local(e)
      if (tap && Math.hypot(p.x - tap.x, p.y - tap.y) > TAP_SLOP) tap = null
      if (pointers.size === 1) {
        viewRef.current = panBy(viewRef.current, p.x - prev.x, p.y - prev.y, limitsRef.current)
      } else if (pointers.size === 2) {
        // 2本指: 指の間の距離の比で寄せ引きし、指の中点の移動で動かす
        const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1]
        const before = Math.hypot(prev.x - other.x, prev.y - other.y)
        const after = Math.hypot(p.x - other.x, p.y - other.y)
        const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 }
        const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }
        let v = panBy(viewRef.current, mid.x - prevMid.x, mid.y - prevMid.y, limitsRef.current)
        if (before > 0 && after > 0) v = zoomAt(v, sizeRef.current, mid.x, mid.y, before / after, limitsRef.current)
        viewRef.current = v
      }
      pointers.set(e.pointerId, p)
      requestDraw()
    }
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (e.type === 'pointerup' && tap?.id === e.pointerId) onPickRef.current(...toLocal(viewRef.current, sizeRef.current, tap.x, tap.y))
      tap = null
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      viewRef.current = zoomAt(viewRef.current, sizeRef.current, p.x, p.y, Math.exp(e.deltaY * 0.0015), limitsRef.current)
      requestDraw()
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [])

  return <canvas ref={canvasRef} className="map" aria-label="東京駅・丸の内の地図と建物の影" />
}
