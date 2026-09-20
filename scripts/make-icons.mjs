// Generates PWA icons (192/512/maskable) with the Telepatty wordmark.
import { writeFileSync, mkdirSync } from 'node:fs'
import { PNG } from 'pngjs'

function makeIcon(size, maskable) {

  const png = new PNG({ width: size, height: size })
  const bg = { r: 5, g: 8, b: 7 }
  const accent = { r: 0, g: 255, b: 157 }
  const dim = { r: 28, g: 42, b: 36 }
  const pad = maskable ? 0 : 0
  const barW = Math.round(size * 0.09)
  const barH = Math.round(size * 0.34)
  const gap = Math.round(size * 0.05)
  const x0 = Math.round(size / 2 - (barW * 2 + gap) / 2)
  const y0 = Math.round(size / 2 - barH / 2)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2
      let { r, g, b } = bg
      // subtle grid
      if (x % 42 === 0 || y % 42 === 0) {
        r = dim.r
        g = dim.g
        b = dim.b
      }
      // two bars (▮▮)
      const inBar1 = x >= x0 && x < x0 + barW && y >= y0 && y < y0 + barH
      const inBar2 = x >= x0 + barW + gap && x < x0 + barW * 2 + gap && y >= y0 + Math.round(barH * 0.2) && y < y0 + barH
      if (inBar1 || inBar2) {
        r = accent.r
        g = accent.g
        b = accent.b
      }
      png.data[idx] = r
      png.data[idx + 1] = g
      png.data[idx + 2] = b
      png.data[idx + 3] = 255
    }
  }
  void pad
  return PNG.sync.write(png)
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-192.png', makeIcon(192, false))
writeFileSync('public/icons/icon-512.png', makeIcon(512, false))
writeFileSync('public/icons/maskable-512.png', makeIcon(512, true))
console.log('icons generated')
