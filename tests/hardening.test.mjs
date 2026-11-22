// Regression tests for the issues found in review: injection, unsafe lookups, untrusted files and outputs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, symlinkSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { snippetFor, demoHtml } from '../engine/lib/html.js'
import { checkHtml } from '../engine/core/csp.js'
import { terminalSafe } from '../engine/core/text.js'
import { probeEnv, playwrightCandidates } from '../engine/lib/env.js'
import { parseUrdf } from '../engine/core/urdf.js'
import { validatePoses } from '../engine/core/poses.js'
import { checkDescription } from '../engine/core/describe.js'
import { forwardKinematics, indexRobot } from '../engine/core/kinematics.js'
import { stripImages } from '../engine/lib/meshes.js'
import { buildRobot, readManifest, cleanEntry } from '../engine/lib/build.js'
import { buildDocument, jointsDescription, nodeIO, optimise } from '../engine/lib/gltf.js'
import { writeSafe } from '../engine/lib/files.js'
import { licenseText, bundle, FILES } from '../engine/lib/bundle.js'
import { sliderStep, displayUnits } from '../engine/web/panel.js'
import { ROOT, WREN, tempDir, writeFiles } from './helpers.mjs'

const robot = { name: 'x', title: 'T', alt: 'A', glb: 'x.glb', poster: null, ik: true, ar: {}, poses: [], defaultPose: null, stats: { links: 1, joints: 0, moving: 0, triangles: 0 } }
const EVIL = '--><script>alert(1)</script><!--'

test('a robot title cannot break out of the snippet comment or the demo page', () => {
  for (const html of [snippetFor({ ...robot, title: EVIL, alt: EVIL }), demoHtml({ robots: [{ ...robot, title: EVIL, alt: EVIL }] })]) {
    assert.doesNotMatch(html, /<script>alert/)
    assert.deepEqual(checkHtml(html, { policy: "default-src 'self'" }).problems, [])
  }
  assert.match(snippetFor(robot), /^<!-- robot-viewer: load the component once per page -->/)
})

test('terminal control sequences are removed from text printed to the terminal', () => {
  assert.equal(terminalSafe('a\u001b[31mred\u001b[0m b\u001b]0;title\u0007c\u009b2Jd\te\nf'), 'ared bc2Jd\te\nf')
})

test('CLI: names with control characters are printed without them', (t) => {
  const dir = writeFiles(tempDir(t), { 'r.urdf': '<robot name="r&#x9b;2J"><link name="a&#x9b;31m"/></robot>' })
  const r = spawnSync(join(ROOT, 'robot-viewer'), ['inspect', join(dir, 'r.urdf')], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stdout, /\u009b/)
  assert.match(r.stdout, /^r2J: 1 links/)
})

test('tools are not picked up from the current folder', (t) => {
  const dir = tempDir(t)
  const marker = join(dir, 'loaded')
  writeFiles(dir, {
    'node_modules/playwright-core/package.json': '{"name":"playwright-core","main":"index.js"}',
    'node_modules/playwright-core/index.js': `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); module.exports = { chromium: {} }`,
    'imageio_ffmpeg.py': `open(${JSON.stringify(marker)}, 'w').write('x')\ndef get_ffmpeg_exe(): return '/planted/ffmpeg'\n`,
  })
  const script = `const m = await import(${JSON.stringify(join(ROOT, 'engine/lib/env.js'))});
    try { m.findPlaywright() } catch {}
    let ff = ''; try { ff = m.findFF() } catch {}
    console.log(JSON.stringify({ ff, cands: m.playwrightCandidates(process.env, '') }))`
  const env = { ...process.env, NODE_PATH: join(dir, 'node_modules'), PYTHONPATH: dir, ROBOT_VIEWER_PYTHON: 'python3' }
  delete env.PLAYWRIGHT_CORE; delete env.FF
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(existsSync(marker), false, 'a planted file was loaded')
  assert.notEqual(out.ff, '/planted/ffmpeg')
  assert.ok(out.cands.every((c) => !c.startsWith(dir)))
})

test('helper programs run without NODE_PATH or PYTHON* variables, and no personal default paths remain', () => {
  const env = probeEnv({ NODE_PATH: 'x', PYTHONPATH: 'y', PYTHONHOME: 'z', PATH: '/bin' })
  assert.deepEqual(env, { PATH: '/bin' })
  assert.deepEqual(playwrightCandidates({ PLAYWRIGHT_CORE: 'relative/dir' }, '').filter((c) => c === 'relative/dir'), [])
  for (const f of ['engine/lib/env.js', 'check_env.sh', 'README.md', 'SKILL.md']) assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /kokoro|KOKORO/i, f)
})

test('pose lookups use own names only: "toString" and "__proto__" are not poses', () => {
  const wren = parseUrdf(readFileSync(join(WREN, 'wren.urdf'), 'utf8'))
  assert.match(validatePoses({ default: 'toString', poses: { a: {} } }, wren).errors[0], /"default" is "toString"/)
  assert.match(validatePoses({ default: 'constructor', poses: { a: {} } }, wren).errors[0], /"default"/)
  const r = validatePoses({ poses: JSON.parse('{"__proto__": {"shoulder": 10}, "constructor": {}}') }, wren)
  assert.deepEqual(r.order, ['constructor'])
})

const goodDesc = () => jointsDescription(parseUrdf(readFileSync(join(WREN, 'wren.urdf'), 'utf8')), { poses: { home: { shoulder: 0.1 } }, order: ['home'], defaultPose: 'home' })

test('the description read from a GLB is checked and cleaned before use', () => {
  const d = goodDesc()
  d.joints[0].axis = [0, 0, 5]
  const ok = checkDescription(d)
  assert.deepEqual(ok.joints[0].axis, [0, 0, 1])
  assert.deepEqual(checkDescription({ ...goodDesc(), poses: undefined }).poses, {})
  const bad = (change, re) => { const x = goodDesc(); change(x); assert.throws(() => checkDescription(x), re) }
  bad((x) => { x.joints[1].origin.xyz = [0, 'NaN', 0] }, /origin xyz must be three finite numbers/)
  bad((x) => { x.joints[1].axis = [0, 0, 0] }, /zero axis/)
  bad((x) => { x.joints[1].child = x.joints[0].child }, /more than one parent/)
  bad((x) => { x.joints[0].parent = x.joints[0].child; x.joints[1].parent = 'turret' }, /not connected|more than one parent/)
  bad((x) => { x.joints[0].type = 'ball' }, /type "ball"/)
  bad((x) => { x.joints[1].limit = null }, /needs limits/)
  bad((x) => { x.joints[6].mimic.joint = 'nope' }, /mimics a joint that does not exist/)
  bad((x) => { x.format = 'other' }, /not made by robot-viewer/)
  bad((x) => { x.links = Array.from({ length: 2001 }, (_, i) => `l${i}`) }, /more than 2000/)
  const p = goodDesc()
  p.poses.home.shoulder = 'x'
  p.defaultPose = 'toString'
  const c = checkDescription(p)
  assert.deepEqual(c.poses.home, {})
  assert.equal(c.defaultPose, null)
})

test('very large robots and long names are refused; long root lists are shortened', () => {
  assert.throws(() => parseUrdf(`<robot name="x"><link name="${'a'.repeat(201)}"/></robot>`), /longer than 200/)
  assert.throws(() => parseUrdf(`<robot name="x">${Array.from({ length: 2001 }, (_, i) => `<link name="l${i}"/>`).join('')}</robot>`), /more than 2000/)
  const many = `<robot name="x">${Array.from({ length: 30 }, (_, i) => `<link name="l${i}"/>`).join('')}</robot>`
  assert.throws(() => parseUrdf(many), (e) => /and 22 more/.test(e.message) && e.message.length < 200)
})

test('a very deep chain is walked without running out of stack', () => {
  const n = 1900
  const links = Array.from({ length: n + 1 }, (_, i) => `<link name="l${i}"/>`).join('')
  const joints = Array.from({ length: n }, (_, i) => `<joint name="j${i}" type="revolute"><parent link="l${i}"/><child link="l${i + 1}"/><origin xyz="0 0 0.001"/><axis xyz="0 1 0"/><limit lower="-1" upper="1"/></joint>`).join('')
  const r = parseUrdf(`<robot name="deep">${links}${joints}</robot>`)
  const fk = forwardKinematics(r, {}, indexRobot(r))
  assert.ok(Math.abs(fk.links[`l${n}`][14] - n * 0.001) < 1e-9)
  const { doc } = buildDocument(r, { urdfPath: join(WREN, 'wren.urdf') })
  assert.equal(doc.getRoot().listNodes().filter((x) => x.getExtras().rv === 'link').length, n + 1)
})

test('COLLADA image libraries are removed with attributes, namespaces or none', () => {
  const t = '<a/><library_images id="i"><image id="x"><init_from>evil.png</init_from></image></library_images><c:library_images xmlns:c="u"><c:image/></c:library_images><library_images/><b/>'
  assert.equal(stripImages(t), '<a/><b/>')
})

test('output files are never written through a symbolic link, and are replaced whole', (t) => {
  const out = tempDir(t), elsewhere = tempDir(t)
  writeFileSync(join(elsewhere, 'target.txt'), 'keep')
  symlinkSync(join(elsewhere, 'target.txt'), join(out, 'robots.json'))
  assert.throws(() => writeSafe(out, 'robots.json', '{}'), /symbolic link/)
  assert.equal(readFileSync(join(elsewhere, 'target.txt'), 'utf8'), 'keep')
  assert.throws(() => writeSafe(out, '../x.txt', 'a'), /plain file names/)
  writeSafe(out, 'a.txt', 'one')
  writeSafe(out, 'a.txt', 'two')
  assert.equal(readFileSync(join(out, 'a.txt'), 'utf8'), 'two')
  assert.deepEqual(readdirSync(out).filter((f) => f.endsWith('.tmp')), [])
})

test('a build refuses to write through a planted symbolic link', async (t) => {
  const out = tempDir(t), elsewhere = tempDir(t)
  writeFileSync(join(elsewhere, 'victim'), 'keep')
  symlinkSync(join(elsewhere, 'victim'), join(out, 'wren.glb'))
  await assert.rejects(buildRobot(join(WREN, 'wren.urdf'), { out }), /symbolic link/)
  assert.equal(readFileSync(join(elsewhere, 'victim'), 'utf8'), 'keep')
})

test('manifest entries from the output folder are checked field by field', (t) => {
  const out = tempDir(t)
  writeFileSync(join(out, 'robots.json'), JSON.stringify({ robots: [
    { ...robot, name: 'ok', glb: 'ok.glb', poster: '../../etc/passwd', orbit: '1; x', poses: ['home', '<b>'], defaultPose: 'home', ar: { glb: '/abs.glb' } },
    { ...robot, name: '../evil', glb: 'e.glb' },
    { ...robot, name: 'bad', glb: 'x/../y.glb' },
    { ...robot, name: 'ok', glb: 'dup.glb' },
  ] }))
  const m = readManifest(out)
  assert.deepEqual(m.robots.map((r) => r.name), ['ok'])
  const r = m.robots[0]
  assert.equal(r.poster, null)
  assert.equal(r.orbit, null)
  assert.deepEqual(r.poses, ['home'])
  assert.deepEqual(r.ar, {})
  assert.equal(cleanEntry(null), null)
})

test('--license and --source go into the GLB (asset.copyright and the description) and the demo page', async (t) => {
  const out = tempDir(t)
  await buildRobot(join(WREN, 'wren.urdf'), { out, license: 'MIT', source: 'example robot' })
  const doc = await (await nodeIO()).readBinary(readFileSync(join(out, 'wren.glb')))
  assert.equal(doc.getRoot().getAsset().copyright, 'Source: example robot. Licence: MIT')
  assert.equal(JSON.parse(readFileSync(join(out, 'wren.joints.json'), 'utf8')).license, 'MIT')
  assert.match(demoHtml(readManifest(out)), /Model licence<\/dt><dd>MIT/)
  await assert.rejects(buildRobot(join(WREN, 'wren.urdf'), { out, license: 'x'.repeat(101) }), /--license/)
})

test('the full MIT texts of three.js and meshoptimizer are written next to the bundle', async (t) => {
  const out = tempDir(t)
  await bundle(out)
  const text = readFileSync(join(out, FILES.licenses), 'utf8')
  assert.equal(text, licenseText())
  assert.match(text, /three\.js 0\.187\.0[\s\S]*Copyright © 2010-2026 three\.js authors[\s\S]*Permission is hereby granted/)
  assert.match(text, /meshoptimizer 1\.3\.0[\s\S]*Copyright \(c\) 2016-2026 Arseny Kapoulkine[\s\S]*THE SOFTWARE IS PROVIDED "AS IS"/)
  assert.match(readFileSync(join(out, FILES.engine), 'utf8'), /robot-viewer-licenses\.txt/)
})

test('slider steps suit the range: fine for short slides, at most half a degree for rotation', () => {
  const rev = (lo, hi) => ({ type: 'revolute', limit: { lower: lo, upper: hi } })
  const pri = (hi) => ({ type: 'prismatic', limit: { lower: 0, upper: hi } })
  assert.equal(sliderStep(rev(-3, 3)), 0.5)
  assert.equal(sliderStep(rev(-0.1, 0.1)), 0.05)
  assert.equal(sliderStep(pri(0.002)), 0.005)
  assert.equal(sliderStep(pri(2)), 5)
  assert.equal(sliderStep({ type: 'continuous' }), 0.5)
  assert.equal(sliderStep(pri(0)), 0.1)
  assert.ok(displayUnits(pri(0.002)).digits >= 2)
})

test('SKILL.md description fits the 1024-character limit', () => {
  const m = /^---\nname: robot-viewer\ndescription: (.+)\n---/m.exec(readFileSync(join(ROOT, 'SKILL.md'), 'utf8'))
  assert.ok(m, 'frontmatter')
  assert.ok(m[1].length <= 1024, `${m[1].length} characters`)
})

test('the committed example uses the current bundle, and passes the static check', async (t) => {
  const out = tempDir(t)
  await bundle(out)
  const dist = join(ROOT, 'examples', 'dist')
  for (const f of Object.values(FILES)) assert.ok(readFileSync(join(out, f)).equals(readFileSync(join(dist, f))), `${f} is out of date: run examples/build.sh`)
  const r = spawnSync(join(ROOT, 'robot-viewer'), ['verify', dist, '--static'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})
