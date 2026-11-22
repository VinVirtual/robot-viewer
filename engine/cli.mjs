#!/usr/bin/env node
// robot-viewer command line. Run `robot-viewer help` for the list.
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `robot-viewer: turn a URDF robot into one embeddable, self-hosted <robot-viewer> web component.

  robot-viewer check                         Node, packages, browser (for posters and the live check), ffmpeg (for recordings)
  robot-viewer inspect <robot.urdf>          links, joints with limits, meshes and problems   [--package <dir>] [--json]
  robot-viewer build <robot.urdf> --out <dist>
        [--poses poses.json] [--name file-name] [--title "Shown name"] [--alt "text for screen readers"]
        [--license Apache-2.0] [--source "where the model comes from"]
        [--package <dir>] [--simplify 0.5 | --triangles 40000] [--compress meshopt|none] [--clamp] [--no-ik]
        [--ar-glb model.glb] [--ar-usdz model.usdz] [--no-poster] [--poster-pose name] [--orbit "35 18"]
        [--base /robots/] [--verify] [--strict]
                                             GLB + joints JSON + component + demo page + snippet + size report
  robot-viewer poster <dist> <name>          redraw a robot's poster   [--pose name] [--orbit "35 18"]
  robot-viewer verify <dist>                 static CSP check of every page and bundle, then the live check in Chrome
                                             under "Content-Security-Policy: default-src 'self'"   [--static]
  robot-viewer sizes <dist>                  bytes per file, gzip and brotli, against the budgets   [--json] [--strict]
  robot-viewer snippet <dist> [name]         the HTML to paste into a page   [--base /robots/]
  robot-viewer record <dist> <name> --out demo.mp4
                                             a short video of the viewer: poses, a slider drag, a part drag
        [--width 1280] [--height 720] [--fps 30] [--theme light|dark]
  robot-viewer test                          run the unit tests

Poses file: { "units": "deg", "default": "home", "poses": { "home": { "joint": 30 } } }  (sliding joints in metres)
`

function parseArgs(argv) {
  const pos = [], opt = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s)
      if (v !== undefined) opt[k] = v
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]
      else opt[k] = true
    } else pos.push(a)
  }
  return { pos, opt }
}

import { terminalSafe } from './core/text.js'
const say = (s) => process.stdout.write(terminalSafe(s) + '\n')
const fail = (s) => { process.stderr.write(`robot-viewer: ${terminalSafe(s)}\n`); process.exit(1) }
const need = (v, what) => { if (!v || v === true) fail(`missing ${what} (see robot-viewer help)`); return v }
const num = (v, what, lo, hi) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < lo || n > hi) fail(`${what} must be a number from ${lo} to ${hi}`)
  return n
}
const DEG = 180 / Math.PI

async function inspect(file, opt) {
  const { parseUrdf } = await import('./core/urdf.js')
  const { resolveMeshPath } = await import('./lib/paths.js')
  const robot = parseUrdf(readFileSync(file, 'utf8'))
  const meshes = []
  for (const l of robot.links) for (const v of l.visuals) if (v.geometry.type === 'mesh') {
    let status = 'ok'
    try { resolveMeshPath(v.geometry.filename, { urdfDir: dirname(resolve(file)), packageDir: opt.package && resolve(opt.package) }) } catch (e) { status = e.message }
    meshes.push({ link: l.name, file: v.geometry.filename, status })
  }
  if (opt.json) { say(JSON.stringify({ name: robot.name, root: robot.root, links: robot.links.map((l) => l.name), joints: robot.joints, meshes, warnings: robot.warnings }, null, 2)); return }
  say(`${robot.name}: ${robot.links.length} links, ${robot.joints.length} joints, root link "${robot.root}"`)
  say('')
  for (const j of robot.joints) {
    const unit = j.type === 'prismatic' ? (v) => `${+(v).toFixed(4)} m` : (v) => `${+(v * DEG).toFixed(1)}°`
    const range = j.type === 'continuous' ? 'continuous' : j.limit ? `${unit(j.limit.lower)} to ${unit(j.limit.upper)}` : ''
    say(`  ${j.name.padEnd(24)} ${j.type.padEnd(11)} ${range}${j.mimic ? `  (follows ${j.mimic.joint} x ${j.mimic.multiplier}${j.mimic.offset ? ` + ${j.mimic.offset}` : ''})` : ''}`)
  }
  const bad = meshes.filter((m) => m.status !== 'ok')
  say('')
  say(`meshes: ${meshes.length - bad.length} of ${meshes.length} found`)
  for (const m of bad) say(`  ${m.link}: ${m.status}`)
  for (const w of robot.warnings) say(`warning: ${w}`)
}

async function poster(out, name, { pose = null, orbit = null, log = say } = {}) {
  const { readManifest } = await import('./lib/build.js')
  const { renderStills } = await import('./lib/stills.js')
  const { writeSafe } = await import('./lib/files.js')
  const manifest = readManifest(out)
  const r = manifest.robots.find((x) => x.name === name)
  if (!r) fail(`no robot "${name}" in ${out}/robots.json (have: ${manifest.robots.map((x) => x.name).join(', ') || 'none'})`)
  if (pose && !r.poses.includes(pose)) fail(`no pose "${pose}" (have: ${r.poses.join(', ') || 'none'})`)
  await renderStills(out, [{ glb: r.glb, out: join(out, `${name}.poster`), pose: pose || r.defaultPose, orbit: orbit || r.orbit || '35 18', width: 1200, height: 900 }], { log })
  r.poster = `${name}.poster.webp`
  writeSafe(out, 'robots.json', JSON.stringify(manifest, null, 2) + '\n')
}

async function staticCheck(out) {
  const { checkHtml, checkScript, ENGINE_ALLOW } = await import('./core/csp.js')
  const { readdirSync } = await import('node:fs')
  const problems = []
  for (const f of readdirSync(out)) {
    if (f.endsWith('.html')) {
      const r = checkHtml(readFileSync(join(out, f), 'utf8'), f === 'snippet.html' ? { policy: "default-src 'self'" } : {})
      problems.push(...r.problems.map((p) => `${f}: ${p}`))
    }
    if (f.endsWith('.js')) {
      const r = checkScript(readFileSync(join(out, f), 'utf8'), { allow: f === 'robot-viewer-engine.js' ? ENGINE_ALLOW : [] })
      problems.push(...r.problems.map((p) => `${f}: ${p}`))
    }
  }
  return problems
}

async function verify(out, opt) {
  const problems = await staticCheck(out)
  for (const p of problems) say(`CSP: ${p}`)
  say(problems.length ? `static check: ${problems.length} problem(s)` : "static check: every page and script works under default-src 'self'")
  if (opt.static) return problems.length === 0
  const { verifyDist } = await import('./lib/verify.js')
  const r = await verifyDist(out, { screenshot: typeof opt.screenshot === 'string' ? opt.screenshot : null })
  for (const v of r.viewers) say(`viewer ${v.src}: ${v.state}, ${v.joints} joints, poses: ${v.poses.join(', ') || 'none'}`)
  for (const v of r.violations) say(`violation: ${v}`)
  for (const e of r.errors) say(`error: ${e}`)
  say(r.ok ? "live check: loaded in Chrome under Content-Security-Policy: default-src 'self' with no violations or errors" : 'live check: FAILED')
  return r.ok && problems.length === 0
}

async function sizes(out, opt) {
  const { finishDist } = await import('./lib/build.js')
  const { formatSizeReport } = await import('./lib/sizes.js')
  const { report } = finishDist(out, { base: typeof opt.base === 'string' ? opt.base : '' })
  say(opt.json ? JSON.stringify(report, null, 2) : formatSizeReport(report))
  return report
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { pos, opt } = parseArgs(rest)
  switch (cmd) {
    case undefined: case 'help': case '--help': case '-h': say(HELP); return
    case 'check': {
      const r = spawnSync('bash', [join(SKILL, 'check_env.sh')], { stdio: 'inherit' })
      process.exit(r.status ?? 1)
    }
    case 'inspect': return inspect(need(pos[0], 'URDF file'), opt)
    case 'build': {
      const file = need(pos[0], 'URDF file')
      if (!existsSync(file)) fail(`${file} does not exist`)
      const out = need(opt.out, '--out <dist folder>')
      const { buildRobot, finishDist } = await import('./lib/build.js')
      const { formatSizeReport } = await import('./lib/sizes.js')
      if (opt.orbit && !/^\s*-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s*$/.test(opt.orbit)) fail('--orbit must be two numbers: "azimuth elevation" in degrees')
      const r = await buildRobot(file, {
        out, name: typeof opt.name === 'string' ? opt.name : undefined, poses: typeof opt.poses === 'string' ? opt.poses : undefined,
        title: typeof opt.title === 'string' ? opt.title : undefined, alt: typeof opt.alt === 'string' ? opt.alt : undefined,
        packageDir: typeof opt.package === 'string' ? opt.package : undefined,
        simplify: opt.simplify !== undefined ? num(opt.simplify, '--simplify', 0.01, 1) : null,
        triangles: opt.triangles !== undefined ? Math.round(num(opt.triangles, '--triangles', 100, 1e8)) : undefined,
        compress: typeof opt.compress === 'string' ? opt.compress : 'meshopt', clamp: !!opt.clamp, ik: !opt['no-ik'],
        license: typeof opt.license === 'string' ? opt.license : undefined, source: typeof opt.source === 'string' ? opt.source : undefined,
        orbit: typeof opt.orbit === 'string' ? opt.orbit.trim().split(/\s+/).join(' ') : undefined,
        arGlb: typeof opt['ar-glb'] === 'string' ? opt['ar-glb'] : undefined, arUsdz: typeof opt['ar-usdz'] === 'string' ? opt['ar-usdz'] : undefined,
        log: say,
      })
      if (!opt['no-poster']) {
        try { await poster(r.out, r.name, { pose: typeof opt['poster-pose'] === 'string' ? opt['poster-pose'] : null, orbit: opt.orbit }) } catch (e) {
          say(`warning: no poster (${String(e.message).split('\n')[0]}). The viewer works without one; run \`robot-viewer poster ${out} ${r.name}\` once Chrome is available.`)
        }
      }
      const { report, snippets } = finishDist(r.out, { base: typeof opt.base === 'string' ? opt.base : '' })
      say('')
      say(formatSizeReport(report))
      say('')
      say('Paste into your page:')
      say(snippets[snippets.length - 1])
      say('')
      say(`demo page: ${join(r.out, 'index.html')} (serve the folder over http; opening the file directly does not load modules)`)
      let ok = true
      if (opt.verify) ok = await verify(r.out, {})
      if (opt.strict && report.over.length) fail(`over budget: ${report.over.join(', ')}`)
      if (!ok) process.exit(1)
      return
    }
    case 'poster': await poster(need(pos[0], 'dist folder'), need(pos[1], 'robot name'), { pose: opt.pose, orbit: opt.orbit }); await sizes(pos[0], { ...opt, json: false }); return
    case 'verify': if (!(await verify(need(pos[0], 'dist folder'), opt))) process.exit(1); return
    case 'sizes': { const r = await sizes(need(pos[0], 'dist folder'), opt); if (opt.strict && r.over.length) process.exit(1); return }
    case 'snippet': {
      const { readManifest } = await import('./lib/build.js')
      const { snippetFor } = await import('./lib/html.js')
      const m = readManifest(need(pos[0], 'dist folder'))
      const list = pos[1] ? m.robots.filter((r) => r.name === pos[1]) : m.robots
      if (!list.length) fail(`no robot ${pos[1] ? `"${pos[1]}" ` : ''}in ${pos[0]}`)
      say(list.map((r) => snippetFor(r, { base: typeof opt.base === 'string' ? opt.base : '' })).join('\n\n'))
      return
    }
    case 'record': {
      const { record } = await import('./lib/record.js')
      const out = need(opt.out, '--out <file.mp4>')
      await record(need(pos[0], 'dist folder'), need(pos[1], 'robot name'), {
        out, width: opt.width ? num(opt.width, '--width', 320, 3840) : 1280, height: opt.height ? num(opt.height, '--height', 240, 2160) : 720,
        fps: opt.fps ? num(opt.fps, '--fps', 10, 60) : 30, theme: opt.theme === 'dark' ? 'dark' : 'light', log: say,
      })
      return
    }
    case 'test': {
      const tests = join(SKILL, 'tests')
      const files = (await import('node:fs')).readdirSync(tests).filter((f) => f.endsWith('.test.mjs')).map((f) => join(tests, f))
      const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
      process.exit(r.status ?? 1)
    }
    default: fail(`unknown command "${cmd}" (see robot-viewer help)`)
  }
}

main().catch((e) => fail(e && e.message ? e.message : String(e)))
