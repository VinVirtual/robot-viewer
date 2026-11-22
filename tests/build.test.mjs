// The whole build without a browser: dist/ contents, demo page, snippet, manifest, size report and budgets.
import { test, after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { buildRobot, finishDist, safeName, grabLink, readManifest } from '../engine/lib/build.js'
import { checkHtml, checkScript, ENGINE_ALLOW } from '../engine/core/csp.js'
import { bundle, FILES } from '../engine/lib/bundle.js'
import { BUDGETS, budgetFor, sizeReport, formatSizeReport } from '../engine/lib/sizes.js'
import { parseUrdf } from '../engine/core/urdf.js'
import { ROOT, WREN, SO100, tempDir } from './helpers.mjs'

const CLI = join(ROOT, 'robot-viewer')
const run = (args) => spawnSync(CLI, args, { encoding: 'utf8' })

const SHARED = mkdtempSync(join(tmpdir(), 'robot-viewer-test-'))
after(() => rmSync(SHARED, { recursive: true, force: true }))
let shared = null
async function wrenDist() {
  if (shared) return shared
  const out = SHARED
  await buildRobot(join(WREN, 'wren.urdf'), { out, poses: join(WREN, 'poses.json'), title: 'Wren' })
  const fin = finishDist(out)
  shared = { out, ...fin }
  return shared
}

test('build writes the GLB, joints JSON, component, demo page, snippet and size report', async (t) => {
  const { out } = await wrenDist(t)
  for (const f of ['wren.glb', 'wren.joints.json', FILES.entry, FILES.engine, FILES.css, 'index.html', 'demo.css', 'demo.js', 'snippet.html', 'size-report.json', 'size-report.txt', 'robots.json']) {
    assert.ok(existsSync(join(out, f)), f)
  }
  const joints = JSON.parse(readFileSync(join(out, 'wren.joints.json'), 'utf8'))
  assert.equal(joints.glb, 'wren.glb')
  assert.deepEqual(Object.keys(joints.poses), ['home', 'reach', 'wave', 'inspect'])
  assert.equal(joints.defaultPose, 'home')
})

test('every generated page and script passes the CSP check for default-src self', async (t) => {
  const { out } = await wrenDist(t)
  for (const f of readdirSync(out)) {
    if (f.endsWith('.html')) assert.deepEqual(checkHtml(readFileSync(join(out, f), 'utf8'), { policy: "default-src 'self'" }).problems, [], f)
    if (f.endsWith('.js')) assert.deepEqual(checkScript(readFileSync(join(out, f), 'utf8'), { allow: f === FILES.engine ? ENGINE_ALLOW : [] }).problems, [], f)
  }
})

test('the loader stays tiny and imports the engine only when needed', async (t) => {
  const { out } = await wrenDist(t)
  const entry = readFileSync(join(out, FILES.entry), 'utf8')
  assert.match(entry, /robot-viewer-engine\.js/)
  assert.doesNotMatch(entry, /WebGLRenderer/, 'three.js must not be in the first file')
  assert.match(entry, /IntersectionObserver/)
  assert.match(entry, /prefers-reduced-motion/)
})

test('bundle size budget: loader under 10 KB and engine under 200 KB gzipped', async (t) => {
  const { out, report } = await wrenDist(t)
  const gz = (f) => gzipSync(readFileSync(join(out, f)), { level: 9 }).length
  assert.ok(gz(FILES.entry) < 10 * 1024, `loader ${gz(FILES.entry)} bytes`)
  assert.ok(gz(FILES.engine) < 200 * 1024, `engine ${gz(FILES.engine)} bytes`)
  assert.deepEqual(report.over, [])
})

test('size report lists bytes, gzip and brotli for every file, with budgets', async (t) => {
  const { out } = await wrenDist(t)
  const report = JSON.parse(readFileSync(join(out, 'size-report.json'), 'utf8'))
  const glb = report.files.find((f) => f.file === 'wren.glb')
  assert.ok(glb.bytes > 1000 && glb.gzip > 0 && glb.brotli > 0)
  assert.equal(glb.budget.kind, 'bytes')
  assert.equal(report.files.find((f) => f.file === FILES.engine).budget.kind, 'gzip')
  const text = readFileSync(join(out, 'size-report.txt'), 'utf8')
  assert.match(text, /first load \(loader only, gzipped\)/)
})

test('a file over budget is flagged', (t) => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'robot-viewer.js'), Buffer.from(Array.from({ length: 64 * 1024 }, () => Math.floor(Math.random() * 256))))
  const r = sizeReport(dir, ['robot-viewer.js'])
  assert.deepEqual(r.over, ['robot-viewer.js'])
  assert.match(formatSizeReport(r), /OVER/)
  assert.equal(budgetFor('x.glb'), BUDGETS.find((b) => b.match.test('x.glb')))
  assert.equal(budgetFor('notes.txt'), null)
})

test('snippet has one module script and the element with the right attributes', async (t) => {
  const { out } = await wrenDist(t)
  const s = readFileSync(join(out, 'snippet.html'), 'utf8')
  assert.match(s, /<script type="module" src="robot-viewer\.js"><\/script>/)
  assert.match(s, /<robot-viewer src="wren\.glb" alt="[^"]+" pose="home" ik><\/robot-viewer>/)
})

test('a second robot joins the same dist; rebuilding one replaces it', async (t) => {
  const out = tempDir(t)
  await buildRobot(join(WREN, 'wren.urdf'), { out })
  await buildRobot(join(SO100, 'so100.urdf'), { out, name: 'so100', poses: join(SO100, 'poses.json') })
  await buildRobot(join(WREN, 'wren.urdf'), { out, title: 'Wren again' })
  const m = readManifest(out)
  assert.deepEqual(m.robots.map((r) => r.name), ['so100', 'wren'])
  assert.equal(m.robots[1].title, 'Wren again')
  const { manifest } = finishDist(out)
  const html = readFileSync(join(out, 'index.html'), 'utf8')
  assert.equal((html.match(/<robot-viewer /g) || []).length, manifest.robots.length)
})

test('bad poses stop the build and list every problem', async (t) => {
  const out = tempDir(t)
  const poses = join(out, 'p.json')
  writeFileSync(poses, JSON.stringify({ poses: { a: { shoulder: 500, nope: 1 } } }))
  await assert.rejects(buildRobot(join(WREN, 'wren.urdf'), { out, poses }), /2 problem\(s\):[\s\S]*outside its limits[\s\S]*no joint "nope"/)
  writeFileSync(poses, '{ not json')
  await assert.rejects(buildRobot(join(WREN, 'wren.urdf'), { out, poses }), /not valid JSON/)
})

test('AR files are copied next to the model and named in the snippet', async (t) => {
  const out = tempDir(t)
  const src = tempDir(t)
  writeFileSync(join(src, 'w.glb'), 'glTF')
  writeFileSync(join(src, 'w.usdz'), 'PK')
  await buildRobot(join(WREN, 'wren.urdf'), { out, arGlb: join(src, 'w.glb'), arUsdz: join(src, 'w.usdz') })
  const { snippets } = finishDist(out)
  assert.ok(existsSync(join(out, 'wren.ar.glb')) && existsSync(join(out, 'wren.ar.usdz')))
  assert.match(snippets[0], /ar-glb="wren\.ar\.glb" ar-usdz="wren\.ar\.usdz"/)
  await assert.rejects(buildRobot(join(WREN, 'wren.urdf'), { out, arUsdz: join(src, 'w.glb') }), /must be a \.usdz file/)
})

test('names: safe file names from robot names, and bad --name values are refused', async (t) => {
  assert.equal(safeName('SO ARM/100!'), 'so-arm-100')
  assert.equal(safeName('***'), 'robot')
  await assert.rejects(buildRobot(join(WREN, 'wren.urdf'), { out: tempDir(t), name: '../evil' }), /--name/)
})

test('the part to grab is the hand, not a finger', () => {
  assert.equal(grabLink(parseUrdf(readFileSync(join(WREN, 'wren.urdf'), 'utf8'))), 'hand')
  assert.equal(grabLink(parseUrdf(readFileSync(join(SO100, 'so100.urdf'), 'utf8'))), 'gripper')
})

test('bundling twice gives the same bytes (reproducible output)', async (t) => {
  const a = tempDir(t), b = tempDir(t)
  await bundle(a)
  await bundle(b)
  for (const f of Object.values(FILES)) assert.ok(readFileSync(join(a, f)).equals(readFileSync(join(b, f))), f)
})

test('CLI: inspect prints joints with limits in degrees and finds every mesh', () => {
  const r = run(['inspect', join(WREN, 'wren.urdf')])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /wren: 9 links, 8 joints/)
  assert.match(r.stdout, /elbow\s+revolute\s+-145° to 145°/)
  assert.match(r.stdout, /gripper_mirror\s+prismatic\s+0 m to 0\.026 m\s+\(follows gripper x 1\)/)
  assert.match(r.stdout, /meshes: 4 of 4 found/)
  const j = JSON.parse(run(['inspect', join(WREN, 'wren.urdf'), '--json']).stdout)
  assert.equal(j.joints.length, 8)
})

test('CLI: build without a poster, then verify --static and sizes', (t) => {
  const out = tempDir(t)
  const b = run(['build', join(WREN, 'wren.urdf'), '--out', out, '--poses', join(WREN, 'poses.json'), '--no-poster', '--base', '/robots/'])
  assert.equal(b.status, 0, b.stderr)
  assert.match(b.stdout, /Paste into your page:\n<!-- wren: load the component once per page -->\n<script type="module" src="\/robots\/robot-viewer\.js">/)
  const v = run(['verify', out, '--static'])
  assert.equal(v.status, 0, v.stdout + v.stderr)
  assert.match(v.stdout, /every page and script works under default-src 'self'/)
  const s = run(['sizes', out, '--json', '--strict'])
  assert.equal(s.status, 0)
  assert.ok(JSON.parse(s.stdout).files.length >= 8)
})

test('CLI: clear errors for missing input, bad options and unknown commands', (t) => {
  assert.match(run(['build']).stderr, /missing URDF file/)
  assert.match(run(['build', join(WREN, 'wren.urdf')]).stderr, /missing --out/)
  assert.match(run(['build', join(WREN, 'wren.urdf'), '--out', tempDir(t), '--simplify', '7']).stderr, /--simplify must be a number from 0.01 to 1/)
  assert.match(run(['build', join(WREN, 'wren.urdf'), '--out', tempDir(t), '--orbit', 'left']).stderr, /--orbit must be two numbers/)
  assert.match(run(['frobnicate']).stderr, /unknown command "frobnicate"/)
  assert.match(run(['inspect', join(ROOT, 'package.json')]).stderr, /not well-formed XML|root element/)
  assert.equal(run(['help']).status, 0)
})
