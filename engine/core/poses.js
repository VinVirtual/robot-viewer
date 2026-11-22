// Named poses: read a poses JSON, check every value against the robot, and return values in radians and metres.
// Format: { "units": "deg" | "rad", "default": "home", "poses": { "home": { "joint": value, ... }, ... } }
// Prismatic (sliding) joints are always metres. Joints a pose does not name are at 0 in that pose.
import { MOVING, jointRange } from './kinematics.js'

export const POSE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/
export const MAX_POSES = 16
const EPS = 1e-6

/** Closest name by edit distance, for "did you mean" hints. */
export function closest(name, options) {
  let best = null, bestD = Infinity
  for (const o of options) {
    const a = name.toLowerCase(), b = o.toLowerCase()
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
    for (let j = 1; j <= b.length; j++) d[0][j] = j
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    const dist = d[a.length][b.length]
    if (dist < bestD) { bestD = dist; best = o }
  }
  return best && bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : null
}

const show = (joint, v, deg) => (joint.type === 'prismatic' ? `${+v.toFixed(4)} m` : deg ? `${+((v * 180) / Math.PI).toFixed(2)}°` : `${+v.toFixed(4)} rad`)

/**
 * @param {unknown} input parsed poses JSON
 * @param {{ joints: object[] }} robot
 * @param {{ clamp?: boolean }} options clamp: pull values beyond a limit back inside with a warning instead of an error
 * @returns {{ poses: Record<string, Record<string, number>>, order: string[], defaultPose: string|null, errors: string[], warnings: string[] }}
 */
export function validatePoses(input, robot, { clamp = false } = {}) {
  const errors = [], warnings = []
  const result = (poses = {}, order = [], defaultPose = null) => ({ poses, order, defaultPose, errors, warnings })
  if (input === undefined || input === null) return result()
  if (typeof input !== 'object' || Array.isArray(input)) { errors.push('poses file must be a JSON object like { "units": "deg", "poses": { "home": { ... } } }'); return result() }
  for (const k of Object.keys(input)) if (!['units', 'default', 'poses', '$schema', 'note'].includes(k)) warnings.push(`unknown field "${k}" in the poses file is ignored`)
  const units = input.units ?? 'deg'
  if (units !== 'deg' && units !== 'rad') { errors.push(`"units" is "${units}"; use "deg" or "rad"`); return result() }
  const deg = units === 'deg'
  const raw = input.poses
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push('"poses" must be an object of named poses'); return result() }
  const names = Object.keys(raw)
  if (names.length > MAX_POSES) errors.push(`${names.length} poses; at most ${MAX_POSES} fit as buttons`)
  const byName = new Map(robot.joints.map((j) => [j.name, j]))
  const jointNames = [...byName.keys()]
  const poses = {}
  for (const name of names) {
    if (!POSE_NAME.test(name)) { errors.push(`pose name "${name}" must be 1 to 32 letters, digits, spaces, "-" or "_", starting with a letter or digit`); continue }
    const values = raw[name]
    if (!values || typeof values !== 'object' || Array.isArray(values)) { errors.push(`pose "${name}" must be an object of { "joint": value }`); continue }
    const out = {}
    for (const [jn, v] of Object.entries(values)) {
      const j = byName.get(jn)
      if (!j) { const hint = closest(jn, jointNames); errors.push(`pose "${name}": no joint "${jn}"${hint ? ` (did you mean "${hint}"?)` : ''}`); continue }
      if (!MOVING.has(j.type)) { errors.push(`pose "${name}": joint "${jn}" is ${j.type} and cannot move`); continue }
      if (j.mimic) { errors.push(`pose "${name}": joint "${jn}" follows "${j.mimic.joint}" (mimic); set "${j.mimic.joint}" instead`); continue }
      if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`pose "${name}": joint "${jn}" must be a number, not ${JSON.stringify(v)}`); continue }
      let value = j.type === 'prismatic' || !deg ? v : (v * Math.PI) / 180
      const [lo, hi] = jointRange(j)
      if (j.type !== 'continuous' && (value < lo - EPS || value > hi + EPS)) {
        const msg = `pose "${name}": joint "${jn}" = ${show(j, value, deg)} is outside its limits ${show(j, lo, deg)} to ${show(j, hi, deg)}`
        if (clamp) { warnings.push(`${msg}; clamped`); value = Math.min(hi, Math.max(lo, value)) } else { errors.push(msg); continue }
      }
      out[jn] = Math.min(hi, Math.max(lo, value))
    }
    poses[name] = out
  }
  let defaultPose = input.default ?? null
  if (defaultPose !== null && !(defaultPose in raw)) { errors.push(`"default" is "${defaultPose}", which is not one of the poses (${names.join(', ') || 'none'})`); defaultPose = null }
  return result(poses, names.filter((n) => n in poses), defaultPose ?? (names.find((n) => n in poses) || null))
}
