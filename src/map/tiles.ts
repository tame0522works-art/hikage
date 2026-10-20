// 地理院タイル（淡色地図）の番号と位置。タイルはウェブメルカトルの 256px 四方で、淡色地図はズーム 18 まである。
// 出典: https://maps.gsi.go.jp/development/ichiran.html

export const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'
export const TILE_ORIGIN = 'https://cyberjapandata.gsi.go.jp'
export const TILE_MAX_ZOOM = 18
export const TILE_SIZE = 256

const RAD = Math.PI / 180

/** 緯度経度 → ズーム z のタイル番号（小数つき） */
export function tileXY(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z
  const phi = lat * RAD
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n]
}

/** ズーム z のタイル番号（小数つき） → 緯度経度 */
export function tileLatLon(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z
  return [Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / RAD, (x / n) * 360 - 180]
}

export function tileUrl(z: number, x: number, y: number): string {
  return TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}

/** 地図の縮尺（1px あたりの m）に合うタイルのズーム。画面の解像度（dpr）が高ければ細かいタイルを使う */
export function tileZoomFor(metersPerPixel: number, lat: number, dpr: number): number {
  // ズーム z のタイルは赤道で 1px = 156543.03392 / 2^z m、緯度 φ では cos φ 倍
  const z = Math.log2((156543.03392 * Math.cos(lat * RAD)) / (metersPerPixel / dpr))
  return Math.max(0, Math.min(TILE_MAX_ZOOM, Math.round(z)))
}
