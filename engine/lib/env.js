// Where robot-viewer finds its optional tools: Playwright with a browser (posters, recordings, the live CSP check)
// and ffmpeg (recordings). Each has an environment variable that overrides the search.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const onPath = (name) => { try { return run('which', [name]).split('\n')[0] || null } catch { return null } }

/** Playwright's chromium launcher: $PLAYWRIGHT_CORE, a local copy, or a global one. */
export function findPlaywright() {
  let root = ''
  try { root = run('npm', ['root', '-g']) } catch {}
  const cands = [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'playwright', join(process.cwd(), 'node_modules', 'playwright-core'),
    root && join(root, 'playwright-core'), root && join(root, 'playwright'), root && join(root, '@playwright/cli/node_modules/playwright-core'),
    root && join(root, '@playwright/test/node_modules/playwright-core')].filter(Boolean)
  for (const c of cands) { try { return { chromium: require(c).chromium, from: c } } catch {} }
  throw new Error('Playwright not found. Run `npm i -g playwright-core`, or set PLAYWRIGHT_CORE=/path/to/playwright-core')
}

/** WebGL must work without a graphics card: these let Chrome use its software renderer. */
export const BROWSER_ARGS = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl', '--enable-webgl']

export async function launchBrowser() {
  const { chromium } = findPlaywright()
  const tries = []
  if (process.env.ROBOT_VIEWER_CHROME) tries.push({ executablePath: process.env.ROBOT_VIEWER_CHROME })
  for (const p of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(onPath).filter(Boolean)) tries.push({ executablePath: p })
  tries.push({})
  const errors = []
  for (const opts of tries) {
    try { return await chromium.launch({ ...opts, args: BROWSER_ARGS, timeout: 60000 }) } catch (e) { errors.push(`${opts.executablePath || "Playwright's Chromium"}: ${String(e.message).split('\n')[0]}`) }
  }
  throw new Error(`No browser could be started:\n  - ${errors.join('\n  - ')}\nInstall Google Chrome or Chromium, or run \`npx playwright-core install chromium\`, or set ROBOT_VIEWER_CHROME.`)
}

/** ffmpeg: $FF, ffmpeg on PATH, or the binary inside the imageio-ffmpeg Python package. */
export function findFF() {
  if (process.env.FF) return process.env.FF
  const sys = onPath('ffmpeg')
  if (sys) return sys
  const pythons = [process.env.ROBOT_VIEWER_PYTHON, join(process.env.KOKORO_HOME || join(process.env.HOME || '', 'kokoro'), '.venv', 'bin', 'python'), onPath('python3')].filter(Boolean)
  for (const py of pythons) {
    if (!existsSync(py)) continue
    try { return run(py, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']) } catch {}
  }
  throw new Error('ffmpeg not found. Install ffmpeg, or `pip install imageio-ffmpeg`, or set FF=/path/to/ffmpeg')
}
