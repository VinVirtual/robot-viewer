// Robot description + meshes -> one compressed GLB.
// Node tree: robot root (turns URDF Z-up into glTF Y-up) -> link -> joint (its fixed origin) -> child link (the joint's motion) ...
// Each link and joint node carries extras { rv: "link" | "joint", name } so the viewer finds them even when a loader renames nodes.
// The whole joints description is stored in the root node's extras as well, so the GLB alone is enough to drive the viewer.
import { Document, NodeIO, Logger } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { weld, dedup, prune, meshopt, simplify } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer'
import { dirname } from 'node:path'
import { fromRpy, toQuaternion } from '../core/mat.js'
import { resolveMeshPath } from './paths.js'
import { loadMeshFile, primitiveParts } from './meshes.js'

export const DEFAULT_COLOR = [0.62, 0.64, 0.67, 1]
export const FORMAT = 'robot-viewer/1'
const Z_UP_TO_Y_UP = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]

/** sRGB component (0..1) to linear light. */
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

const originTRS = (origin) => ({ translation: [...origin.xyz], rotation: toQuaternion(fromRpy(origin.rpy)) })
const round = (v, d = 6) => +v.toFixed(d)

/** The joints description saved next to the GLB and inside it. */
export function jointsDescription(robot, { poses = {}, order = [], defaultPose = null, glb = null, bounds = null } = {}) {
  return {
    format: FORMAT,
    robot: robot.name,
    glb,
    up: 'z',
    units: { angle: 'rad', length: 'm' },
    root: robot.root,
    links: robot.links.map((l) => l.name),
    joints: robot.joints.map((j) => ({
      name: j.name, type: j.type, parent: j.parent, child: j.child,
      origin: { xyz: j.origin.xyz.map((v) => round(v)), rpy: j.origin.rpy.map((v) => round(v)) },
      axis: j.axis.map((v) => round(v)),
      limit: j.limit, mimic: j.mimic,
    })),
    poses: Object.fromEntries(order.map((n) => [n, Object.fromEntries(Object.entries(poses[n]).map(([k, v]) => [k, round(v)]))])),
    defaultPose,
    bounds,
  }
}

/**
 * Build the glTF document. Returns { doc, warnings, stats }.
 * @param {object} robot parsed URDF
 * @param {{ urdfPath: string, packageDir?: string }} where
 */
export function buildDocument(robot, { urdfPath, packageDir } = {}) {
  const urdfDir = dirname(urdfPath)
  const warnings = []
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN))
  const buffer = doc.createBuffer()
  const scene = doc.createScene(robot.name)
  const materials = new Map()
  // URDF colours are display (sRGB) values, as RViz shows them; glTF colour factors are linear
  const material = (rgba, linear = false) => {
    const c = linear ? rgba : (rgba || DEFAULT_COLOR).map((v, i) => (i < 3 ? srgbToLinear(v) : v))
    const key = c.map((v) => v.toFixed(3)).join(',')
    if (!materials.has(key)) {
      const m = doc.createMaterial(`color_${materials.size}`).setBaseColorFactor([...c]).setMetallicFactor(0.05).setRoughnessFactor(0.58)
      if (c[3] < 0.999) m.setAlphaMode('BLEND')
      materials.set(key, m)
    }
    return materials.get(key)
  }
  const meshCache = new Map()
  let triangles = 0, missing = 0

  const makeMesh = (visual, name) => {
    const geo = visual.geometry
    let parts
    if (geo.type === 'mesh') {
      let file
      try { file = resolveMeshPath(geo.filename, { urdfDir, packageDir }) } catch (e) { warnings.push(`${name}: ${e.message}; this visual is skipped`); missing++; return null }
      if (!meshCache.has(file)) {
        try {
          const r = loadMeshFile(file)
          warnings.push(...r.warnings)
          meshCache.set(file, r.parts)
        } catch (e) { warnings.push(`${name}: ${e.message}; this visual is skipped`); meshCache.set(file, null) }
      }
      parts = meshCache.get(file)
      if (!parts) { missing++; return null }
    } else {
      parts = primitiveParts(geo)
    }
    const mesh = doc.createMesh(name)
    for (const p of parts) {
      const prim = doc.createPrimitive()
      prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p.positions).setBuffer(buffer))
      if (p.normals) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(p.normals).setBuffer(buffer))
      if (p.indices) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(p.indices).setBuffer(buffer))
      // URDF colour wins for meshes with no colour of their own (STL, OBJ); COLLADA keeps its material colours
      // COLLADA colours arrive linear from the loader; URDF colours are converted
      const own = geo.type === 'mesh' && p.color && !visual.color
      prim.setMaterial(own ? material(p.color, true) : material(visual.color))
      mesh.addPrimitive(prim)
      triangles += (p.indices ? p.indices.length : p.positions.length / 3) / 3
    }
    return mesh
  }

  const linkByName = new Map(robot.links.map((l) => [l.name, l]))
  const childJoints = new Map()
  for (const j of robot.joints) childJoints.set(j.parent, [...(childJoints.get(j.parent) || []), j])

  const buildLink = (name) => {
    const link = linkByName.get(name)
    const node = doc.createNode(name).setExtras({ rv: 'link', name })
    link.visuals.forEach((v, i) => {
      const mesh = makeMesh(v, `${name}_visual_${i}`)
      if (!mesh) return
      const t = originTRS(v.origin)
      const vn = doc.createNode(`${name}_visual_${i}`).setTranslation(t.translation).setRotation(t.rotation).setMesh(mesh)
      if (v.geometry.type === 'mesh') vn.setScale([...v.geometry.scale])
      node.addChild(vn)
    })
    for (const j of childJoints.get(name) || []) {
      const t = originTRS(j.origin)
      const jn = doc.createNode(`joint_${j.name}`).setTranslation(t.translation).setRotation(t.rotation).setExtras({ rv: 'joint', name: j.name })
      jn.addChild(buildLink(j.child))
      node.addChild(jn)
    }
    return node
  }

  const root = doc.createNode(`${robot.name}_root`).setRotation(Z_UP_TO_Y_UP).setExtras({ rv: 'robot' })
  root.addChild(buildLink(robot.root))
  scene.addChild(root)
  doc.getRoot().setDefaultScene(scene)
  return { doc, root, warnings: [...new Set(warnings)], stats: { triangles: Math.round(triangles), missingVisuals: missing, materials: materials.size } }
}

/** Weld, optionally simplify, compress. `compress`: "meshopt" (default) or "none". */
export async function optimise(doc, { compress = 'meshopt', simplifyRatio = null, simplifyError = 0.001 } = {}) {
  await MeshoptEncoder.ready
  await doc.transform(dedup(), weld())
  if (simplifyRatio !== null && simplifyRatio < 1) {
    await MeshoptSimplifier.ready
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: simplifyError }))
  }
  await doc.transform(prune({ keepLeaves: true, keepExtras: true }))
  if (compress === 'meshopt') await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  else if (compress !== 'none') throw new Error(`unknown compression "${compress}"; use meshopt or none`)
  return doc
}

export async function nodeIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
  return new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
}

/** Count triangles in a document (after any simplification). */
export function countTriangles(doc) {
  let n = 0
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices()
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3
  }
  return Math.round(n)
}
