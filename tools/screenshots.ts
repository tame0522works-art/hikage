// README に載せる画面の画像を撮る。公開と同じ設定のビルドを配信した状態（npm run build → npm run preview）で
// `npm run screenshots` を実行する。Edge（なければ Chrome）を画面なしで起動し、Chrome DevTools Protocol で操作する。
// 日付・時刻・押す地点を決めて毎回同じ手順で撮るので、アプリを直したら同じ画像を撮り直せる。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Browser, sleep, type Page } from './cdp.ts'

const BASE = process.argv[2] ?? 'http://localhost:5196/'
const OUT = 'docs/images'

/** src/App.tsx の INITIAL と同じ */
const INITIAL = { cx: -150, cy: 0, mpp: 0.6 }
/** 行幸通り（丸ビルと新丸ビルの間） */
const GYOKO: [number, number] = [-280, 65]

async function setTime(cdp: Page, date: string, minutes: number) {
  await cdp.run(`
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) };
    set(document.querySelector('input[type=date]'), ${JSON.stringify(date)});
    set(document.querySelector('input[type=range]'), ${JSON.stringify(String(minutes))});
  `)
  await settle(cdp)
}

/** 地理院タイルが読み終わって、描き直しが済むのを待つ */
async function settle(cdp: Page) {
  for (let i = 0; i < 50; i++) {
    const pending = await cdp.run<number>(`return [...performance.getEntriesByType('resource')].length`)
    await sleep(200)
    if (pending === (await cdp.run<number>(`return [...performance.getEntriesByType('resource')].length`))) break
  }
  await sleep(400)
}

async function pick(cdp: Page, [x, y]: [number, number]) {
  const r = await cdp.run<{ left: number; top: number; width: number; height: number }>(`
    const r = document.querySelector('canvas.map').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  `)
  const sx = r.left + r.width / 2 + (x - INITIAL.cx) / INITIAL.mpp
  const sy = r.top + r.height / 2 - (y - INITIAL.cy) / INITIAL.mpp
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: sx, y: sy, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
  }
  await settle(cdp)
}

/** 画面全体、または selector の要素だけを撮る */
async function shoot(cdp: Page, name: string, selector?: string) {
  let clip: object | undefined
  if (selector) {
    const b = await cdp.run<{ x: number; y: number; width: number; height: number }>(`
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    `)
    clip = { ...b, scale: 1 }
  }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'))
  console.log(`  ${OUT}/${name}`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  // このブラウザ専用の一時プロファイルを使うので、普段のデータには触れない
  const browser = await Browser.launch()
  try {
    const cdp = await browser.newPage({ width: 1180, height: 820 })
    const open = async () => {
      await cdp.goto(BASE)
      // 同じポートで別の作品が動いていると、その画面を撮ってしまうので、hikage であることを先に確かめる
      const title = await cdp.run<string>(`return document.title`)
      if (title !== 'hikage') throw new Error(`${BASE} で動いているのは hikage ではありません（ページの題名: ${title || 'なし'}）`)
      await settle(cdp)
    }

    console.log('撮影:')
    // 1. 冬至の正午、行幸通りを押したところ（丸ビル・新丸ビルの影が道をふさぎ、日向は 50 分）
    await open()
    await setTime(cdp, '2026-12-22', 12 * 60)
    await pick(cdp, GYOKO)
    await shoot(cdp, 'winter-noon.png')

    // 2. 同じ地点の夏至の正午（日向 13 時間 25 分）
    await setTime(cdp, '2026-06-21', 12 * 60)
    await shoot(cdp, 'summer-noon.png')

    // 3. 冬至の 9 時・12 時・15 時の地図だけ（影の向きと長さの移り変わり）
    await open()
    for (const [m, name] of [[9 * 60, 'winter-0900.png'], [12 * 60, 'winter-1200.png'], [15 * 60, 'winter-1500.png']] as const) {
      await setTime(cdp, '2026-12-22', m)
      await shoot(cdp, name, 'canvas.map')
    }

    // 4. スマホ（駅前広場を押したところ）
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await open()
    await setTime(cdp, '2026-10-20', 14 * 60)
    await pick(cdp, [-180, 0])
    await shoot(cdp, 'mobile.png')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
