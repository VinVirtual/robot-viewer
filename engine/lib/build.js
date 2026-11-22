// URDF (+ poses) -> dist/: the robot GLB and its joints JSON, the component, a demo page, a snippet and a size report.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs'
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

export function readManifest(out) {
  const p = join(out, 'robots.json')
  if (!existsSync(p)) return { robots: [] }
  try {
    const m = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(m.robots) ? m : { robots: [] }
  } catch { return { robots: [] } }
}

/**
 * @param {string} urdfPath
 * @param {{ out: string, name?: string, poses?: string, packageDir?: string, compress?: string, simplify?: number|null,
 *   clamp?: boolean, title?: string, orbit?: string, alt?: string, arGlb?: string, arUsdz?: string, ik?: boolean, base?: string, log?: (s: string) => void }} o
 */
export async function buildRobot(urdfPath, o) {
  const log = o.log || (() => {})
  const out = resolve(o.out)
  mkdirSync(out, { recursive: true })
  const robot = parseUrdf(readFileSync(urdfPath, 'utf8'))
  const name = o.name || safeName(robot.name)
  if (!NAME.test(name)) throw new Error(`--name "${name}" must be 1 to 48 lower-case letters, digits, "-" or "_"`)
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
  const description = jointsDescription(robot, { ...poseResult, glb: glbName })
  root.setExtras({ rv: 'robot', robotViewer: description })
  await optimise(doc, { compress: o.compress || 'meshopt', simplifyRatio: o.simplify ?? null })
  const triangles = countTriangles(doc)
  const glb = await (await nodeIO()).writeBinary(doc)
  writeFileSync(join(out, glbName), glb)
  writeFileSync(join(out, `${name}.joints.json`), JSON.stringify(description, null, 2) + '\n')
  log(`wrote ${glbName}: ${triangles} triangles (${stats.triangles} before), ${stats.materials} materials${stats.missingVisuals ? `, ${stats.missingVisuals} visual(s) skipped` : ''}`)

  const ar = {}
  for (const [key, file, ext] of [['glb', o.arGlb, '.glb'], ['usdz', o.arUsdz, '.usdz']]) {
    if (!file) continue
    if (extname(file).toLowerCase() !== ext) throw new Error(`--ar-${key} must be a ${ext} file`)
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`--ar-${key} ${file} does not exist`)
    const target = `${name}.ar${ext}`
    copyFileSync(file, join(out, target))
    ar[key] = target
  }

  await bundle(out)

  const manifest = readManifest(out)
  const entry = {
    name, robot: robot.name, title: o.title || robot.name, alt: o.alt || `${o.title || robot.name}, a 3D model of the robot`,
    glb: glbName, joints: `${name}.joints.json`, poster: null, ik: o.ik !== false, ar, leaf: grabLink(robot), orbit: o.orbit || null,
    poses: poseResult.order, defaultPose: poseResult.defaultPose,
    stats: { links: robot.links.length, joints: robot.joints.length, moving: description.joints.filter((j) => ['revolute', 'continuous', 'prismatic'].includes(j.type) && !j.mimic).length, triangles },
  }
  const prev = manifest.robots.find((r) => r.name === name)
  if (prev && prev.poster && existsSync(join(out, prev.poster))) entry.poster = prev.poster
  manifest.robots = [...manifest.robots.filter((r) => r.name !== name), entry]
  writeFileSync(join(out, 'robots.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { out, name, entry, manifest, warnings: [...robot.warnings, ...poseResult.warnings, ...warnings] }
}

/** Demo page, snippet and size report for everything in `out`. */
export function finishDist(out, { base = '' } = {}) {
  const manifest = readManifest(out)
  writeDemo(out, manifest)
  const snippets = manifest.robots.map((r) => snippetFor(r, { base }))
  writeFileSync(join(out, 'snippet.html'), snippets.join('\n\n') + '\n')
  const files = [FILES.entry, FILES.engine, FILES.css, 'index.html', 'demo.css', 'demo.js', 'robots.json',
    ...manifest.robots.flatMap((r) => [r.glb, r.joints, r.poster, r.poster && r.poster.replace(/\.webp$/, '.png'), r.ar?.glb, r.ar?.usdz])].filter(Boolean)
  const report = sizeReport(out, [...new Set(files)].filter((f) => existsSync(join(out, f))))
  writeFileSync(join(out, 'size-report.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(out, 'size-report.txt'), formatSizeReport(report) + '\n')
  return { manifest, snippets, report }
}

export { basename }
