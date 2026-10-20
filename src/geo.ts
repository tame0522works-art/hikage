// 緯度経度（JGD2011）と、原点で地表に接する平面（東向き・北向きの m）との変換。
// 変換ツール（建物の座標）と画面（地図タイルの位置）で同じ式を使う。

export interface Origin {
  lat: number
  lon: number
}

// GRS80 楕円体（JGD2011 の基準）
const A = 6378137
const F = 1 / 298.257222101
const E2 = F * (2 - F)
const RAD = Math.PI / 180

/**
 * 子午線曲率半径 M と卯酉線曲率半径 N を原点で固定する近似で、原点から 1km の点で約 2cm ずれる（check:convert で実測）。
 * 影の長さは数十 cm 単位でしか意味を持たないので、この近似で足りる。
 */
function radii(origin: Origin) {
  const phi = origin.lat * RAD
  const w = Math.sqrt(1 - E2 * Math.sin(phi) ** 2)
  return { M: (A * (1 - E2)) / w ** 3, N: A / w, cosPhi: Math.cos(phi) }
}

/** 緯度経度 → 平面（m） */
export function projector(origin: Origin) {
  const { M, N, cosPhi } = radii(origin)
  return (lat: number, lon: number): [number, number] => [(lon - origin.lon) * RAD * N * cosPhi, (lat - origin.lat) * RAD * M]
}

/** 平面（m） → 緯度経度。projector のちょうど逆 */
export function unprojector(origin: Origin) {
  const { M, N, cosPhi } = radii(origin)
  return (x: number, y: number): [number, number] => [origin.lat + y / M / RAD, origin.lon + x / (N * cosPhi) / RAD]
}
