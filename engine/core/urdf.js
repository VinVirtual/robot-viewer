// URDF reader. Text in, a plain robot description out. No files, no three.js.
// Angles are radians and lengths metres, as in the URDF. Fatal problems throw UrdfError;
// recoverable ones are listed in `warnings` with what was used instead.
import { DOMParser } from '@xmldom/xmldom'

export class UrdfError extends Error {}

export const MOVING_TYPES = new Set(['revolute', 'continuous', 'prismatic'])
const KNOWN_TYPES = new Set([...MOVING_TYPES, 'fixed', 'floating', 'planar'])
export const MESH_FORMATS = ['stl', 'obj', 'dae']
export const MAX_URDF_BYTES = 8 * 1024 * 1024
export const MAX_PARTS = 2000
export const MAX_NAME = 200
const listNames = (names, max = 8) => names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', ')

const elements = (node, tag) => {
  const out = []
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!tag || c.nodeName === tag)) out.push(c)
  return out
}
const first = (node, tag) => elements(node, tag)[0] || null
const attr = (node, name) => (node && node.hasAttribute(name) ? node.getAttribute(name) : undefined)
const xacroHint = (text) => (/\$\{|\$\(/.test(text) ? ' (it looks like an unexpanded xacro expression: run `xacro file.urdf.xacro > file.urdf` first)' : '')

function reader(warnings) {
  const list = (raw, n, fallback, where) => {
    if (raw === undefined) return fallback
    const text = String(raw).trim()
    const v = text ? text.split(/\s+/).map(Number) : []
    if (v.length === n && v.every(Number.isFinite)) return v
    warnings.push(`${where} is "${text}", which is not ${n} numbers${xacroHint(text)}; using ${fallback ? fallback.join(' ') : 'nothing'}`)
    return fallback
  }
  const one = (raw, fallback, where) => {
    if (raw === undefined) return fallback
    const text = String(raw).trim(), v = Number(text)
    if (text && Number.isFinite(v)) return v
    warnings.push(`${where} is "${text}", which is not a number${xacroHint(text)}; using ${fallback}`)
    return fallback
  }
  return { list, one }
}

const readOrigin = (node, read, where) => {
  const o = node && first(node, 'origin')
  return { xyz: read.list(attr(o, 'xyz'), 3, [0, 0, 0], `${where} origin xyz`), rpy: read.list(attr(o, 'rpy'), 3, [0, 0, 0], `${where} origin rpy`) }
}

function readColor(node, read, where) {
  const c = node && first(node, 'color')
  if (!c) return null
  const rgba = read.list(attr(c, 'rgba'), 4, null, `${where} color rgba`)
  return rgba ? rgba.map((v) => Math.min(1, Math.max(0, v))) : null
}

function readGeometry(node, read, where, warnings) {
  const g = node && first(node, 'geometry')
  const shape = g && elements(g)[0]
  if (!shape) { warnings.push(`${where} has no geometry; it is skipped`); return null }
  switch (shape.nodeName) {
    case 'box': return { type: 'box', size: read.list(attr(shape, 'size'), 3, [0.1, 0.1, 0.1], `${where} box size`).map(Math.abs) }
    case 'cylinder': return { type: 'cylinder', radius: Math.abs(read.one(attr(shape, 'radius'), 0.05, `${where} cylinder radius`)), length: Math.abs(read.one(attr(shape, 'length'), 0.1, `${where} cylinder length`)) }
    case 'sphere': return { type: 'sphere', radius: Math.abs(read.one(attr(shape, 'radius'), 0.05, `${where} sphere radius`)) }
    case 'mesh': {
      const filename = (attr(shape, 'filename') || '').trim()
      if (!filename) { warnings.push(`${where} mesh has no filename; it is skipped`); return null }
      const s = attr(shape, 'scale')
      const scale = s !== undefined && String(s).trim().split(/\s+/).length === 1
        ? Array(3).fill(read.one(s, 1, `${where} mesh scale`))
        : read.list(s, 3, [1, 1, 1], `${where} mesh scale`)
      return { type: 'mesh', filename, scale }
    }
    default:
      warnings.push(`${where} has a <${shape.nodeName}> shape, which is not supported (box, cylinder, sphere and mesh are); it is skipped`)
      return null
  }
}

/** Parse URDF text into { name, links, joints, materials, root, warnings }. Throws UrdfError when it cannot be used. */
export function parseUrdf(text) {
  if (typeof text !== 'string') throw new UrdfError('URDF must be text')
  if (text.length > MAX_URDF_BYTES) throw new UrdfError(`URDF is larger than ${MAX_URDF_BYTES / 1024 / 1024} MB; refusing to read it`)
  // entity declarations can expand into huge documents or pull in other files; a URDF never needs them
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new UrdfError('URDF contains a DOCTYPE or ENTITY declaration; these are refused for safety (remove them)')
  const errors = []
  let doc
  try {
    doc = new DOMParser({ onError: (level, msg) => { if (level !== 'warning') errors.push(String(msg).split('\n')[0]) } }).parseFromString(text, 'text/xml')
  } catch (e) { errors.push(String(e.message || e).split('\n')[0]) }
  if (errors.length || !doc) throw new UrdfError(`URDF is not well-formed XML: ${errors[0] || 'unreadable'}`)
  const robot = doc.documentElement
  if (!robot || robot.nodeName !== 'robot') throw new UrdfError(`the root element is <${robot ? robot.nodeName : 'nothing'}>, not <robot>`)
  if (/xacro/.test(text) && elements(robot).some((e) => e.nodeName.startsWith('xacro:'))) throw new UrdfError('this is a xacro file: run `xacro file.urdf.xacro > file.urdf` first')

  const warnings = []
  const read = reader(warnings)
  const name = (attr(robot, 'name') || 'robot').slice(0, MAX_NAME)

  const materials = {}
  for (const m of elements(robot, 'material')) {
    const n = attr(m, 'name')
    if (n) materials[n] = readColor(m, read, `material "${n}"`)
  }

  if (elements(robot, 'link').length > MAX_PARTS || elements(robot, 'joint').length > MAX_PARTS) throw new UrdfError(`more than ${MAX_PARTS} links or joints; refusing to read it`)
  const links = []
  const linkNames = new Set()
  for (const l of elements(robot, 'link')) {
    const ln = attr(l, 'name')
    if (!ln) throw new UrdfError('a <link> has no name')
    if (ln.length > MAX_NAME) throw new UrdfError(`a link name is longer than ${MAX_NAME} characters`)
    if (linkNames.has(ln)) throw new UrdfError(`link "${ln}" is defined twice`)
    linkNames.add(ln)
    const visuals = []
    elements(l, 'visual').forEach((v, i) => {
      const where = `link "${ln}" visual ${i + 1}`
      const geometry = readGeometry(v, read, where, warnings)
      if (!geometry) return
      const mat = first(v, 'material')
      let color = mat ? readColor(mat, read, `${where} material`) : null
      const matName = attr(mat, 'name')
      if (!color && matName) {
        if (matName in materials) color = materials[matName]
        else warnings.push(`${where} uses material "${matName}", which is not defined; using the default colour`)
      }
      visuals.push({ origin: readOrigin(v, read, where), geometry, color })
    })
    links.push({ name: ln, visuals })
  }
  if (!links.length) throw new UrdfError('URDF has no <link>')

  const joints = []
  const jointNames = new Set()
  const parentOf = new Map()
  for (const j of elements(robot, 'joint')) {
    const jn = attr(j, 'name')
    if (!jn) throw new UrdfError('a <joint> has no name')
    if (jn.length > MAX_NAME) throw new UrdfError(`a joint name is longer than ${MAX_NAME} characters`)
    if (jointNames.has(jn)) throw new UrdfError(`joint "${jn}" is defined twice`)
    jointNames.add(jn)
    const where = `joint "${jn}"`
    let type = attr(j, 'type')
    if (!KNOWN_TYPES.has(type)) throw new UrdfError(`${where} has type "${type}"; expected one of ${[...KNOWN_TYPES].join(', ')}`)
    if (type === 'floating' || type === 'planar') { warnings.push(`${where} is ${type}; it is shown as fixed`); type = 'fixed' }
    const parent = attr(first(j, 'parent'), 'link'), child = attr(first(j, 'child'), 'link')
    if (!parent || !child) throw new UrdfError(`${where} needs <parent link> and <child link>`)
    for (const l of [parent, child]) if (!linkNames.has(l)) throw new UrdfError(`${where} refers to link "${l}", which does not exist`)
    if (parent === child) throw new UrdfError(`${where} connects link "${parent}" to itself`)
    if (parentOf.has(child)) throw new UrdfError(`link "${child}" has two parent joints ("${parentOf.get(child)}" and "${jn}"); closed loops are not supported`)
    parentOf.set(child, jn)

    let axis = read.list(attr(first(j, 'axis'), 'xyz'), 3, [1, 0, 0], `${where} axis`)
    const len = Math.hypot(...axis)
    if (MOVING_TYPES.has(type) && len < 1e-9) throw new UrdfError(`${where} has a zero axis`)
    if (len > 1e-9) axis = axis.map((v) => v / len)

    let limit = null
    const lim = first(j, 'limit')
    if (type === 'revolute' || type === 'prismatic') {
      if (!lim) {
        warnings.push(`${where} is ${type} but has no <limit>; ${type === 'revolute' ? 'using -180 to 180 degrees' : 'it is locked at 0'}`)
        limit = type === 'revolute' ? { lower: -Math.PI, upper: Math.PI, velocity: null, effort: null } : { lower: 0, upper: 0, velocity: null, effort: null }
      } else {
        const lower = read.one(attr(lim, 'lower'), 0, `${where} limit lower`), upper = read.one(attr(lim, 'upper'), 0, `${where} limit upper`)
        if (lower > upper) throw new UrdfError(`${where} has lower limit ${lower} above upper limit ${upper}`)
        if (lower === upper) warnings.push(`${where} has equal lower and upper limits (${lower}); it cannot move`)
        limit = { lower, upper, velocity: read.one(attr(lim, 'velocity'), null, `${where} limit velocity`), effort: read.one(attr(lim, 'effort'), null, `${where} limit effort`) }
      }
    } else if (type === 'continuous' && lim) {
      limit = { lower: null, upper: null, velocity: read.one(attr(lim, 'velocity'), null, `${where} limit velocity`), effort: read.one(attr(lim, 'effort'), null, `${where} limit effort`) }
    }

    let mimic = null
    const mi = first(j, 'mimic')
    if (mi) {
      const of = attr(mi, 'joint')
      if (!of) throw new UrdfError(`${where} has a <mimic> with no joint`)
      mimic = { joint: of, multiplier: read.one(attr(mi, 'multiplier'), 1, `${where} mimic multiplier`), offset: read.one(attr(mi, 'offset'), 0, `${where} mimic offset`) }
    }
    joints.push({ name: jn, type, parent, child, origin: readOrigin(j, read, where), axis, limit, mimic })
  }

  const roots = links.filter((l) => !parentOf.has(l.name))
  if (roots.length === 0) throw new UrdfError('every link has a parent joint, so the joints form a loop; a URDF must be a tree')
  if (roots.length > 1) throw new UrdfError(`the URDF has ${roots.length} separate parts (root links: ${listNames(roots.map((l) => l.name))}); connect them with joints`)
  const root = roots[0].name

  // every link must be reachable from the root (no cycles hanging off the tree)
  const children = new Map()
  for (const j of joints) children.set(j.parent, [...(children.get(j.parent) || []), j.child])
  const seen = new Set([root]), stack = [root]
  while (stack.length) for (const c of children.get(stack.pop()) || []) if (!seen.has(c)) { seen.add(c); stack.push(c) }
  const unreachable = links.filter((l) => !seen.has(l.name)).map((l) => l.name)
  if (unreachable.length) throw new UrdfError(`links ${listNames(unreachable)} form a loop and cannot be reached from the root link "${root}"`)

  // mimic targets must exist, move, and not form chains back to themselves
  const byName = new Map(joints.map((j) => [j.name, j]))
  for (const j of joints) {
    if (!j.mimic) continue
    const target = byName.get(j.mimic.joint)
    if (!target) throw new UrdfError(`joint "${j.name}" mimics "${j.mimic.joint}", which does not exist`)
    if (!MOVING_TYPES.has(j.type)) { warnings.push(`joint "${j.name}" is ${j.type}, so its <mimic> is ignored`); j.mimic = null; continue }
    if (!MOVING_TYPES.has(target.type)) throw new UrdfError(`joint "${j.name}" mimics "${target.name}", which is ${target.type} and cannot move`)
    const chain = new Set([j.name])
    for (let t = target; t && t.mimic; t = byName.get(t.mimic.joint)) {
      if (chain.has(t.name)) throw new UrdfError(`joints ${[...chain].join(', ')} mimic each other in a loop`)
      chain.add(t.name)
    }
  }

  return { name, root, links, joints, materials, warnings }
}

/** Summary used by `inspect` and the joints JSON. */
export function describeJoint(j) {
  const unit = j.type === 'prismatic' ? 'm' : 'rad'
  return { name: j.name, type: j.type, unit, lower: j.limit?.lower ?? null, upper: j.limit?.upper ?? null, mimic: j.mimic?.joint ?? null }
}
