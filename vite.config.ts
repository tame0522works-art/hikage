import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { TILE_ORIGIN } from './src/map/tiles.ts'

/**
 * 公開版に Content Security Policy を入れる。これまでの作品と同じく connect-src 'none' で fetch などの通信をすべて拒否し、
 * 例外は地理院タイルの画像（img-src）だけにする。地図の画像を読み込む以外に、端末の外へ出ていく通り道はない。
 * GitHub Pages はレスポンスヘッダーを設定できないので <meta> で入れる。開発サーバーは更新の通知に WebSocket を使うので、ビルドのときだけ入れる。
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  `img-src 'self' ${TILE_ORIGIN}`,
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'hikage-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      // 文字コードの指定より後ろに置く（文字コードは先頭 1024 バイト以内で宣言する必要がある）
      handler: (html) => html.replace('<meta charset="UTF-8" />', `$&\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  }
}

// GitHub Pages ではリポジトリ名の下（/hikage/）で配信されるので、CI から BASE_PATH で渡す
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // ほかの作品の開発サーバーと重ならないよう、ポートを固定する
  server: { port: 5195, strictPort: true },
  preview: { port: 5196, strictPort: true },
  // 建物データ（2.4MB）は JS のオブジェクトとして書くより JSON.parse のほうが読み込みが速い
  json: { stringify: true },
  // 建物データを JS に同梱する（CSP で fetch を禁じているため）ので、本体は 2.5MB ほどになる。分ける意味がないので警告の上限を上げる
  build: { chunkSizeWarningLimit: 3000 },
  plugins: [contentSecurityPolicy(), react()],
})
