// PLATEAU の建物 CityGML から、LOD1 の底面（輪郭）と LOD2 の屋根面（影）を取り出す。
// XML を汎用に解釈するのではなく、PLATEAU の標準製品仕様書どおりに機械で書き出された形
// （bldg:Building の中に bldg:lod1Solid がちょうど1つあり、屋根は bldg:RoofSurface の gml:Polygon）を前提に読む。
// 前提が崩れたら黙って読み飛ばさず、件数を数えて変換の結果に出す。
import type { Building, Ring, Roof } from '../src/data/types.ts'

export interface Origin {
  lat: number
  lon: number
}

export interface ParseStats {
  buildings: number
  /** measuredHeight が -9999（値なし）だったもの。LOD1 の高さを使う */
  noMeasuredHeight: number
  /** measuredHeight と LOD1 の高さが 10cm 以上ずれていたもの（LOD1 は柱にならした高さなので、ずれるのが普通） */
  heightMismatch: number
  /** LOD2 の屋根面がなく、LOD1 の柱で影を落とすもの */
  noRoof: number
  roofFaces: number
  /** 真横から見て面積のない屋根面（垂直な面）。影の形に効かないので捨てる */
  verticalRoofFaces: number
  /** LOD1 がない、底面が見つからないなどで捨てたもの */
  skipped: { id: string; reason: string }[]
}

// GRS80 楕円体（JGD2011 の基準）
const A = 6378137
const F = 1 / 298.257222101
const E2 = F * (2 - F)

/**
 * 緯度経度を、原点で地表に接する平面の東向き・北向きの距離（m）にする。
 * 子午線曲率半径 M と卯酉線曲率半径 N を原点で固定する近似で、原点から 1km の点で約 2cm ずれる（check:convert で実測）。
 * 影の長さは数十 cm 単位でしか意味を持たないので、この近似で足りる。
 */
export function projector(origin: Origin) {
  const phi = (origin.lat * Math.PI) / 180
  const w = Math.sqrt(1 - E2 * Math.sin(phi) ** 2)
  const M = (A * (1 - E2)) / w ** 3
  const N = A / w
  const rad = Math.PI / 180
  return (lat: number, lon: number): [number, number] => [(lon - origin.lon) * rad * N * Math.cos(phi), (lat - origin.lat) * rad * M]
}

function attr(block: string, tag: string): string | undefined {
  return new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(block)?.[1]
}

interface Polygon {
  /** [lat, lon, z] の並び */
  exterior: number[][]
  interiors: number[][][]
}

function posList(s: string): number[][] {
  const v = s.trim().split(/\s+/).map(Number)
  if (v.length % 3 !== 0 || v.some((n) => !Number.isFinite(n))) throw new Error('posList が3次元の数値の並びでない')
  const out: number[][] = []
  for (let i = 0; i < v.length; i += 3) out.push([v[i], v[i + 1], v[i + 2]])
  return out
}

function polygons(solid: string): Polygon[] {
  const out: Polygon[] = []
  for (const m of solid.matchAll(/<gml:Polygon[\s>][\s\S]*?<\/gml:Polygon>/g)) {
    const p = m[0]
    const ext = /<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]*)<\/gml:posList>/.exec(p)
    if (!ext) throw new Error('面に外周がない')
    const interiors = [...p.matchAll(/<gml:interior>[\s\S]*?<gml:posList[^>]*>([^<]*)<\/gml:posList>/g)].map((i) => posList(i[1]))
    out.push({ exterior: posList(ext[1]), interiors })
  }
  return out
}

/** 符号付き面積（反時計回りが正） */
export function signedArea(r: Ring): number {
  let s = 0
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length
    s += r[i] * r[j + 1] - r[j] * r[i + 1]
  }
  return s / 2
}

/** 平面座標（cm の整数）にし、閉じ点と、丸めで重なった連続点を除き、向きをそろえる */
function toRing(points: number[][], project: (lat: number, lon: number) => [number, number], ccw: boolean): Ring {
  const r: Ring = []
  for (const [lat, lon] of points) {
    const [x, y] = project(lat, lon)
    const cx = Math.round(x * 100)
    const cy = Math.round(y * 100)
    const n = r.length
    if (n >= 2 && r[n - 2] === cx && r[n - 1] === cy) continue
    r.push(cx, cy)
  }
  if (r.length >= 4 && r[0] === r[r.length - 2] && r[1] === r[r.length - 1]) r.length -= 2
  if (signedArea(r) > 0 !== ccw) {
    const rev: Ring = []
    for (let i = r.length - 2; i >= 0; i -= 2) rev.push(r[i], r[i + 1])
    return rev
  }
  return r
}

/** 屋根面を平面座標と底面からの高さ（cm）にする。真上から見て面積がなければ null */
function toRoof(points: number[][], bottom: number, project: (lat: number, lon: number) => [number, number]): Roof | null {
  const ring = toRing(points, project, true)
  if (ring.length < 6 || signedArea(ring) === 0) return null
  // toRing は点を間引いたり逆順にしたりするので、高さは平面の位置で元の点から引き直す
  const heightAt = new Map<string, number>()
  for (const [lat, lon, z] of points) {
    const [x, y] = project(lat, lon)
    heightAt.set(`${Math.round(x * 100)},${Math.round(y * 100)}`, Math.max(0, Math.round((z - bottom) * 100)))
  }
  const roof: Roof = []
  for (let i = 0; i < ring.length; i += 2) roof.push(ring[i], ring[i + 1], heightAt.get(`${ring[i]},${ring[i + 1]}`)!)
  return roof
}

export function parseBuildings(xml: string, origin: Origin): { buildings: Building[]; stats: ParseStats } {
  const project = projector(origin)
  const stats: ParseStats = { buildings: 0, noMeasuredHeight: 0, heightMismatch: 0, noRoof: 0, roofFaces: 0, verticalRoofFaces: 0, skipped: [] }
  const buildings: Building[] = []
  for (const m of xml.matchAll(/<bldg:Building gml:id="([^"]+)">([\s\S]*?)<\/bldg:Building>/g)) {
    stats.buildings++
    const [, id, block] = m
    const skip = (reason: string) => stats.skipped.push({ id, reason })
    const solids = [...block.matchAll(/<bldg:lod1Solid>([\s\S]*?)<\/bldg:lod1Solid>/g)]
    if (solids.length !== 1) {
      skip(`lod1Solid が ${solids.length} 個`)
      continue
    }
    let faces: Polygon[]
    try {
      faces = polygons(solids[0][1])
    } catch (e) {
      skip((e as Error).message)
      continue
    }
    const zs = faces.flatMap((f) => f.exterior.map((p) => p[2]))
    const bottom = Math.min(...zs)
    const top = Math.max(...zs)
    // 底面 = すべての点が最も低い標高にある面。LOD1 は底面1枚・屋上1枚の柱なので、ちょうど1枚のはず
    const floors = faces.filter((f) => f.exterior.every((p) => p[2] === bottom))
    if (floors.length !== 1) {
      skip(`底面が ${floors.length} 枚`)
      continue
    }
    const height = top - bottom
    if (!(height > 0)) {
      skip('高さが 0 以下')
      continue
    }
    const measured = Number(attr(block, 'bldg:measuredHeight'))
    if (measured === -9999 || !Number.isFinite(measured)) stats.noMeasuredHeight++
    else if (Math.abs(measured - height) >= 0.1) stats.heightMismatch++
    const outer = toRing(floors[0].exterior, project, true)
    if (outer.length < 6 || signedArea(outer) === 0) {
      skip('底面が面積を持たない')
      continue
    }
    const holes = floors[0].interiors.map((h) => toRing(h, project, false)).filter((h) => h.length >= 6 && signedArea(h) !== 0)
    const roofs: Roof[] = []
    for (const r of block.matchAll(/<bldg:RoofSurface[\s>][\s\S]*?<\/bldg:RoofSurface>/g)) {
      for (const face of polygons(r[0])) {
        stats.roofFaces++
        const roof = toRoof(face.exterior, bottom, project)
        if (roof) roofs.push(roof)
        else stats.verticalRoofFaces++
      }
    }
    if (roofs.length === 0) stats.noRoof++
    let top3 = 0
    for (const r of roofs) for (let i = 2; i < r.length; i += 3) top3 = Math.max(top3, r[i])
    const name = /<gml:name>([^<]*)<\/gml:name>/.exec(block)?.[1].trim()
    buildings.push({
      id,
      ...(name ? { name } : {}),
      base: Math.round(bottom * 100),
      height: roofs.length ? top3 : Math.round(height * 100),
      outer,
      ...(holes.length ? { holes } : {}),
      ...(roofs.length ? { roofs } : {}),
    })
  }
  return { buildings, stats }
}
