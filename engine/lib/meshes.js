// Read STL, OBJ and COLLADA meshes, and make URDF primitives, as plain triangle arrays in the URDF link frame.
// Uses three.js loaders in Node. COLLADA needs an XML parser, which @xmldom/xmldom provides.
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { BoxGeometry, CylinderGeometry, SphereGeometry, Matrix4, Mesh } from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { DOMParser } from '@xmldom/xmldom'

export const MAX_MESH_BYTES = 64 * 1024 * 1024

/** A part: { positions: Float32Array, normals: Float32Array|null, indices: Uint32Array|null, color: [r,g,b,a]|null } */
function partFromGeometry(geometry, color = null) {
  const g = geometry
  const pos = g.getAttribute('position')
  if (!pos || pos.count === 0) return null
  const norm = g.getAttribute('normal')
  return {
    positions: Float32Array.from(pos.array),
    normals: norm ? Float32Array.from(norm.array) : null,
    indices: g.index ? Uint32Array.from(g.index.array) : null,
    color,
  }
}

/** Split a geometry with material groups into one part per group, each with its material's colour. */
function partsFromMesh(mesh, warnings, where) {
  const geometry = mesh.geometry.clone()
  geometry.applyMatrix4(mesh.matrixWorld)
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const colorOf = (m) => (m && m.color ? [m.color.r, m.color.g, m.color.b, m.opacity ?? 1] : null)
  if (mats.some((m) => m && (m.map || m.normalMap))) warnings.push(`${where}: image textures are not carried into the GLB; material colours are kept`)
  if (!geometry.groups.length || mats.length === 1) return [partFromGeometry(geometry, colorOf(mats[0]))].filter(Boolean)
  const out = []
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry
  const pos = nonIndexed.getAttribute('position'), nor = nonIndexed.getAttribute('normal')
  for (const group of geometry.groups) {
    const start = group.start, count = Math.min(group.count, pos.count - start)
    if (count <= 0) continue
    out.push({
      positions: Float32Array.from(pos.array.subarray(start * 3, (start + count) * 3)),
      normals: nor ? Float32Array.from(nor.array.subarray(start * 3, (start + count) * 3)) : null,
      indices: null,
      color: colorOf(mats[group.materialIndex] || mats[0]),
    })
  }
  return out
}

function meshesOf(root, warnings, where) {
  root.updateMatrixWorld(true)
  const parts = []
  root.traverse((o) => { if (o.isMesh) parts.push(...partsFromMesh(o, warnings, where)) })
  return parts
}

/** Remove image references so the COLLADA loader does not try to fetch textures. */
function stripImages(text) {
  return text.replace(/<library_images>[\s\S]*?<\/library_images>/g, '<library_images/>')
}

/** Load one mesh file. Returns { parts, warnings }. Throws with a readable message when the file cannot be read. */
export function loadMeshFile(file) {
  const ext = extname(file).slice(1).toLowerCase()
  const buf = readFileSync(file)
  if (buf.length > MAX_MESH_BYTES) throw new Error(`${file} is larger than ${MAX_MESH_BYTES / 1024 / 1024} MB`)
  const warnings = []
  if (ext === 'stl') {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    let geometry
    try { geometry = new STLLoader().parse(ab) } catch (e) { throw new Error(`${file} is not a readable STL file (${e.message})`) }
    const part = partFromGeometry(geometry)
    if (!part) throw new Error(`${file} has no triangles`)
    if (part.positions.some((v) => !Number.isFinite(v))) throw new Error(`${file} has coordinates that are not numbers`)
    return { parts: [part], warnings }
  }
  if (ext === 'obj') {
    const group = new OBJLoader().parse(buf.toString('utf8'))
    const parts = meshesOf(group, warnings, file)
    if (!parts.length) throw new Error(`${file} has no faces`)
    return { parts: parts.map((p) => ({ ...p, color: null })), warnings }
  }
  if (ext === 'dae') {
    const text = buf.toString('utf8')
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(`${file} contains a DOCTYPE or ENTITY declaration; refused for safety`)
    if (/<library_images>\s*<image/.test(text)) warnings.push(`${file}: image textures are not carried into the GLB; material colours are kept`)
    const previous = globalThis.DOMParser
    const quiet = { warn: console.warn, log: console.log, debug: console.debug }
    globalThis.DOMParser = DOMParser
    console.warn = console.log = console.debug = () => {}
    let result
    try { result = new ColladaLoader().parse(stripImages(text), '') } catch (e) { throw new Error(`${file} is not a readable COLLADA file (${e.message})`) } finally {
      globalThis.DOMParser = previous
      console.warn = quiet.warn
      console.log = quiet.log
      console.debug = quiet.debug
    }
    if (!result || !result.scene) throw new Error(`${file} is not a readable COLLADA file`)
    const scene = result.scene
    // URDF meshes live in the link frame, which is Z up. The loader turns Z_UP files to Y up; undo that,
    // and turn Y_UP files to Z up (as ROS tools do).
    scene.rotation.set(Math.abs(scene.rotation.x) > 1e-6 ? 0 : Math.PI / 2, 0, 0)
    const parts = meshesOf(scene, warnings, file)
    if (!parts.length) throw new Error(`${file} has no triangles`)
    return { parts, warnings: [...new Set(warnings)] }
  }
  throw new Error(`${file}: unsupported mesh format .${ext}`)
}

/** URDF box, cylinder (along Z) and sphere as parts. */
export function primitiveParts(geometry) {
  let g
  if (geometry.type === 'box') g = new BoxGeometry(...geometry.size)
  else if (geometry.type === 'cylinder') g = new CylinderGeometry(geometry.radius, geometry.radius, geometry.length, 40).applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2))
  else if (geometry.type === 'sphere') g = new SphereGeometry(geometry.radius, 32, 20)
  else throw new Error(`unknown primitive ${geometry.type}`)
  return [partFromGeometry(new Mesh(g).geometry)]
}
