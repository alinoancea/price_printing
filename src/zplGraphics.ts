// Elemente grafice ZPL (^GFA) pentru randul de jos al etichetei: text Segoe UI desenat pe canvas + iconita SGR.
// Fontul 0 al Zebrei nu are aspectul dorit, deci textele mici de aici sunt trimise ca imagini alb-negru.

export type Bitmap = { w: number; h: number; bpr: number; hex: string }

// Iconita SGR (40x30), decupata din logoul "Ambalaj cu garantie", fara text, trasaturi subtiri.
export const SGR_ICON: Bitmap = {
  w: 40,
  h: 30,
  bpr: 5,
  hex: '0000004000000000E000000003E000007F07FE0001FF0FFF8007FF07FFE00F0003E0F01E0000E078380000401C380000001C700000000E60007C0006E000FE0007E000FE0007E0007C0007E000000007E000460007E0000000076000C6000E70003C000E380000001C3C0200003C1E070000780F87C000F007FFE0FFE001FFF1FF80007FE0FE000007C0000000070000000002000000'
}

const cache = new Map<string, Bitmap>()

const SS = 4 // supraesantionare: text desenat de 4 ori mai mare, apoi redus pe acoperire (pastreaza trasaturile subtiri)

function inkBitmap(text: string, bold: boolean, px: number): Bitmap | null {
  const c = document.createElement('canvas')
  const W = Math.ceil(px * text.length * 1.2) + 20
  const H = Math.ceil(px * 2)
  c.width = W * SS
  c.height = H * SS
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#000'
  ctx.font = `${bold ? 700 : 400} ${px * SS}px "Segoe UI", Arial, sans-serif`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, 10 * SS, Math.ceil(px * 1.4) * SS)
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  const need = bold ? 0.35 : 0.3 // acoperirea minima a unui punct pentru a fi negru
  const cov = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let j = 0; j < SS; j++)
        for (let i = 0; i < SS; i++) s += 255 - data[((y * SS + j) * c.width + x * SS + i) * 4]!
      cov[y * W + x] = s / (255 * SS * SS) >= need ? 1 : 0
    }
  let x0 = W, x1 = -1, y0 = H, y1 = -1
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (cov[y * W + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const bpr = Math.ceil(w / 8)
  let hex = ''
  for (let y = 0; y < h; y++)
    for (let b = 0; b < bpr; b++) {
      let v = 0
      for (let k = 0; k < 8; k++) {
        const x = b * 8 + k
        v = (v << 1) | (x < w && cov[(y0 + y) * W + x0 + x] ? 1 : 0)
      }
      hex += v.toString(16).toUpperCase().padStart(2, '0')
    }
  return { w, h, bpr, hex }
}

/** Text Segoe UI cu inaltimea literelor (cifrelor) cat mai apropiata de `inkH` puncte. */
export function textBitmap(text: string, bold: boolean, inkH: number): Bitmap {
  const key = `${text}|${bold}|${inkH}`
  const hit = cache.get(key)
  if (hit) return hit
  const guess = Math.round(inkH / 0.7)
  let best: Bitmap | null = null
  for (let px = Math.max(6, guess - 3); px <= guess + 3; px++) {
    const b = inkBitmap(text, bold, px)
    if (b && (!best || Math.abs(b.h - inkH) < Math.abs(best.h - inkH))) best = b
  }
  const out = best ?? { w: 1, h: 1, bpr: 1, hex: '00' }
  cache.set(key, out)
  return out
}

export function gfa(b: Bitmap, x: number, y: number) {
  const n = (b.hex.length / 2) | 0
  return `^FO${x},${y}^GFA,${n},${n},${b.bpr},${b.hex}^FS`
}

const bar = (x: number, y: number, h: number) => `^FO${x},${y}^GB1,${h},1^FS`

/**
 * Randul de jos, aliniat la dreapta: [logo SGR | +0.50 LEI / SGR | PRET PER L / valoare].
 * Fiecare bara are 12 puncte de spatiu in ambele parti, iar elementele sunt centrate vertical pe inaltimea `rowH`.
 * Elementele lipsa (fara SGR / fara pret per unitate) dispar.
 */
export function bottomRowZpl(opts: {
  sgr: boolean
  perUnit: { title: string; value: string } | null
  rowY: number
  rowH: number // inaltimea randului (barele verticale)
  rightEdge: number
}): string {
  const G = 12
  const { sgr, perUnit, rowY, rowH, rightEdge } = opts
  const mid = (h: number) => rowY + Math.round((rowH - h) / 2) // y pentru un element de inaltime h, centrat
  const t1 = sgr ? textBitmap('+0.50 LEI', false, 12) : null
  const t2 = sgr ? textBitmap('SGR', false, 9) : null
  const cap = perUnit ? textBitmap(perUnit.title, false, 9) : null
  const val = perUnit ? textBitmap(perUnit.value, false, 14) : null
  const lei = perUnit ? textBitmap('LEI', false, 10) : null
  const perW = cap && val && lei ? Math.max(cap.w, val.w + 4 + lei.w) : 0
  const sgrW = t1 ? SGR_ICON.w + G + 1 + G + t1.w : 0
  const total = sgrW + (sgr && perUnit ? G + 1 + G : 0) + perW
  let x = rightEdge - total
  let z = ''
  if (t1 && t2) {
    z += gfa(SGR_ICON, x, mid(SGR_ICON.h))
    const b1 = x + SGR_ICON.w + G
    z += bar(b1, rowY, rowH)
    const tx = b1 + 1 + G
    const gap1 = 6
    const top1 = mid(t1.h + gap1 + t2.h)
    z += gfa(t1, tx, top1)
    z += gfa(t2, tx + ((t1.w - t2.w) >> 1), top1 + t1.h + gap1)
    x = tx + t1.w
    if (perUnit) {
      z += bar(x + G, rowY, rowH)
      x += G + 1 + G
    }
  }
  if (cap && val && lei) {
    const gap2 = 8
    const top2 = mid(cap.h + gap2 + val.h)
    const valY = top2 + cap.h + gap2
    z += gfa(cap, x, top2)
    z += gfa(val, x, valY)
    z += gfa(lei, x + val.w + 4, valY + val.h - lei.h) // LEI aliniat jos cu valoarea
  }
  return z
}
