// 太陽の高度と方位。J. Meeus『Astronomical Algorithms』第2版の 25 章（太陽の位置、低精度の式）と 12 章（恒星時）による。
// 国立天文台 暦計算室の値との差は tools/check-sun.ts で確かめる。

export interface SunPosition {
  /** 高度（度）。地平線が 0、真上が 90 */
  altitude: number
  /** 方位（度）。北が 0 で東回り */
  azimuth: number
}

const RAD = Math.PI / 180
const sin = (d: number) => Math.sin(d * RAD)
const cos = (d: number) => Math.cos(d * RAD)
const norm360 = (d: number) => ((d % 360) + 360) % 360

/**
 * 地球の自転の遅れ（TT − UT、秒）。2020 年代は 69 秒前後で推移している。
 * これで動くのは太陽の黄経だけで、69 秒の違いは 0.001° に満たないので、定数にしておく。
 */
const DELTA_T = 69

/** ユリウス日 */
export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5
}

/** 太陽の視赤経・視赤緯（度）と、地心距離（天文単位）。T は J2000.0 からのユリウス世紀（TT） */
function equatorial(T: number) {
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T)
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T)
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M)
  const trueLon = L0 + C
  const v = M + C
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cos(v))
  // 章動と光行差の補正（黄道の昇交点の経度 Ω を使う略式）
  const omega = 125.04 - 1934.136 * T
  const lambda = trueLon - 0.00569 - 0.00478 * sin(omega)
  const eps0 = 23 + 26 / 60 + 21.448 / 3600 - (46.815 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600
  const eps = eps0 + 0.00256 * cos(omega)
  const ra = norm360(Math.atan2(cos(eps) * sin(lambda), cos(lambda)) / RAD)
  const dec = Math.asin(sin(eps) * sin(lambda)) / RAD
  // 赤経方向の章動（視恒星時の補正に使う）。章動の主項 Δψ ≈ −17.20″ sin Ω − 1.32″ sin 2L
  const dPsi = (-17.2 * sin(omega) - 1.32 * sin(2 * L0)) / 3600
  return { ra, dec, R, nutationRa: dPsi * cos(eps) }
}

/** グリニッジ平均恒星時（度）。JD は UT */
function greenwichMeanSidereal(jd: number): number {
  const T = (jd - 2451545) / 36525
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000)
}

/**
 * 大気差（度）。幾何学的な高度 h（度）から、見かけの高度との差を求める（Sæmundsson の式、気温 10℃・1010hPa）。
 * 地平線の少し下まで使えるよう、h が −1° より下では −1° の値で止める。
 */
export function refraction(h: number): number {
  const x = Math.max(h, -1)
  return 1.02 / Math.tan((x + 10.3 / (x + 5.11)) * RAD) / 60
}

/**
 * 時刻 date に、緯度 lat・経度 lon（度、東経が正）から見た太陽の中心の高度と方位。
 * apparent が true なら大気差を加えた見かけの高度（影の計算にはこちらを使う）。
 */
export function sunPosition(date: Date, lat: number, lon: number, apparent = true): SunPosition {
  const jd = julianDay(date)
  const T = (jd + DELTA_T / 86400 - 2451545) / 36525
  const { ra, dec, R, nutationRa } = equatorial(T)
  const H = norm360(greenwichMeanSidereal(jd) + nutationRa + lon - ra)
  const sinAlt = sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H)
  let altitude = Math.asin(sinAlt) / RAD
  // 地心から地表へ移した分（太陽の地平視差は 8.794″ ÷ 距離）
  altitude -= (8.794 / 3600 / R) * cos(altitude)
  const azimuth = norm360(Math.atan2(-cos(dec) * sin(H), cos(lat) * sin(dec) - sin(lat) * cos(dec) * cos(H)) / RAD)
  if (apparent) altitude += refraction(altitude)
  return { altitude, azimuth }
}
