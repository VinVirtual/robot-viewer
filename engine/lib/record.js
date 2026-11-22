// A short video of the viewer in use: pose buttons, a slider drag and (when on) dragging a part.
// Headless Chrome runs on a fake clock, so each frame is taken exactly 1/fps apart however slow the
// software renderer is, and the video plays smoothly. A drawn pointer shows where the "hand" is.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { serve } from './server.js'
import { launchBrowser, findFF } from './env.js'
import { watchPage } from './verify.js'
import { readManifest } from './build.js'
import { escapeHtml } from './html.js'
import { FILES } from './bundle.js'

const page = (r, theme) => `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><title>record</title>
<script type="module" src="/${FILES.entry}"></script></head>
<body><robot-viewer src="/${escapeHtml(r.glb)}" alt="${escapeHtml(r.alt)}" loading="eager" theme="${theme}"${r.orbit ? ` orbit="${escapeHtml(r.orbit)}"` : ''}${r.defaultPose ? ` pose="${escapeHtml(r.defaultPose)}"` : ''}${r.ik ? ' ik' : ''}></robot-viewer>
<div class="pointer"></div></body></html>`

/** The plan, as steps of { do, ... } with durations in seconds. Uses only poses and joints the robot has. */
export function plan(r, joints) {
  const steps = [{ do: 'hold', seconds: 0.9 }]
  const others = r.poses.filter((p) => p !== r.defaultPose)
  if (others[0]) steps.push({ do: 'pose', name: others[0], seconds: 2.1 })
  const slider = joints.find((j) => j.type !== 'prismatic' && j.upper - j.lower > 0.5) || joints[0]
  if (slider) steps.push({ do: 'slider', joint: slider.name, to: 0.85, seconds: 1.8 }, { do: 'hold', seconds: 0.4 })
  if (others[1]) steps.push({ do: 'pose', name: others[1], seconds: 2.0 })
  if (r.ik && r.leaf) steps.push({ do: 'drag', link: r.leaf, dx: -0.16, dy: -0.12, seconds: 2.0 }, { do: 'hold', seconds: 0.5 })
  if (r.defaultPose) steps.push({ do: 'pose', name: r.defaultPose, seconds: 1.9 })
  steps.push({ do: 'hold', seconds: 0.5 })
  return steps
}

/** Ease for the pretend hand: slow start and end, like a person. */
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

export async function record(dist, name, { out, width = 1280, height = 720, fps = 30, theme = 'light', log = () => {} } = {}) {
  const manifest = readManifest(dist)
  const r = manifest.robots.find((x) => x.name === name)
  if (!r) throw new Error(`no robot "${name}" in ${dist}/robots.json`)
  const ff = findFF()
  const server = await serve(dist, { pages: { '/__record.html': page(r, theme) } })
  const browser = await launchBrowser()
  mkdirSync(dirname(resolve(out)), { recursive: true })
  const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', '-an', resolve(out)], { stdio: ['pipe', 'ignore', 'pipe'] })
  let encErr = ''
  enc.stderr.on('data', (d) => { encErr += d })
  const encoded = new Promise((ok, fail) => enc.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg failed: ${encErr.trim()}`)))))
  let frames = 0
  try {
    const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    const found = await watchPage(p)
    await p.clock.install({ time: 0 })
    await p.goto(server.url + '__record.html')
    await p.evaluate(({ w, h, dark }) => {
      const bg = dark ? 'oklch(15.5% 0.012 255)' : 'oklch(97.2% 0.008 85)'
      document.documentElement.style.background = bg
      document.body.style.margin = '0'
      const v = document.querySelector('robot-viewer')
      v.style.width = `${w}px`
      v.style.height = `${h}px`
      v.style.setProperty('--rv-aspect-wide', `${w} / ${h}`)
      v.style.setProperty('--rv-radius-frame', '0px')
      const ptr = document.querySelector('.pointer')
      Object.assign(ptr.style, { position: 'fixed', left: '0', top: '0', width: '26px', height: '26px', marginLeft: '-13px', marginTop: '-13px', borderRadius: '50%',
        border: '2px solid rgb(255 255 255 / 0.95)', background: 'rgb(240 90 20 / 0.55)', boxShadow: '0 2px 10px rgb(0 0 0 / 0.35)', pointerEvents: 'none', opacity: '0', zIndex: '9', transition: 'none' })
    }, { w: width, h: height, dark: theme === 'dark' })
    for (let i = 0; i < 600; i++) {
      await p.clock.runFor(100)
      const state = await p.evaluate(() => document.querySelector('robot-viewer')._state)
      if (state === 'ready') break
      if (state === 'error' || state === 'still') throw new Error(`the viewer did not load (${state}): ${found.errors.join('; ')}`)
      await new Promise((ok) => setTimeout(ok, 50))
    }
    const info = await p.evaluate(() => ({ joints: document.querySelector('robot-viewer').joints }))
    const steps = plan({ ...r, leaf: r.leaf || null }, info.joints)
    const dt = 1000 / fps
    const pointer = async (x, y, shown, pressed = false) => p.evaluate(({ x, y, shown, pressed }) => {
      const s = document.querySelector('.pointer').style
      s.transform = `translate(${x}px, ${y}px) scale(${pressed ? 0.8 : 1})`
      s.opacity = shown ? '1' : '0'
    }, { x, y, shown, pressed })
    const frame = async () => {
      await p.clock.runFor(dt)
      const png = await p.screenshot({ type: 'png' })
      frames++
      if (!enc.stdin.write(png)) await new Promise((ok) => enc.stdin.once('drain', ok))
    }
    const hold = async (seconds) => { for (let i = 0; i < Math.round(seconds * fps); i++) await frame() }
    /** Move the pretend hand from a to b over `seconds`, pressed or not, calling `each` with the point. */
    const glide = async (a, b, seconds, pressed, each = async () => {}) => {
      const n = Math.max(1, Math.round(seconds * fps))
      for (let i = 1; i <= n; i++) {
        const k = ease(i / n)
        const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k
        await each(x, y)
        await pointer(x, y, true, pressed)
        await frame()
      }
    }
    let hand = { x: width * 0.72, y: height * 0.8 }
    for (const s of steps) {
      log(`record: ${s.do}${s.name ? ` ${s.name}` : s.joint ? ` ${s.joint}` : s.link ? ` ${s.link}` : ''}`)
      if (s.do === 'hold') { await pointer(hand.x, hand.y, false); await hold(s.seconds); continue }
      if (s.do === 'pose') {
        const box = await p.locator('robot-viewer').locator('button.pose', { hasText: s.name }).first().boundingBox()
        const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        await glide(hand, target, 0.45, false, (x, y) => p.mouse.move(x, y))
        hand = target
        await p.mouse.down()
        await pointer(hand.x, hand.y, true, true)
        await frame()
        await p.mouse.up()
        await hold(Math.max(0, s.seconds - 0.5))
        continue
      }
      if (s.do === 'slider') {
        const input = p.locator('robot-viewer').locator('.joint input[type="range"]').nth(info.joints.findIndex((j) => j.name === s.joint))
        const box = await input.boundingBox()
        const v = await input.evaluate((el) => (Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min)))
        const from = { x: box.x + 4 + v * (box.width - 8), y: box.y + box.height / 2 }
        const to = { x: box.x + 4 + s.to * (box.width - 8), y: from.y }
        await glide(hand, from, 0.45, false, (x, y) => p.mouse.move(x, y))
        await p.mouse.down()
        await glide(from, to, s.seconds * 0.6, true, (x, y) => p.mouse.move(x, y))
        await glide(to, { x: from.x + (to.x - from.x) * 0.4, y: from.y }, s.seconds * 0.4, true, (x, y) => p.mouse.move(x, y))
        await p.mouse.up()
        hand = { x: from.x + (to.x - from.x) * 0.4, y: from.y }
        continue
      }
      if (s.do === 'drag') {
        const at = await p.evaluate((link) => document.querySelector('robot-viewer').linkScreenPoint(link, [0, 0, 0.02]), s.link)
        if (!at) continue
        const to = { x: at.x + s.dx * width, y: at.y + s.dy * height }
        await glide(hand, at, 0.5, false, (x, y) => p.mouse.move(x, y))
        await p.mouse.down()
        await glide(at, to, s.seconds * 0.6, true, (x, y) => p.mouse.move(x, y))
        const back = { x: to.x + (at.x - to.x) * 0.5 + width * 0.08, y: to.y + height * 0.06 }
        await glide(to, back, s.seconds * 0.4, true, (x, y) => p.mouse.move(x, y))
        await p.mouse.up()
        hand = back
      }
    }
    const violations = [...found.violations, ...(await p.evaluate(() => window.__rvViolations))]
    if (violations.length) throw new Error(`policy violations during the recording: ${violations.join('; ')}`)
  } finally {
    enc.stdin.end()
    await browser.close()
    await server.close()
  }
  await encoded
  log(`record: ${frames} frames at ${fps} fps -> ${out}`)
  return { frames, seconds: frames / fps }
}
