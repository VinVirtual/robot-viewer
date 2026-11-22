// Mesh simplification that works on CAD exports.
// Why plain simplify() barely helps: STL and many CAD meshes store one normal per face, so welding (which merges
// only identical vertices) leaves every triangle with its own three vertices. The simplifier can only collapse
// edges between shared vertices, so it has nothing to work with, and a tight error bound stops it early anyway.
// So: drop the normals, weld by position, simplify towards a triangle budget while allowing a little more surface
// error each round, then rebuild normals that stay sharp at creases (CAD edges) and smooth elsewhere.
import { weld, dedup, simplify } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'

export const ERROR_STEPS = [0.0005, 0.001, 0.002, 0.004, 0.008, 0.015]

export function countTriangles(doc) {
  let n = 0
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    if (p.getMode() !== 4) continue
    const idx = p.getIndices()
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3
  }
  return Math.round(n)
}

/** Normals per corner: the average of the faces around the vertex that bend less than `creaseDeg` from this face.
    Returns a new indexed primitive layout { positions, normals, indices } with corners merged where they agree. */
export function creaseNormals(positions, indices, creaseDeg = 35) {
  const tris = indices.length / 3
  const fn = new Float64Array(tris * 3)
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = [indices[t * 3] * 3, indices[t * 3 + 1] * 3, indices[t * 3 + 2] * 3]
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    // area-weighted: bigger faces count more
    fn[t * 3] = uy * vz - uz * vy; fn[t * 3 + 1] = uz * vx - ux * vz; fn[t * 3 + 2] = ux * vy - uy * vx
  }
  const unit = (t) => { const x = fn[t * 3], y = fn[t * 3 + 1], z = fn[t * 3 + 2], l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l] }
  const facesOf = new Map()
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) {
    const v = indices[t * 3 + k]
    let list = facesOf.get(v)
    if (!list) facesOf.set(v, (list = []))
    list.push(t)
  }
  const cos = Math.cos((creaseDeg * Math.PI) / 180)
  const outPos = [], outNor = [], outIdx = new Uint32Array(indices.length)
  const key = new Map()
  for (let t = 0; t < tris; t++) {
    const nt = unit(t)
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]
      let x = 0, y = 0, z = 0
      for (const f of facesOf.get(v)) {
        const nf = unit(f)
        if (nf[0] * nt[0] + nf[1] * nt[1] + nf[2] * nt[2] >= cos) { x += fn[f * 3]; y += fn[f * 3 + 1]; z += fn[f * 3 + 2] }
      }
      const l = Math.hypot(x, y, z) || 1
      const n = [x / l, y / l, z / l]
      // corners of one vertex with (almost) the same normal become one output vertex
      const id = `${v}|${Math.round(n[0] * 1000)}|${Math.round(n[1] * 1000)}|${Math.round(n[2] * 1000)}`
      let out = key.get(id)
      if (out === undefined) {
        out = outPos.length / 3
        key.set(id, out)
        outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
        outNor.push(n[0], n[1], n[2])
      }
      outIdx[t * 3 + k] = out
    }
  }
  return { positions: new Float32Array(outPos), normals: new Float32Array(outNor), indices: outIdx }
}

/**
 * Simplify every triangle mesh towards `ratio` of its triangles.
 * @returns {Promise<{ before: number, after: number, error: number }>} triangle counts and the error bound used
 */
export async function simplifyDocument(doc, { ratio, maxError = 0.015, creaseDeg = 35 }) {
  if (!(ratio > 0 && ratio < 1)) throw new Error('simplify ratio must be between 0 and 1')
  await MeshoptSimplifier.ready
  const before = countTriangles(doc)
  const target = Math.max(1, Math.round(before * ratio))
  // 1. positions only, so faces that touch share vertices
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    p.setAttribute('NORMAL', null)
  }
  await doc.transform(dedup(), weld())
  // 2. simplify, loosening the error bound until the budget is met (each round aims at what is still needed)
  let used = 0
  for (const error of ERROR_STEPS.filter((e) => e <= maxError)) {
    const now = countTriangles(doc)
    if (now <= target * 1.02) break
    used = error
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.001, target / now), error, lockBorder: false }))
  }
  // 3. normals again, sharp at creases
  const buffer = doc.getRoot().listBuffers()[0]
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    if (p.getMode() !== 4 || !p.getIndices()) continue
    const pos = p.getAttribute('POSITION')
    const r = creaseNormals(pos.getArray(), p.getIndices().getArray(), creaseDeg)
    p.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(r.positions).setBuffer(buffer))
    p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(r.normals).setBuffer(buffer))
    p.setIndices(doc.createAccessor().setType('SCALAR').setArray(r.indices).setBuffer(buffer))
  }
  return { before, after: countTriangles(doc), error: used }
}
