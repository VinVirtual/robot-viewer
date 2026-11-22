// The joints description stored in a GLB is read by the browser from a file it fetched: check it fully
// and return a clean copy (unit axes, finite numbers, a real tree) before anything uses it.
export const FORMAT = 'robot-viewer/1'
export const MAX_PARTS = 2000
export const MAX_NAME = 200
const TYPES = new Set(['revolute', 'continuous', 'prismatic', 'fixed'])

const fail = (msg) => { throw new Error(`the joints description in this GLB is not usable: ${msg}`) }
const isName = (n) => typeof n === 'string' && n.length > 0 && n.length <= MAX_NAME
const vec3 = (v, what) => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) fail(`${what} must be three finite numbers`)
  return [...v]
}
const num = (v, what, nullable = true) => {
  if (v === null || v === undefined) { if (nullable) return null; fail(`${what} is missing`) }
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} must be a finite number`)
  return v
}

/** Validate and normalise. Throws an Error with a readable message. */
export function checkDescription(d) {
  if (!d || typeof d !== 'object' || d.format !== FORMAT) throw new Error('this GLB was not made by robot-viewer build (no joints description inside)')
  if (!isName(d.root)) fail('root link is missing')
  if (!Array.isArray(d.links) || !Array.isArray(d.joints)) fail('links and joints must be lists')
  if (d.links.length > MAX_PARTS || d.joints.length > MAX_PARTS) fail(`more than ${MAX_PARTS} links or joints`)
  const links = new Set()
  for (const l of d.links) { if (!isName(l) || links.has(l)) fail(`bad or repeated link name ${JSON.stringify(l)}`); links.add(l) }
  if (!links.has(d.root)) fail('the root link is not in the list of links')
  const names = new Set(), children = new Set()
  const joints = d.joints.map((j, i) => {
    if (!j || typeof j !== 'object') fail(`joint ${i} is not an object`)
    if (!isName(j.name) || names.has(j.name)) fail(`bad or repeated joint name ${JSON.stringify(j.name)}`)
    names.add(j.name)
    if (!TYPES.has(j.type)) fail(`joint "${j.name}" has type ${JSON.stringify(j.type)}`)
    if (!links.has(j.parent) || !links.has(j.child)) fail(`joint "${j.name}" refers to a link that does not exist`)
    if (j.child === d.root || children.has(j.child)) fail(`link "${j.child}" has more than one parent`)
    children.add(j.child)
    const axis = vec3(j.axis, `joint "${j.name}" axis`)
    const len = Math.hypot(...axis)
    if (j.type !== 'fixed' && len < 1e-9) fail(`joint "${j.name}" has a zero axis`)
    const origin = { xyz: vec3(j.origin?.xyz, `joint "${j.name}" origin xyz`), rpy: vec3(j.origin?.rpy, `joint "${j.name}" origin rpy`) }
    let limit = null
    if (j.limit) {
      limit = { lower: num(j.limit.lower, `joint "${j.name}" lower limit`), upper: num(j.limit.upper, `joint "${j.name}" upper limit`), velocity: num(j.limit.velocity, 'velocity'), effort: num(j.limit.effort, 'effort') }
      if (limit.lower !== null && limit.upper !== null && limit.lower > limit.upper) fail(`joint "${j.name}" has lower limit above upper limit`)
    }
    if ((j.type === 'revolute' || j.type === 'prismatic') && (!limit || limit.lower === null || limit.upper === null)) fail(`joint "${j.name}" needs limits`)
    let mimic = null
    if (j.mimic) mimic = { joint: j.mimic.joint, multiplier: num(j.mimic.multiplier, 'mimic multiplier', false), offset: num(j.mimic.offset, 'mimic offset', false) }
    return { name: j.name, type: j.type, parent: j.parent, child: j.child, origin, axis: len > 1e-9 ? axis.map((x) => x / len) : axis, limit, mimic }
  })
  for (const j of joints) if (j.mimic && !names.has(j.mimic.joint)) fail(`joint "${j.name}" mimics a joint that does not exist`)
  // every link reachable from the root, walked without recursion
  const childrenOf = new Map()
  for (const j of joints) childrenOf.set(j.parent, [...(childrenOf.get(j.parent) || []), j.child])
  const seen = new Set([d.root]), stack = [d.root]
  while (stack.length) for (const c of childrenOf.get(stack.pop()) || []) if (!seen.has(c)) { seen.add(c); stack.push(c) }
  if (seen.size !== links.size) fail('some links are not connected to the root (a loop or a separate part)')
  // mimic chains must end
  const byName = new Map(joints.map((j) => [j.name, j]))
  for (const j of joints) {
    const chain = new Set([j.name])
    for (let t = j.mimic && byName.get(j.mimic.joint); t; t = t.mimic && byName.get(t.mimic.joint)) {
      if (chain.has(t.name)) fail('mimic joints form a loop')
      chain.add(t.name)
    }
  }
  const poses = {}
  const src = d.poses && typeof d.poses === 'object' && !Array.isArray(d.poses) ? d.poses : {}
  for (const [name, values] of Object.entries(src)) {
    if (!isName(name) || !values || typeof values !== 'object') continue
    const clean = {}
    for (const [k, v] of Object.entries(values)) if (names.has(k) && typeof v === 'number' && Number.isFinite(v)) clean[k] = v
    poses[name] = clean
  }
  const defaultPose = typeof d.defaultPose === 'string' && Object.hasOwn(poses, d.defaultPose) ? d.defaultPose : null
  return { format: FORMAT, robot: isName(d.robot) ? d.robot : 'robot', root: d.root, links: [...links], joints, poses, defaultPose }
}
