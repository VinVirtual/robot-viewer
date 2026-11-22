// The component in real headless Chrome, served with "Content-Security-Policy: default-src 'self'".
// Skipped (with a note) when Playwright or a browser with WebGL is not installed.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRobot, finishDist, readManifest } from '../engine/lib/build.js'
import { serve } from '../engine/lib/server.js'
import { launchBrowser } from '../engine/lib/env.js'
import { watchPage, waitForViewers, verifyDist } from '../engine/lib/verify.js'
import { WREN } from './helpers.mjs'

let browser = null, server = null, dist = null, skip = false
before(async () => {
  try { browser = await launchBrowser() } catch (e) { skip = `no browser: ${String(e.message).split('\n')[0]}`; return }
  const probe = await browser.newPage()
  const gl = await probe.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) })
  await probe.close()
  if (!gl) { skip = 'the browser has no WebGL'; return }
  dist = mkdtempSync(join(tmpdir(), 'robot-viewer-browser-'))
  await buildRobot(join(WREN, 'wren.urdf'), { out: dist, poses: join(WREN, 'poses.json'), title: 'Wren' })
  finishDist(dist)
  const r = readManifest(dist).robots[0]
  const tall = `<!doctype html><html><head><meta charset="utf-8"><title>t</title><script type="module" src="/robot-viewer.js"></script><link rel="stylesheet" href="/demo.css"></head>
<body><svg width="10" height="3200" aria-hidden="true"></svg>
<robot-viewer id="far" src="/${r.glb}" ik></robot-viewer></body></html>`
  server = await serve(dist, { pages: { '/tall.html': tall } })
})
after(async () => {
  await browser?.close()
  await server?.close()
  if (dist) rmSync(dist, { recursive: true, force: true })
})

async function open(path, { reducedMotion = 'no-preference', viewport = { width: 1200, height: 800 }, init = null } = {}) {
  const page = await browser.newPage({ viewport, reducedMotion })
  if (init) await page.addInitScript(init)
  const found = await watchPage(page)
  const engineRequests = []
  page.on('request', (q) => { if (q.url().endsWith('robot-viewer-engine.js')) engineRequests.push(q.url()) })
  await page.goto(server.url + path)
  return { page, found, engineRequests }
}

test('demo page loads under the strict policy with no violations or errors', async (t) => {
  if (skip) return t.skip(skip)
  const r = await verifyDist(dist)
  assert.deepEqual(r.violations, [])
  assert.deepEqual(r.errors, [])
  assert.equal(r.viewers[0].state, 'ready')
  assert.equal(r.viewers[0].joints, 6)
})

test('the engine is fetched only when the viewer scrolls near the screen', async (t) => {
  if (skip) return t.skip(skip)
  const { page, engineRequests } = await open('tall.html', { viewport: { width: 900, height: 500 } })
  await page.waitForTimeout(600)
  assert.equal(engineRequests.length, 0, 'engine loaded before it was needed')
  await page.evaluate(() => document.getElementById('far').scrollIntoView())
  await waitForViewers(page)
  assert.equal(engineRequests.length, 1)
  await page.close()
})

test('sliders work from the keyboard, with limits and spoken values', async (t) => {
  if (skip) return t.skip(skip)
  const { page } = await open('index.html')
  await waitForViewers(page)
  const slider = page.locator('robot-viewer').locator('input[type="range"]').first()
  assert.equal(await slider.getAttribute('min'), '-170')
  assert.equal(await slider.getAttribute('max'), '170')
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  const after = await page.evaluate(() => document.querySelector('robot-viewer').values.base_yaw)
  assert.ok(Math.abs(after - (1 * Math.PI) / 180) < 1e-9, `base_yaw ${after}`)
  assert.equal(await slider.getAttribute('aria-valuetext'), '1 degrees')
  await page.keyboard.press('End')
  assert.ok(Math.abs((await page.evaluate(() => document.querySelector('robot-viewer').values.base_yaw)) - 2.967) < 1e-3)
  const label = await page.locator('robot-viewer').locator('label').first().textContent()
  assert.equal(label, 'base_yaw')
  await page.close()
})

test('pose buttons move the robot smoothly to the pose and mark the active one', async (t) => {
  if (skip) return t.skip(skip)
  const { page } = await open('index.html')
  await waitForViewers(page)
  const samples = await page.evaluate(async () => {
    const v = document.querySelector('robot-viewer')
    const seen = []
    v.addEventListener('joint-change', (e) => seen.push(e.detail.values.shoulder))
    await v.goToPose('reach')
    return { seen, end: v.values.shoulder }
  })
  assert.ok(Math.abs(samples.end - (58 * Math.PI) / 180) < 1e-6)
  assert.ok(samples.seen.length > 3, 'moved in several steps')
  assert.ok(samples.seen.some((s) => s > -0.2 && s < 0.9), 'passed through values between the poses')
  const pressed = await page.locator('robot-viewer').locator('button.pose[aria-pressed="true"]').textContent()
  assert.equal(pressed, 'reach')
  await page.close()
})

test('with reduced motion the poster stays until asked, and poses jump without animation', async (t) => {
  if (skip) return t.skip(skip)
  const { page, engineRequests } = await open('index.html', { reducedMotion: 'reduce' })
  await page.waitForTimeout(500)
  assert.equal(engineRequests.length, 0)
  const start = page.locator('robot-viewer').locator('button.start')
  assert.ok(await start.isVisible())
  await start.click()
  await waitForViewers(page)
  const steps = await page.evaluate(async () => {
    const v = document.querySelector('robot-viewer')
    let n = 0
    v.addEventListener('joint-change', () => n++)
    await v.goToPose('wave')
    return n
  })
  assert.equal(steps, 1)
  await page.close()
})

test('without WebGL the still image stays and the page says why', async (t) => {
  if (skip) return t.skip(skip)
  const init = () => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, ...a) { return /webgl/.test(k) ? null : orig.call(this, k, ...a) } }
  const { page, engineRequests } = await open('index.html', { init })
  await page.waitForFunction(() => document.querySelector('robot-viewer')._state === 'still')
  assert.match(await page.locator('robot-viewer').locator('.status').textContent(), /WebGL/)
  assert.equal(engineRequests.length, 0)
  await page.close()
})

test('dragging the hand moves the arm (inverse kinematics) and stays inside the limits', async (t) => {
  if (skip) return t.skip(skip)
  const { page } = await open('index.html')
  await waitForViewers(page)
  await page.evaluate(() => document.querySelector('robot-viewer').scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(300)
  const before = await page.evaluate(() => document.querySelector('robot-viewer').values)
  const at = await page.evaluate(() => document.querySelector('robot-viewer').linkScreenPoint('hand', [0, 0, 0.012]))
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(at.x - i * 8, at.y - i * 6)
  await page.mouse.up()
  const v = await page.evaluate(() => document.querySelector('robot-viewer').values)
  const moved = ['base_yaw', 'shoulder', 'elbow', 'wrist_pitch'].some((k) => Math.abs(v[k] - before[k]) > 0.01)
  assert.ok(moved, JSON.stringify({ before, v }))
  assert.ok(Math.abs(v.shoulder) <= 1.745 + 1e-9 && Math.abs(v.elbow) <= 2.53 + 1e-9)
  await page.close()
})
