// URDF + meshes -> GLB: node tree, joints description, compression, and that the browser's decoder can read it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { parseUrdf } from '../engine/core/urdf.js'
import { buildDocument, optimise, nodeIO, jointsDescription, countTriangles, FORMAT, srgbToLinear } from '../engine/lib/gltf.js'
import { loadMeshFile, primitiveParts } from '../engine/lib/meshes.js'
import { MeshoptDecoder as ReferenceDecoder } from '../node_modules/meshoptimizer/meshopt_decoder_reference.js'
import { WREN, tempDir, writeFiles } from './helpers.mjs'

const wrenPath = join(WREN, 'wren.urdf')
const wren = parseUrdf(readFileSync(wrenPath, 'utf8'))

async function wrenGlb() {
  const { doc, root } = buildDocument(wren, { urdfPath: wrenPath })
  root.setExtras({ rv: 'robot', robotViewer: jointsDescription(wren, { glb: 'wren.glb' }) })
  await optimise(doc)
  return (await nodeIO()).writeBinary(doc)
}
let cached = null
const glb = () => (cached ||= wrenGlb())

test('reads all three mesh formats into triangles in the link frame', () => {
  for (const f of ['base.dae', 'shoulder.obj', 'upper_arm.stl', 'forearm.stl']) {
    const { parts } = loadMeshFile(join(WREN, 'meshes', f))
    assert.ok(parts.length >= 1, f)
    assert.ok(parts[0].positions.length > 100, f)
  }
})

test('COLLADA: Z_UP file keeps its Z-up coordinates and its material colour (as linear light)', () => {
  const { parts } = loadMeshFile(join(WREN, 'meshes', 'base.dae'))
  let zmax = -Infinity, ymax = -Infinity
  for (let i = 0; i < parts[0].positions.length; i += 3) { ymax = Math.max(ymax, parts[0].positions[i + 1]); zmax = Math.max(zmax, parts[0].positions[i + 2]) }
  assert.ok(Math.abs(zmax - 0.042) < 1e-4, `top of the base at z=${zmax}`)
  assert.ok(Math.abs(ymax - 0.098) < 1e-3)
  const expected = [0.16, 0.17, 0.19].map(srgbToLinear)
  parts[0].color.slice(0, 3).forEach((c, i) => assert.ok(Math.abs(c - expected[i]) < 1e-3, `${c} vs ${expected[i]}`))
})

test('broken mesh files give readable errors', (t) => {
  const dir = writeFiles(tempDir(t), { 'bad.stl': 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 nope\nendloop\nendfacet\nendsolid\n', 'empty.obj': '# nothing\n', 'evil.dae': '<?xml version="1.0"?><!DOCTYPE c [<!ENTITY x SYSTEM "file:///etc/passwd">]><COLLADA>&x;</COLLADA>' })
  assert.throws(() => loadMeshFile(join(dir, 'bad.stl')), /bad\.stl/)
  assert.throws(() => loadMeshFile(join(dir, 'empty.obj')), /has no faces/)
  assert.throws(() => loadMeshFile(join(dir, 'evil.dae')), /refused for safety/)
})

test('URDF colours (sRGB) become linear glTF colour factors', async () => {
  const doc = await (await nodeIO()).readBinary(await glb())
  const factors = doc.getRoot().listMaterials().map((m) => m.getBaseColorFactor().map((v) => +v.toFixed(4)))
  const chalk = [0.86, 0.85, 0.82].map((v) => +srgbToLinear(v).toFixed(4))
  assert.ok(factors.some((f) => f[0] === chalk[0] && f[1] === chalk[1] && f[2] === chalk[2]), JSON.stringify(factors))
  assert.equal(+srgbToLinear(1).toFixed(6), 1)
  assert.equal(srgbToLinear(0), 0)
})

test('URDF primitives: cylinders run along Z, boxes keep their size', () => {
  const [cyl] = primitiveParts({ type: 'cylinder', radius: 0.1, length: 2 })
  let zmax = 0
  for (let i = 2; i < cyl.positions.length; i += 3) zmax = Math.max(zmax, cyl.positions[i])
  assert.ok(Math.abs(zmax - 1) < 1e-6)
  const [box] = primitiveParts({ type: 'box', size: [1, 2, 3] })
  assert.equal(Math.max(...box.positions.filter((_, i) => i % 3 === 1)), 1)
})

test('the GLB keeps the link and joint tree, marked for the viewer', async () => {
  const doc = await (await nodeIO()).readBinary(await glb())
  const nodes = doc.getRoot().listNodes()
  const marked = (kind) => nodes.filter((n) => n.getExtras().rv === kind).map((n) => n.getExtras().name).sort()
  assert.deepEqual(marked('link'), wren.links.map((l) => l.name).sort())
  assert.deepEqual(marked('joint'), wren.joints.map((j) => j.name).sort())
  // every joint node holds its child link directly, so moving the link node moves the joint
  for (const n of nodes.filter((x) => x.getExtras().rv === 'joint')) {
    const j = wren.joints.find((x) => x.name === n.getExtras().name)
    assert.ok(n.listChildren().some((c) => c.getExtras().rv === 'link' && c.getExtras().name === j.child), j.name)
    assert.deepEqual(n.getTranslation().map((v) => +v.toFixed(6)), j.origin.xyz)
  }
  const root = nodes.find((n) => n.getExtras().rv === 'robot')
  assert.deepEqual(root.getRotation().map((v) => +v.toFixed(6)), [-0.707107, 0, 0, 0.707107])
})

test('the joints description inside the GLB matches the URDF', async () => {
  const doc = await (await nodeIO()).readBinary(await glb())
  const d = doc.getRoot().listNodes().find((n) => n.getExtras().rv === 'robot').getExtras().robotViewer
  assert.equal(d.format, FORMAT)
  assert.equal(d.root, 'base')
  const elbow = d.joints.find((j) => j.name === 'elbow')
  assert.deepEqual([elbow.limit.lower, elbow.limit.upper], [-2.53, 2.53])
  assert.deepEqual(d.joints.find((j) => j.name === 'gripper_mirror').mimic, { joint: 'gripper', multiplier: 1, offset: 0 })
})

test('meshes are meshopt-compressed and quantized, with no textures (so no blob: URLs are needed)', async () => {
  const doc = await (await nodeIO()).readBinary(await glb())
  const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)
  assert.ok(used.includes('EXT_meshopt_compression'))
  assert.ok(used.includes('KHR_mesh_quantization'))
  assert.equal(doc.getRoot().listTextures().length, 0)
  assert.equal(countTriangles(doc), 6860)
})

test('the pure-JavaScript decoder the browser uses reads the GLB (no WebAssembly)', async () => {
  const buf = await glb()
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const gltf = await new GLTFLoader().setMeshoptDecoder(ReferenceDecoder).parseAsync(ab, '')
  let meshes = 0, links = 0, root = null
  gltf.scene.traverse((o) => { if (o.isMesh) meshes++; if (o.userData.rv === 'link') links++; if (o.userData.rv === 'robot') root = o })
  assert.equal(links, wren.links.length)
  assert.equal(meshes, 14)
  assert.equal(root.userData.robotViewer.robot, 'wren')
})

test('compression can be turned off, and an unknown method is refused', async () => {
  const a = buildDocument(wren, { urdfPath: wrenPath }).doc
  await optimise(a, { compress: 'none' })
  assert.ok(!a.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression'))
  await assert.rejects(optimise(buildDocument(wren, { urdfPath: wrenPath }).doc, { compress: 'draco' }), /unknown compression "draco"/)
})

test('missing and refused meshes are skipped with a warning, not a crash', (t) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'm'))
  copyFileSync(join(WREN, 'meshes', 'upper_arm.stl'), join(dir, 'm', 'ok.stl'))
  const urdf = `<robot name="w"><link name="a">
    <visual><geometry><mesh filename="m/ok.stl"/></geometry></visual>
    <visual><geometry><mesh filename="m/gone.stl"/></geometry></visual>
    <visual><geometry><mesh filename="/etc/hosts.stl"/></geometry></visual></link></robot>`
  writeFileSync(join(dir, 'w.urdf'), urdf)
  const r = buildDocument(parseUrdf(urdf), { urdfPath: join(dir, 'w.urdf') })
  assert.equal(r.stats.missingVisuals, 2)
  assert.equal(r.warnings.length, 2)
  assert.ok(r.warnings.some((w) => /absolute path/.test(w)))
})
