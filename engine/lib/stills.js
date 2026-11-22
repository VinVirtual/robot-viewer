// Still images of a robot, drawn by the real component in headless Chrome under the strict CSP:
// the poster (shown before the 3D view, and instead of it without WebGL or with reduced motion).
import sharp from 'sharp'
import { serve } from './server.js'
import { launchBrowser } from './env.js'
import { watchPage } from './verify.js'
import { escapeHtml } from './html.js'
import { FILES } from './bundle.js'
import { writeSafe } from './files.js'
import { dirname, basename } from 'node:path'

export function stillPage({ glb, orbit = '35 18', theme = 'light' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>still</title>
<script type="module" src="/${FILES.entry}"></script></head>
<body><robot-viewer src="/${escapeHtml(glb)}" controls="none" grid="off" loading="eager" orbit="${escapeHtml(orbit)}" theme="${escapeHtml(theme)}"></robot-viewer></body></html>`
}

/**
 * Render stills of robots in `dir`. Each shot: { glb, out (path without extension), pose?, values?, orbit?, width?, height? }.
 * Writes <out>.png (and <out>.webp when webp is true) with a transparent background. Returns the files written.
 */
export async function renderStills(dir, shots, { scale = 2, webp = true, log = () => {} } = {}) {
  const pages = Object.fromEntries(shots.map((s, i) => [`/__still${i}.html`, stillPage(s)]))
  const server = await serve(dir, { pages })
  const browser = await launchBrowser()
  const written = []
  try {
    for (let i = 0; i < shots.length; i++) {
      const s = { width: 1200, height: 900, ...shots[i] }
      const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: scale })
      const found = await watchPage(page)
      await page.goto(`${server.url}__still${i}.html`)
      await page.evaluate(({ w, h }) => {
        document.documentElement.style.background = 'transparent'
        document.body.style.margin = '0'
        const v = document.querySelector('robot-viewer')
        v.style.width = `${w}px`
        v.style.height = `${h}px`
        v.style.setProperty('--rv-aspect', `${w} / ${h}`)
      }, { w: s.width, h: s.height })
      await page.waitForFunction(() => ['ready', 'error', 'still'].includes(document.querySelector('robot-viewer')._state), null, { timeout: 120000 })
      const state = await page.evaluate(() => document.querySelector('robot-viewer')._state)
      if (state !== 'ready') throw new Error(`the robot did not load for the still (${state}): ${found.errors.join('; ')}`)
      await page.evaluate(async ({ pose, values }) => {
        const v = document.querySelector('robot-viewer')
        if (pose) await v.goToPose(pose, { animate: false })
        if (values) v.setJoints(values)
        v.fitView({ current: true })
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }, { pose: s.pose || null, values: s.values || null })
      await page.waitForTimeout(250)
      const png = await page.locator('robot-viewer').screenshot({ omitBackground: true })
      const violations = [...found.violations, ...(await page.evaluate(() => window.__rvViolations))]
      if (violations.length) throw new Error(`policy violations while drawing the still: ${violations.join('; ')}`)
      const full = sharp(png).resize(s.width, s.height)
      writeSafe(dirname(s.out), `${basename(s.out)}.png`, await full.clone().png({ compressionLevel: 9, palette: false }).toBuffer())
      written.push(`${s.out}.png`)
      if (webp) { writeSafe(dirname(s.out), `${basename(s.out)}.webp`, await full.clone().webp({ quality: 82, alphaQuality: 90 }).toBuffer()); written.push(`${s.out}.webp`) }
      log(`still: ${written.slice(-2).join(', ')}`)
      await page.close()
    }
  } finally {
    await browser.close()
    await server.close()
  }
  return written
}
