// Joint values, limits, mimic joints and forward kinematics. Pure; used by the build and by the browser component.
// A "robot" here is the joints JSON form: { root, joints: [{ name, type, parent, child, origin, axis, limit, mimic }] }.
import { identity, multiply, fromOrigin, axisAngle, translation, scale } from './mat.js'

export const MOVING = new Set(['revolute', 'continuous', 'prismatic'])

/** The range a joint can be set to: its URDF limits, or -pi..pi for continuous joints, or [0, 0] when fixed. */
export function jointRange(joint) {
  if (!joint || !MOVING.has(joint.type)) return [0, 0]
  if (joint.type === 'continuous') return [-Math.PI, Math.PI]
  return [joint.limit?.lower ?? 0, joint.limit?.upper ?? 0]
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
/** Wrap an angle into -pi..pi. */
export const wrapAngle = (v) => {
  const t = (((v + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  return t === -Math.PI && v > 0 ? Math.PI : t
}
/** A value the joint can take: clamped to its limits, or wrapped for a continuous joint. */
export const clampJoint = (joint, v) => {
  if (joint?.type === 'continuous') return wrapAngle(Number.isFinite(v) ? v : 0)
  const [lo, hi] = jointRange(joint)
  return clamp(Number.isFinite(v) ? v : 0, lo, hi)
}

/** Joints the user can set directly: moving and not driven by a <mimic>. */
export const controllableJoints = (robot) => robot.joints.filter((j) => MOVING.has(j.type) && !j.mimic)

/** Index by name plus a parent->children map, computed once per robot. */
export function indexRobot(robot) {
  const byName = new Map(robot.joints.map((j) => [j.name, j]))
  const byChild = new Map(robot.joints.map((j) => [j.child, j]))
  const childrenOf = new Map()
  for (const j of robot.joints) childrenOf.set(j.parent, [...(childrenOf.get(j.parent) || []), j])
  // depth-first from the root gives parents before children
  const order = []
  const walk = (link) => { for (const j of childrenOf.get(link) || []) { order.push(j); walk(j.child) } }
  walk(robot.root)
  return { byName, byChild, childrenOf, order }
}

/** A complete set of values: every moving joint gets a number inside its limits, mimic joints follow their source.
    Unknown names in `values` are ignored. Returns a new object. */
export function resolveValues(robot, values = {}, index = indexRobot(robot)) {
  const out = {}
  for (const j of robot.joints) if (MOVING.has(j.type) && !j.mimic) out[j.name] = clampJoint(j, Number(values[j.name] ?? 0))
  const mimicValue = (j, depth = 0) => {
    if (!j.mimic) return out[j.name] ?? 0
    if (depth > 32) return 0
    const src = index.byName.get(j.mimic.joint)
    return clampJoint(j, mimicValue(src, depth + 1) * j.mimic.multiplier + j.mimic.offset)
  }
  for (const j of robot.joints) if (MOVING.has(j.type) && j.mimic) out[j.name] = mimicValue(j)
  return out
}

/** The transform a joint adds at value v (rotation about its axis, or a slide along it). */
export function jointMotion(joint, v) {
  if (joint.type === 'prismatic') return translation(scale(joint.axis, v))
  if (joint.type === 'revolute' || joint.type === 'continuous') return axisAngle(joint.axis, v)
  return identity()
}

/** Forward kinematics in the robot's own frame (the root link at the origin).
    Returns { links: {name: matrix}, frames: {jointName: matrix} } where a joint's frame is where it sits before it moves. */
export function forwardKinematics(robot, values = {}, index = indexRobot(robot)) {
  const v = resolveValues(robot, values, index)
  const links = { [robot.root]: identity() }
  const frames = {}
  for (const j of index.order) {
    const frame = multiply(links[j.parent], fromOrigin(j.origin))
    frames[j.name] = frame
    links[j.child] = multiply(frame, jointMotion(j, v[j.name] ?? 0))
  }
  return { links, frames, values: v }
}

/** Joints from the root down to `link`, in order root first. */
export function chainTo(robot, link, index = indexRobot(robot)) {
  const chain = []
  for (let j = index.byChild.get(link); j; j = index.byChild.get(j.parent)) chain.unshift(j)
  return chain
}

/** Shortest description of a value for people: degrees for rotation, millimetres for slides. */
export function formatValue(joint, v, digits = 0) {
  if (joint.type === 'prismatic') return `${(v * 1000).toFixed(digits)} mm`
  return `${((v * 180) / Math.PI).toFixed(digits)}°`
}
