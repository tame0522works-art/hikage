// 使う PLATEAU のデータ。
// 確認日: 2026-10-20（G空間情報センターのデータセットページから CityGML（v5）の URL を取得）
// 東京都が整備した建物ファイルはメッシュ単位で、区の境をまたぐ建物も全部入っている。
// 千代田区と中央区の ZIP から同じメッシュを取り出して比べたところ、CRC まで一致したので、千代田区の ZIP だけを使う。

export interface PlateauSource {
  /** 区の名前（出典表記に使う） */
  ward: string
  /** G空間情報センターのデータセットページ */
  dataset: string
  /** CityGML の ZIP */
  zip: string
}

export const SOURCES: PlateauSource[] = [
  {
    ward: '千代田区',
    dataset: 'https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2025',
    zip: 'https://assets.cms.plateau.reearth.io/assets/d1/e11ec4-3ad6-4923-a441-32cbd7455dee/13101_chiyoda-ku_pref_2025_citygml_1_op.zip',
  },
]

/**
 * 第3次地域区画（約1km四方）。53394611 が東京駅・丸の内・八重洲、53394621 がその北の大手町・日本橋。
 * 駅は 53394611 の北端から約 230m なので、北側の高い建物の影を取りこぼさないよう 53394621 も入れる。
 */
export const MESHES = ['53394611', '53394621']

export const BUILDING_FILE = /^udx\/bldg\/(\d{8})_bldg_6697(?:_\d+)?_op\.gml$/
