// URDF (+ poses) -> dist/: the robot GLB and its joints JSON, the component, a demo page, a snippet and a size report.
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { writeSafe, copySafe, FILE_NAME } from './files.js'
import { POSE_NAME } from '../core/poses.js'
import { join, resolve, basename, extname } from 'node:path'
import { parseUrdf } from '../core/urdf.js'
import { validatePoses } from '../core/poses.js'
import { buildDocument, optimise, nodeIO, jointsDescription, countTriangles } from './gltf.js'
import { bundle, FILES } from './bundle.js'
import { writeDemo, snippetFor } from './html.js'
import { sizeReport, formatSizeReport } from './sizes.js'

export const NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/

/** Robot file name from the URDF's robot name: lower case, letters, digits, "-" and "_". */
export function safeName(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 48)
  return s || 'robot'
}

/** The part a person would grab: the deepest link that still has links below it (a hand rather than a finger). */
export function grabLink(robot) {
  const moving = new Set(['revolute', 'continuous', 'prismatic'])
  const parentJoint = new Map(robot.joints.map((j) => [j.child, j]))
  const hasChild = new Set(robot.joints.map((j) => j.parent))
  const depth = (link) => { let n = 0; for (let j = parentJoint.get(link); j; j = parentJoint.get(j.parent)) if (moving.has(j.type) && !j.mimic) n++; return n }
  let best = null, bestDepth = 0
  for (const l of robot.links) {
    if (!hasChild.has(l.name) || !l.visuals.length) continue
    const d = depth(l.name)
    if (d > bestDepth) { best = l.name; bestDepth = d }
  }
  return best
}

const ORBIT = /^-?\d+(\.\d+)? -?\d+(\.\d+)?$/
const text = (v, max) => (typeof v === 'string' && v.length <= max ? v : null)
const file = (v) => (typeof v === 'string' && FILE_NAME.test(v) && !v.includes('..') ? v : null)
const count = (v) => (Number.isInteger(v) && v >= 0 && v < 1e9 ? v : 0)

/** One manifest entry, checked field by field. robots.json sits in a folder others may write to, and its
    values end up in pages and file paths, so anything unexpected is dropped. Returns null when unusable. */
export function cleanEntry(r) {
  if (!r || typeof r !== 'object' || typeof r.name !== 'string' || !NAME.test(r.name)) return null
  const glb = file(r.glb)
  if (!glb || !glb.endsWith('.glb')) return null
  const poses = Array.isArray(r.poses) ? r.poses.filter((p) => typeof p === 'string' && POSE_NAME.test(p)) : []
  const ar = {}
  if (r.ar && file(r.ar.glb) && r.ar.glb.endsWith('.glb')) ar.glb = r.ar.glb
  if (r.ar && file(r.ar.usdz) && r.ar.usdz.endsWith('.usdz')) ar.usdz = r.ar.usdz
  return {
    name: r.name, robot: text(r.robot, 200) || r.name, title: text(r.title, 200) || r.name, alt: text(r.alt, 500) || r.name,
    glb, joints: file(r.joints), poster: file(r.poster), ik: r.ik === true, ar,
    leaf: text(r.leaf, 200), orbit: typeof r.orbit === 'string' && ORBIT.test(r.orbit) ? r.orbit : null,
    poses, defaultPose: poses.includes(r.defaultPose) ? r.defaultPose : null,
    license: text(r.license, 100), source: text(r.source, 300),
    stats: { links: count(r.stats?.links), joints: count(r.stats?.joints), moving: count(r.stats?.moving), triangles: count(r.stats?.triangles) },
  }
}

export function readManifest(out) {
  const p = join(out, 'robots.json')
  if (!existsSync(p)) return { robots: [] }
  try {
    const m = JSON.parse(readFileSync(p, 'utf8'))
    const robots = Array.isArray(m.robots) ? m.robots.map(cleanEntry).filter(Boolean) : []
    return { robots: robots.filter((r, i) => robots.findIndex((x) => x.name === r.name) === i) }
  } catch { return { robots: [] } }
}

/**
 * @param {string} urdfPath
 * @param {{ out: string, name?: string, poses?: string, packageDir?: string, compress?: string, simplify?: number|null,
 *   clamp?: boolean, triangles?: number, title?: string, orbit?: string, license?: string, source?: string, alt?: string, arGlb?: string, arUsdz?: string, ik?: boolean, base?: string, log?: (s: string) => void }} o
 */
export async function buildRobot(urdfPath, o) {
  const log = o.log || (() => {})
  const out = resolve(o.out)
  mkdirSync(out, { recursive: true })
  const robot = parseUrdf(readFileSync(urdfPath, 'utf8'))
  const name = o.name || safeName(robot.name)
  if (!NAME.test(name)) throw new Error(`--name "${name}" must be 1 to 48 lower-case letters, digits, "-" or "_"`)
  if (o.license !== undefined && (typeof o.license !== 'string' || !o.license.trim() || o.license.length > 100)) throw new Error('--license must be a short licence name, such as "Apache-2.0"')
  if (o.source !== undefined && (typeof o.source !== 'string' || !o.source.trim() || o.source.length > 300)) throw new Error('--source must be a short text or address, 300 characters at most')
  for (const w of robot.warnings) log(`warning: ${w}`)

  let poseResult = { poses: {}, order: [], defaultPose: null, errors: [], warnings: [] }
  if (o.poses) {
    let input
    try { input = JSON.parse(readFileSync(o.poses, 'utf8')) } catch (e) { throw new Error(`${o.poses} is not valid JSON (${e.message})`) }
    poseResult = validatePoses(input, robot, { clamp: !!o.clamp })
    for (const w of poseResult.warnings) log(`warning: ${w}`)
    if (poseResult.errors.length) throw new Error(`poses file has ${poseResult.errors.length} problem(s):\n  - ${poseResult.errors.join('\n  - ')}`)
  }

  log(`reading meshes for ${robot.name} (${robot.links.length} links, ${robot.joints.length} joints)`)
  const { doc, root, warnings, stats } = buildDocument(robot, { urdfPath: resolve(urdfPath), packageDir: o.packageDir && resolve(o.packageDir) })
  for (const w of warnings) log(`warning: ${w}`)
  const glbName = `${name}.glb`
  const description = { ...jointsDescription(robot, { ...poseResult, glb: glbName }), license: o.license || null, source: o.source || null }
  root.setExtras({ rv: 'robot', robotViewer: description })
  // the model's own licence travels inside the file, in the standard glTF place as well
  if (o.license || o.source) doc.getRoot().getAsset().copyright = [o.source && `Source: ${o.source}`, o.license && `Licence: ${o.license}`].filter(Boolean).join('. ')
  if (o.triangles !== undefined && o.triangles !== null && !(Number.isInteger(o.triangles) && o.triangles >= 100)) throw new Error('--triangles must be a whole number of at least 100')
  const ratio = o.triangles ? Math.min(1, o.triangles / Math.max(1, stats.triangles)) : o.simplify ?? null
  const simplified = await optimise(doc, { compress: o.compress || 'meshopt', simplifyRatio: ratio !== null && ratio < 1 ? ratio : null })
  if (simplified) log(`simplified: ${simplified.before} -> ${simplified.after} triangles (target ${Math.round(simplified.before * ratio)}, surface error bound ${simplified.error} of each mesh's size)`)
  const triangles = countTriangles(doc)
  const glb = await (await nodeIO()).writeBinary(doc)
  writeSafe(out, glbName, glb)
  writeSafe(out, `${name}.joints.json`, JSON.stringify(description, null, 2) + '\n')
  log(`wrote ${glbName}: ${triangles} triangles (${stats.triangles} before), ${stats.materials} materials${stats.missingVisuals ? `, ${stats.missingVisuals} visual(s) skipped` : ''}`)

  const ar = {}
  for (const [key, file, ext] of [['glb', o.arGlb, '.glb'], ['usdz', o.arUsdz, '.usdz']]) {
    if (!file) continue
    if (extname(file).toLowerCase() !== ext) throw new Error(`--ar-${key} must be a ${ext} file`)
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`--ar-${key} ${file} does not exist`)
    const target = `${name}.ar${ext}`
    copySafe(file, out, target)
    ar[key] = target
  }

  await bundle(out)

  const manifest = readManifest(out)
  const entry = {
    name, robot: robot.name, title: o.title || robot.name, alt: o.alt || `${o.title || robot.name}, a 3D model of the robot`,
    glb: glbName, joints: `${name}.joints.json`, poster: null, ik: o.ik !== false, ar, leaf: grabLink(robot), orbit: o.orbit || null,
    poses: poseResult.order, defaultPose: poseResult.defaultPose, license: o.license || null, source: o.source || null,
    stats: { links: robot.links.length, joints: robot.joints.length, moving: description.joints.filter((j) => ['revolute', 'continuous', 'prismatic'].includes(j.type) && !j.mimic).length, triangles },
  }
  const prev = manifest.robots.find((r) => r.name === name)
  if (prev && prev.poster && existsSync(join(out, prev.poster))) entry.poster = prev.poster
  manifest.robots = [...manifest.robots.filter((r) => r.name !== name), entry]
  writeSafe(out, 'robots.json', JSON.stringify(manifest, null, 2) + '\n')
  return { out, name, entry, manifest, warnings: [...robot.warnings, ...poseResult.warnings, ...warnings] }
}

/** Demo page, snippet and size report for everything in `out`. */
export function finishDist(out, { base = '' } = {}) {
  const manifest = readManifest(out)
  writeDemo(out, manifest)
  const snippets = manifest.robots.map((r) => snippetFor(r, { base }))
  writeSafe(out, 'snippet.html', snippets.join('\n\n') + '\n')
  const files = [FILES.entry, FILES.engine, FILES.css, FILES.licenses, 'index.html', 'demo.css', 'demo.js', 'robots.json',
    ...manifest.robots.flatMap((r) => [r.glb, r.joints, r.poster, r.poster && r.poster.replace(/\.webp$/, '.png'), r.ar?.glb, r.ar?.usdz])].filter(Boolean)
  const report = sizeReport(out, [...new Set(files)].filter((f) => existsSync(join(out, f))))
  writeSafe(out, 'size-report.json', JSON.stringify(report, null, 2) + '\n')
  writeSafe(out, 'size-report.txt', formatSizeReport(report) + '\n')
  return { manifest, snippets, report }
}

export { basename }
