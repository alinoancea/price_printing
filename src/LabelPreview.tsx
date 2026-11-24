import { useEffect, useRef } from 'react'

// DEV: deseneaza aproximativ un ZPL (^FO ^A0N ^FB ^FD ^BY ^BC ^GB ^GFA) pe canvas 464x280. Nu e randare exacta Zebra.
async function drawZpl(canvas: HTMLCanvasElement, zpl: string) {
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'top'
  let by = 2
  for (const f of zpl.split('^FS')) {
    const fo = f.match(/\^FO(\d+),(\d+)/)
    if (!fo) continue
    const x = +fo[1]!
    const y = +fo[2]!
    const gb = f.match(/\^GB(\d+),(\d+),(\d+)/)
    if (gb) {
      ctx.fillRect(x, y, +gb[1]!, +gb[2]!)
      continue
    }
    const gf = f.match(/\^GFA,\d+,\d+,(\d+),([0-9A-Fa-f]+)/)
    if (gf) {
      const bpr = +gf[1]!
      const hex = gf[2]!
      for (let i = 0; i < hex.length / 2; i++) {
        const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
        const row = Math.floor(i / bpr)
        const col = (i % bpr) * 8
        for (let k = 0; k < 8; k++) if (byte & (0x80 >> k)) ctx.fillRect(x + col + k, y + row, 1, 1)
      }
      continue
    }
    const fd = f.match(/\^FD([\s\S]*)$/)
    if (!fd) continue
    const text = fd[1]!.trim()
    const bc = f.match(/\^BCN,(\d+)/)
    if (bc) {
      by = +(f.match(/\^BY(\d+)/)?.[1] ?? 2)
      const { default: JsBarcode } = await import('jsbarcode')
      const tmp = document.createElement('canvas')
      JsBarcode(tmp, text, { format: 'CODE128', width: by, height: +bc[1]!, fontSize: 16, margin: 0, displayValue: true })
      ctx.drawImage(tmp, x, y)
      continue
    }
    const a = f.match(/\^A0N,(\d+)/)
    const fb = f.match(/\^FB(\d+),(\d+),(\d+),([LCR])/)
    if (!a) continue
    const h = +a[1]!
    ctx.font = `bold ${Math.round(h * 0.85)}px Arial, sans-serif`
    const w = fb ? +fb[1]! : canvas.width
    const maxLines = fb ? +fb[2]! : 1
    const gap = fb ? +fb[3]! : 0
    const align = fb?.[4] ?? 'L'
    // \& = linie noua ZPL; cuvintele se impacheteaza pe latimea ^FB
    const lines: string[] = []
    let cur = ''
    for (const word of text.replace(/\\&$/, '').split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word
      if (cur && ctx.measureText(next).width > w) {
        lines.push(cur)
        cur = word
      } else cur = next
    }
    lines.push(cur)
    lines.slice(0, maxLines).forEach((line, i) => {
      const tw = ctx.measureText(line).width
      const dx = align === 'C' ? (w - tw) / 2 : align === 'R' ? w - tw : 0
      ctx.fillText(line, x + dx, y + i * (h + gap))
    })
  }
}

export function LabelPreview({ zpl }: { zpl: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) void drawZpl(ref.current, zpl)
  }, [zpl])
  return <canvas ref={ref} width={464} height={280} className="border" />
}
