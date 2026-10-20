// 画面操作のテスト。公開と同じ設定でビルドしたもの（CSP 入り）をローカルで配信し、画面なしの Chrome に
// 本物のマウス・タッチの入力を送って、影の描画・地点の日向と日陰・通信の制限を確かめる。
// `npm run e2e` で実行する（先に dist-e2e へビルドしてから、このスクリプトが配信とブラウザを立ち上げる）。
// 地図の下地は地理院タイルを読むので、インターネットにつながっている必要がある（影と建物の判定はタイルに頼らない）。
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Browser, sleep, type Page, type Viewport } from './cdp.ts'

const PORT = 4195
const BASE = `http://127.0.0.1:${PORT}/`
const DESKTOP: Viewport = { width: 1280, height: 860 }
const PHONE: Viewport = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true }
const FAILURES = 'e2e-failures'

/** アプリの最初の表示（src/App.tsx の INITIAL）: 画面中央が平面座標 (-150, 0) m、1px 0.6m */
const INITIAL = { cx: -150, cy: 0, mpp: 0.6 }
/** 行幸通り（丸ビルの北端 y=35m と新丸ビルの南端 y=94m の間） */
const GYOKO: [number, number] = [-280, 65]
/** 駅前広場（スマホの幅 390px でも最初の表示に入る、x は -267〜-33m） */
const PLAZA: [number, number] = [-180, 0]
/** 丸ビルの中 */
const MARUBIRU: [number, number] = [-300, -20]

class Ui {
  readonly page: Page
  constructor(page: Page) {
    this.page = page
  }

  async open() {
    await this.page.goto(BASE)
    await this.page.waitFor(`document.querySelector('canvas.map') && document.querySelector('canvas.map').width > 0`, '地図の表示')
    await sleep(300)
  }

  /** 日付（YYYY-MM-DD）と時刻（0 時からの分）を入れる */
  async setTime(date: string, minutes: number) {
    await this.page.run(`
      const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) };
      set(document.querySelector('input[type=date]'), ${JSON.stringify(date)});
      set(document.querySelector('input[type=range]'), ${JSON.stringify(String(minutes))});
    `)
    await this.drawn()
  }

  /** 次の描画が終わるのを待つ（地図は requestAnimationFrame か 100ms 後の setTimeout で描く） */
  async drawn() {
    await sleep(250)
  }

  /** 平面座標（m）の地点が、最初の表示で画面のどこに来るか（ページの CSS px） */
  async screenOf([x, y]: [number, number]) {
    const r = await this.page.run<{ left: number; top: number; width: number; height: number }>(`
      const r = document.querySelector('canvas.map').getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    `)
    return { x: r.left + r.width / 2 + (x - INITIAL.cx) / INITIAL.mpp, y: r.top + r.height / 2 - (y - INITIAL.cy) / INITIAL.mpp }
  }

  async click(x: number, y: number) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
    }
    await this.drawn()
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    await this.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 10; i++) {
      await this.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10, button: 'left', buttons: 1 })
    }
    await this.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 })
    await this.drawn()
  }

  async tap(x: number, y: number) {
    await this.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await this.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await this.drawn()
  }

  text(selector: string) {
    return this.page.run<string>(`return document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`)
  }

  /**
   * 地図の canvas のうち、影の色の画素の割合。影は青み（rgb(28,44,120) を 45%）を重ねるので、青が赤より 30 以上強い画素を数える。
   * 地図タイルは灰色にしてあり、建物は生成り色なので、影以外でこの条件に当たる所はほとんどない
   */
  shadowRatio() {
    return this.page.run<number>(`
      const c = document.querySelector('canvas.map');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i + 2] - d[i] > 30) n++;
      return n / (d.length / 16);
    `)
  }

  /** canvas の中身の要約（動かしたかどうかを見るため） */
  canvasHash() {
    return this.page.run<number>(`
      const c = document.querySelector('canvas.map');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 1009) h = (h * 31 + d[i]) | 0;
      return h;
    `)
  }
}

interface Scenario {
  name: string
  viewport?: Viewport
  run: (ui: Ui) => Promise<void>
}

const scenarios: Scenario[] = [
  {
    name: '開くと地図・建物・影と出典が出る',
    async run(ui) {
      await ui.open()
      assert.equal(await ui.page.run(`return document.title`), 'hikage')
      await ui.setTime('2026-10-20', 12 * 60)
      // 地理院タイルが読めている（CORS の anonymous で読むので canvas が汚れず、getImageData できる）
      await ui.page.waitFor(`performance.getEntriesByType('resource').some(e => e.name.startsWith('https://cyberjapandata.gsi.go.jp/xyz/pale/18/'))`, '地理院タイルの読み込み')
      const ratio = await ui.shadowRatio()
      assert.ok(ratio > 0.03 && ratio < 0.6, `影の割合 ${ratio}`)
      const credit = await ui.text('.credit')
      assert.match(credit, /地理院タイル/)
      assert.match(credit, /Project PLATEAU.*加工して作成/)
      const links = await ui.page.run<string[]>(`return [...document.querySelectorAll('.credit a')].map(a => a.href)`)
      assert.ok(links.includes('https://maps.gsi.go.jp/development/ichiran.html'))
      assert.ok(links.some((l) => l.startsWith('https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2025')))
    },
  },
  {
    name: '時刻を変えると影が変わり、冬至の朝は夏至の正午より影が広い',
    async run(ui) {
      await ui.open()
      await ui.setTime('2026-06-21', 12 * 60)
      const summer = await ui.shadowRatio()
      assert.match(await ui.text('.sun'), /高度 77\.\d°/)
      await ui.setTime('2026-12-22', 9 * 60)
      const winter = await ui.shadowRatio()
      assert.match(await ui.text('.sun'), /高度 19\.\d°/)
      assert.ok(winter > summer * 2, `冬至 9時 ${winter.toFixed(3)}、夏至 12時 ${summer.toFixed(3)}`)
      await ui.setTime('2026-12-22', 23 * 60)
      assert.match(await ui.text('.sun'), /夜/)
      assert.equal(await ui.shadowRatio(), 0, '夜は影を描かない（全体を暗くする）')
    },
  },
  {
    name: '地点を押すと1日の日向・日陰の帯が出て、帯を押すと時刻が移る',
    async run(ui) {
      await ui.open()
      await ui.setTime('2026-12-22', 12 * 60)
      assert.match(await ui.text('.pick'), /地図を押すと/)
      const p = await ui.screenOf(GYOKO)
      await ui.click(p.x, p.y)
      // check:timeline と同じ地点・日付なので、日向の合計も同じになる
      assert.match(await ui.text('.day-summary'), /日向 50分/)
      await ui.setTime('2026-06-21', 12 * 60)
      assert.match(await ui.text('.day-summary'), /日向 13時間25分（5:35〜19:00）/)
      // 帯の 3/4（18:00）を押す
      const bar = await ui.page.run<{ x: number; y: number; w: number }>(`const r = document.querySelector('.day-bar').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }`)
      await ui.click(bar.x + bar.w * 0.75, bar.y)
      assert.equal(await ui.text('.clock'), '18:00')
      assert.match(await ui.text('.day-now'), /18:00 は日向/)
      // 閉じる
      await ui.page.run(`document.querySelector('.day-close').click()`)
      await ui.drawn()
      assert.match(await ui.text('.pick'), /地図を押すと/)
    },
  },
  {
    name: '建物の中を押すと、その旨を出す',
    async run(ui) {
      await ui.open()
      const p = await ui.screenOf(MARUBIRU)
      await ui.click(p.x, p.y)
      assert.match(await ui.text('.pick'), /丸の内ビルディングの中です/)
    },
  },
  {
    name: 'ドラッグで動かした地図は、押した判定にならない',
    async run(ui) {
      await ui.open()
      await ui.setTime('2026-10-20', 12 * 60)
      const before = await ui.canvasHash()
      const p = await ui.screenOf(GYOKO)
      await ui.drag(p, { x: p.x + 120, y: p.y + 60 })
      assert.notEqual(await ui.canvasHash(), before, '地図が動いていない')
      assert.match(await ui.text('.pick'), /地図を押すと/, 'ドラッグで地点が選ばれた')
      // ホイールで寄せる
      const h = await ui.canvasHash()
      await ui.page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: -300 })
      await ui.drawn()
      assert.notEqual(await ui.canvasHash(), h, 'ホイールで寄らない')
    },
  },
  {
    name: '公開版の CSP: 通信は拒否し、地理院タイルの画像だけ読める',
    async run(ui) {
      await ui.open()
      const csp = await ui.page.run<string>(`return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`)
      assert.match(csp, /connect-src 'none'/)
      assert.match(csp, /img-src 'self' https:\/\/cyberjapandata\.gsi\.go\.jp/)
      const blocked = await ui.page.run<boolean>(`
        try { await fetch('https://cyberjapandata.gsi.go.jp/xyz/pale/18/232846/103226.png'); return false } catch { return true }
      `)
      assert.ok(blocked, 'fetch が通ってしまう')
      const violations = await ui.page.run<string[]>(`return window.__csp`)
      assert.deepEqual(violations, ['connect-src https://cyberjapandata.gsi.go.jp/xyz/pale/18/232846/103226.png'])
    },
  },
  {
    name: 'スマホ: 指で地点を押せて、横にはみ出さない',
    viewport: PHONE,
    async run(ui) {
      await ui.open()
      await ui.setTime('2026-06-21', 12 * 60)
      const p = await ui.screenOf(PLAZA)
      await ui.tap(p.x, p.y)
      assert.match(await ui.text('.day-summary'), /日向 \d+(時間|分)/)
      const layout = await ui.page.run<{ scrollW: number; innerW: number; mapH: number }>(`
        return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, mapH: document.querySelector('canvas.map').getBoundingClientRect().height };
      `)
      assert.equal(layout.scrollW, layout.innerW, '横にはみ出している')
      assert.ok(layout.mapH > 400, `地図の高さ ${layout.mapH}px`)
    },
  },
]

let server: ChildProcess | null = null

async function startServer() {
  // vite の preview で dist-e2e を配信する（npx を介さず、どの OS でも同じ起動のしかたにする）
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-e2e', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) return
    await sleep(100)
  }
  await stopServer()
  throw new Error('テスト用のサーバーが起動しませんでした')
}

async function stopServer() {
  if (!server) return
  const s = server
  server = null
  const exited = new Promise((r) => s.once('exit', r))
  s.kill()
  await exited
}

async function main() {
  const only = process.argv[2]
  await startServer()
  const browser = await Browser.launch(9337)
  let failed = 0
  try {
    for (const s of scenarios.filter((s) => !only || s.name.includes(only))) {
      const page = await browser.newPage(s.viewport ?? DESKTOP)
      // ページの中で起きた CSP 違反を記録しておく（意図して起こすもの以外は起きないはず）
      await page.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));`,
      })
      const ui = new Ui(page)
      const t0 = Date.now()
      try {
        await s.run(ui)
        if (!s.name.startsWith('公開版の CSP')) assert.deepEqual(await page.run(`return window.__csp`), [], 'CSP 違反が起きた')
        console.log(`  ✓ ${s.name}（${((Date.now() - t0) / 1000).toFixed(1)}秒）`)
      } catch (e) {
        failed++
        console.log(`  ✗ ${s.name}\n      ${e instanceof Error ? e.message : String(e)}`)
        mkdirSync(FAILURES, { recursive: true })
        const { data } = await page.send('Page.captureScreenshot', { format: 'png' }).catch(() => ({ data: '' }))
        if (data) writeFileSync(join(FAILURES, `${scenarios.indexOf(s) + 1}.png`), Buffer.from(data, 'base64'))
      } finally {
        await page.send('Page.close').catch(() => {})
      }
    }
  } finally {
    await browser.close()
    await stopServer()
  }
  if (failed > 0) {
    console.log(`\n${failed} 件失敗しました（失敗時の画面: ${FAILURES}/）`)
    process.exit(1)
  }
  console.log('\ne2e OK')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
