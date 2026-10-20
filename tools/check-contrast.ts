// 画面の色の組み合わせが、ライトモードとダークモードの両方で見分けられるかを確かめる（WCAG のコントラスト比）。
// 文字は 4.5 以上、文字以外の部品（帯の日向・日陰・夜、フォーカスの枠、スライダー）は背景に対して 3 以上（WCAG 1.4.11）。
// 色は src/index.css の :root（ライト）と prefers-color-scheme: dark の中の変数から読む
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]))
}
const light = tokens(/:root\s*\{([^}]*)\}/.exec(css)![1])
const darkBlock = /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)
assert.ok(darkBlock, 'ダークモードの色が見つからない')
const dark = { ...light, ...tokens(darkBlock[1]) }

/** 相対輝度（WCAG 2） */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// [何か, 前の色, 後ろの色, 必要な比]（変数名で書く）
const PAIRS: [string, string, string, number][] = [
  ['本文の文字', 'fg', 'bg', 4.5],
  ['補足の文字（案内・出典・目盛り）', 'muted', 'bg', 4.5],
  ['「12:00 は日向」の文字', 'on-sun', 'sun', 4.5],
  ['「12:00 は日陰」の文字', 'on-dark', 'shade', 4.5],
  ['「12:00 は夜」の文字', 'on-dark', 'night', 4.5],
  // 帯の形は縁で示す（日向の黄色を明るい背景に対して 3 にすると、黄色に見えなくなる）
  ['帯の縁と背景', 'bar-edge', 'bg', 3],
  ['帯の日向と日陰の境', 'sun', 'shade', 3],
  ['帯の日陰と夜の境', 'shade', 'night', 3],
  ['帯の日向と夜の境', 'sun', 'night', 3],
  ['フォーカスの枠・スライダー', 'accent', 'bg', 3],
]

const failures: string[] = []
for (const [name, theme] of [
  ['ライト', light],
  ['ダーク', dark],
] as const) {
  for (const [label, fg, bg, need] of PAIRS) {
    assert.ok(theme[fg] && theme[bg], `${name}モードに --${fg} か --${bg} がない`)
    const r = ratio(theme[fg], theme[bg])
    if (r < need) failures.push(`${name}モードの${label}: ${r.toFixed(2)}（${need} 以上が要る。--${fg} ${theme[fg]} / --${bg} ${theme[bg]}）`)
  }
}
assert.deepEqual(failures, [], `コントラスト比が足りない組み合わせがあります:\n${failures.join('\n')}`)

console.log('check:contrast ok')
