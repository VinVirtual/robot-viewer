// Small 4x4 matrix and vector helpers for rigid transforms. Pure functions, no three.js.
// Matrices are 16-number arrays in column-major order (the same layout as three.js and WebGL).
// Every function returns a new array and never changes its inputs.

export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** a times b */
export function multiply(a, b) {
  const out = new Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
  }
  return out
}

/** Rotation from URDF roll, pitch, yaw: fixed axes X then Y then Z, so R = Rz(yaw) * Ry(pitch) * Rx(roll). */
export function fromRpy([roll, pitch, yaw]) {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw)
  // rows of R
  const r00 = cy * cp, r01 = cy * sp * sr - sy * cr, r02 = cy * sp * cr + sy * sr
  const r10 = sy * cp, r11 = sy * sp * sr + cy * cr, r12 = sy * sp * cr - cy * sr
  const r20 = -sp, r21 = cp * sr, r22 = cp * cr
  return [r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, 0, 0, 0, 1]
}

export const translation = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]

/** The transform of a URDF <origin xyz rpy>. */
export const fromOrigin = (origin) => {
  const m = fromRpy(origin?.rpy || [0, 0, 0])
  const [x, y, z] = origin?.xyz || [0, 0, 0]
  m[12] = x; m[13] = y; m[14] = z
  return m
}

/** Rotation of `angle` radians about a unit `axis` (Rodrigues). */
export function axisAngle([x, y, z], angle) {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ]
}

export const transformPoint = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

export const rotateVector = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z,
  m[1] * x + m[5] * y + m[9] * z,
  m[2] * x + m[6] * y + m[10] * z,
]

export const position = (m) => [m[12], m[13], m[14]]

/** Inverse of a rotation-plus-translation matrix (no scale). */
export function invertRigid(m) {
  const out = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1]
  const [x, y, z] = [m[12], m[13], m[14]]
  out[12] = -(out[0] * x + out[4] * y + out[8] * z)
  out[13] = -(out[1] * x + out[5] * y + out[9] * z)
  out[14] = -(out[2] * x + out[6] * y + out[10] * z)
  return out
}

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const length = (a) => Math.hypot(a[0], a[1], a[2])
export const distance = (a, b) => length(sub(a, b))
export function normalize(a) {
  const l = length(a)
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

/** Quaternion [x, y, z, w] of a rotation matrix (upper 3x3 of m). */
export function toQuaternion(m) {
  const m00 = m[0], m01 = m[4], m02 = m[8], m10 = m[1], m11 = m[5], m12 = m[9], m20 = m[2], m21 = m[6], m22 = m[10]
  const trace = m00 + m11 + m22
  let x, y, z, w
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s
  }
  const l = Math.hypot(x, y, z, w)
  return [x / l, y / l, z / l, w / l]
}
