// 変換ツール（tools/convert.ts）が書き出し、アプリが読む建物データの形

/** 平面の点の並び。[x0, y0, x1, y1, ...]。原点からの東向き・北向きの距離（cm、整数） */
export type Ring = number[]

export interface Building {
  /** PLATEAU の gml:id */
  id: string
  /** 名前のある建物だけ */
  name?: string
  /** LOD1 の底面の標高（東京湾平均海面からの cm） */
  base: number
  /** 底面から最も高い点までの高さ（cm）。LOD2 の屋根があればその最高点、なければ LOD1 の高さ */
  height: number
  /** LOD1 の底面の外周（反時計回り、閉じ点なし）。地図に描く輪郭と、地点が建物の中かの判定に使う */
  outer: Ring
  /** 中庭などの穴（時計回り、閉じ点なし） */
  holes?: Ring[]
  /**
   * LOD2 の屋根面。影はこの面ごとに「屋根面から地面までの柱」として落とす。
   * LOD1 は建物全体を1本の柱にならした高さなので、低層部の上に塔が立つ超高層では実際の半分ほどになり、影に使えない。
   */
  roofs?: Roof[]
}

/** 屋根面の点の並び。[x0, y0, z0, x1, y1, z1, ...]。z は建物の底面からの高さ。単位はすべて cm、平面は反時計回り、閉じ点なし */
export type Roof = number[]

export interface SourceFile {
  /** 配布 ZIP の中のファイル名 */
  entry: string
  zip: string
  dataset: string
  fetchedAt: string
}

export interface CityData {
  /** 変換したデータの説明と出典（画面にもそのまま出す） */
  attribution: string
  sources: SourceFile[]
  /** 平面座標の原点（緯度・経度、JGD2011） */
  origin: { lat: number; lon: number }
  buildings: Building[]
}
