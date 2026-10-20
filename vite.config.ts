import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages ではリポジトリ名の下（/hikage/）で配信されるので、CI から BASE_PATH で渡す
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // ほかの作品の開発サーバーと重ならないよう、ポートを固定する
  server: { port: 5195, strictPort: true },
  preview: { port: 5196, strictPort: true },
  plugins: [react()],
})
