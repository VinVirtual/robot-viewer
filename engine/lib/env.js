// Where robot-viewer finds its optional tools: Playwright with a browser (posters, recordings, the live CSP check)
// and ffmpeg (recordings). Each has an environment variable that overrides the search.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve, dirname, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)

/** Environment for helper programs: no NODE_PATH, so nothing is picked up from wherever the user happens to be. */
export function probeEnv(env = process.env) {
  const { NODE_PATH, PYTHONPATH, PYTHONHOME, PYTHONSTARTUP, ...rest } = env
  return rest
}
// probes run from the temp folder, never the current folder, so files planted there cannot be loaded
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', cwd: tmpdir(), env: probeEnv(), stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const onPath = (name) => { try { return run('which', [name]).split('\n')[0] || null } catch { return null } }

/** Folders that may hold playwright-core, in order: $PLAYWRIGHT_CORE, this skill's own node_modules, the global npm folder.
    The current folder is never searched. */
export function playwrightCandidates(env = process.env, globalRoot = null) {
  let root = globalRoot
  if (root === null) { try { root = run('npm', ['root', '-g']) } catch { root = '' } }
  return [env.PLAYWRIGHT_CORE && isAbsolute(env.PLAYWRIGHT_CORE) ? env.PLAYWRIGHT_CORE : null,
    join(SKILL, 'node_modules', 'playwright-core'), join(SKILL, 'node_modules', 'playwright'),
    root && join(root, 'playwright-core'), root && join(root, 'playwright'), root && join(root, '@playwright/cli/node_modules/playwright-core'),
    root && join(root, '@playwright/test/node_modules/playwright-core')].filter(Boolean)
}

/** Playwright's chromium launcher. */
export function findPlaywright() {
  for (const c of playwrightCandidates()) {
    if (!existsSync(c)) continue
    try { return { chromium: require(c).chromium, from: c } } catch {}
  }
  throw new Error('Playwright not found. Run `npm i -g playwright-core`, or set PLAYWRIGHT_CORE to the absolute path of playwright-core')
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

/** ffmpeg: $FF, ffmpeg on the PATH, or the binary inside the imageio-ffmpeg package of $ROBOT_VIEWER_PYTHON or python3.
    Python runs isolated (-I): the current folder and PYTHON* variables are ignored. */
export function findFF() {
  if (process.env.FF) return process.env.FF
  const sys = onPath('ffmpeg')
  if (sys) return sys
  const pythons = [process.env.ROBOT_VIEWER_PYTHON, onPath('python3')].filter(Boolean)
  for (const py of pythons) {
    try { return run(py, ['-I', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']) } catch {}
  }
  throw new Error('ffmpeg not found. Install ffmpeg, or `pip install imageio-ffmpeg`, or set FF=/path/to/ffmpeg (or ROBOT_VIEWER_PYTHON to a Python that has imageio-ffmpeg)')
}
