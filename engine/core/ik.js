// Cyclic coordinate descent (CCD) inverse kinematics: move a point on one link toward a target.
// Pure: joint values in, new joint values out. Positions are in the robot's own frame (metres).
// Each pass walks the chain from the link back to the root and turns (or slides) one joint at a time
// so the point gets as close to the target as that joint alone allows, clamped to its limits.
import { forwardKinematics, chainTo, indexRobot, clampJoint, resolveValues, MOVING } from './kinematics.js'
import { transformPoint, rotateVector, position, sub, dot, cross, distance, scale, length } from './mat.js'

/**
 * @param {object} robot joints-JSON robot
 * @param {Record<string, number>} values current joint values (not changed)
 * @param {{ link: string, point?: number[], target: number[], iterations?: number, tolerance?: number, maxStep?: number, locked?: string[] }} goal
 *   `point` is in the link's own frame (default its origin). `maxStep` caps how far one joint turns per step (radians).
 * @returns {{ values: Record<string, number>, error: number, iterations: number, reached: boolean, chain: string[] }}
 */
export function solveCCD(robot, values, goal, index = indexRobot(robot)) {
  const { link, point = [0, 0, 0], target, iterations = 24, tolerance = 1e-4, maxStep = Infinity, locked = [] } = goal || {}
  if (!index.byChild.has(link) && link !== robot.root) throw new Error(`unknown link "${link}"`)
  if (!Array.isArray(target) || target.length !== 3 || !target.every(Number.isFinite)) throw new Error('target must be three finite numbers')
  const skip = new Set(locked)
  const chain = chainTo(robot, link, index).filter((j) => MOVING.has(j.type) && !j.mimic && !skip.has(j.name))
  let current = resolveValues(robot, values, index)
  const effector = (v) => transformPoint(forwardKinematics(robot, v, index).links[link], point)
  let error = distance(effector(current), target)
  let done = 0
  for (let it = 0; it < iterations && error > tolerance && chain.length; it++) {
    done = it + 1
    for (let k = chain.length - 1; k >= 0; k--) {
      const j = chain[k]
      const fk = forwardKinematics(robot, current, index)
      const frame = fk.frames[j.name]
      const axis = rotateVector(frame, j.axis)
      const p = transformPoint(fk.links[link], point)
      let delta
      if (j.type === 'prismatic') {
        delta = dot(sub(target, p), axis)
      } else {
        const pivot = position(frame)
        // project both directions onto the plane the joint turns in
        const u0 = sub(p, pivot), v0 = sub(target, pivot)
        const u = sub(u0, scale(axis, dot(u0, axis))), v = sub(v0, scale(axis, dot(v0, axis)))
        if (length(u) < 1e-9 || length(v) < 1e-9) continue
        delta = Math.atan2(dot(axis, cross(u, v)), dot(u, v))
        delta = Math.max(-maxStep, Math.min(maxStep, delta))
      }
      const next = clampJoint(j, current[j.name] + delta)
      if (next !== current[j.name]) current = resolveValues(robot, { ...current, [j.name]: next }, index)
    }
    error = distance(effector(current), target)
  }
  return { values: current, error, iterations: done, reached: error <= tolerance, chain: chain.map((j) => j.name) }
}
