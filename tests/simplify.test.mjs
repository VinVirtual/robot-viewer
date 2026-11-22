// Simplifying CAD-style meshes: unwelded triangles with one normal per face, as STL exports have.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TorusKnotGeometry } from 'three'
import { Document } from '@gltf-transform/core'
import { simplifyDocument, countTriangles, creaseNormals } from '../engine/lib/simplify.js'
import { buildRobot } from '../engine/lib/build.js'
import { nodeIO } from '../engine/lib/gltf.js'
import { tempDir } from './helpers.mjs'

/** A dense shape as an STL would store it: every triangle has its own 3 vertices and its face normal. */
function cadTriangles() {
  const g = new TorusKnotGeometry(0.1, 0.03, 300, 40).toNonIndexed()
  const p = g.getAttribute('position').array
  const n = new Float32Array(p.length)
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2]
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2]
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1
    for (let k = 0; k < 3; k++) n.set([x / l, y / l, z / l], i + k * 3)
  }
  return { positions: Float32Array.from(p), normals: n }
}

function cadDocument() {
  const doc = new Document()
  const buf = doc.createBuffer()
  const { positions, normals } = cadTriangles()
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buf))
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)))
  return doc
}

function binaryStl(file) {
  const { positions, normals } = cadTriangles()
  const tris = positions.length / 9
  const b = Buffer.alloc(84 + tris * 50)
  b.writeUInt32LE(tris, 80)
  for (let t = 0; t < tris; t++) {
    const o = 84 + t * 50
    for (let d = 0; d < 3; d++) b.writeFloatLE(normals[t * 9 + d], o + d * 4)
    for (let k = 0; k < 9; k++) b.writeFloatLE(positions[t * 9 + k], o + 12 + k * 4)
  }
  writeFileSync(file, b)
}

test('an unwelded CAD-style mesh reduces to the target triangle count', async () => {
  const doc = cadDocument()
  const before = countTriangles(doc)
  assert.equal(before, 24000)
  const r = await simplifyDocument(doc, { ratio: 0.1 })
  assert.equal(r.before, 24000)
  assert.ok(r.after <= 2400 * 1.05 && r.after >= 2400 * 0.7, `${r.after} triangles, target 2400`)
  const p = doc.getRoot().listMeshes()[0].listPrimitives()[0]
  assert.ok(p.getAttribute('NORMAL'), 'normals are rebuilt')
  assert.equal(p.getAttribute('NORMAL').getCount(), p.getAttribute('POSITION').getCount())
})

test('the error bound grows only as far as needed, and stays within the limit', async () => {
  const gentle = await simplifyDocument(cadDocument(), { ratio: 0.5 })
  const hard = await simplifyDocument(cadDocument(), { ratio: 0.02 })
  assert.ok(gentle.error <= hard.error)
  assert.ok(hard.error <= 0.015)
  const capped = await simplifyDocument(cadDocument(), { ratio: 0.001, maxError: 0.001 })
  assert.ok(capped.error <= 0.001 && capped.after > 24, 'a tight limit stops before the shape is destroyed')
})

test('normals stay sharp at creases and smooth across gentle curves', () => {
  // a cube corner: 3 faces at right angles share vertex 0
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2])
  const sharp = creaseNormals(positions, indices, 35)
  assert.equal(sharp.positions.length / 3, 9, 'every corner keeps its own face normal at a 90 degree crease')
  const smooth = creaseNormals(positions, indices, 100)
  const n0 = [...smooth.normals.slice(0, 3)].map((v) => +v.toFixed(3))
  assert.deepEqual(n0, [-0.577, -0.577, -0.577])
})

test('build --triangles turns a dense STL link into a GLB near the budget', async (t) => {
  const dir = tempDir(t)
  binaryStl(join(dir, 'knot.stl'))
  writeFileSync(join(dir, 'r.urdf'), '<robot name="cad"><link name="a"><visual><geometry><mesh filename="knot.stl"/></geometry></visual></link></robot>')
  const logs = []
  await buildRobot(join(dir, 'r.urdf'), { out: join(dir, 'out'), triangles: 3000, log: (s) => logs.push(s) })
  const doc = await (await nodeIO()).readBinary(readFileSync(join(dir, 'out', 'cad.glb')))
  const n = countTriangles(doc)
  assert.ok(n <= 3000 * 1.05 && n >= 3000 * 0.7, `${n} triangles`)
  assert.ok(logs.some((l) => /simplified: 24000 -> \d+ triangles \(target 3000/.test(l)), logs.join('\n'))
  await assert.rejects(buildRobot(join(dir, 'r.urdf'), { out: join(dir, 'out'), triangles: 5 }), /--triangles/)
})
