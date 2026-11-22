import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseUrdf } from '../engine/core/urdf.js'
import { forwardKinematics, resolveValues, jointRange, clampJoint, wrapAngle, controllableJoints, chainTo, formatValue } from '../engine/core/kinematics.js'
import { fromRpy, transformPoint, multiply, invertRigid, identity, toQuaternion, axisAngle } from '../engine/core/mat.js'
import { PLANAR, WREN, near } from './helpers.mjs'

const planar = parseUrdf(PLANAR)
const wren = parseUrdf(readFileSync(join(WREN, 'wren.urdf'), 'utf8'))
const tipOf = (values) => transformPoint(forwardKinematics(planar, values).links.tip, [0, 0, 0])

test('URDF rpy is fixed-axis X then Y then Z: yaw 90 degrees turns +X into +Y', () => {
  const p = transformPoint(fromRpy([0, 0, Math.PI / 2]), [1, 0, 0])
  assert.ok(near(p[0], 0) && near(p[1], 1) && near(p[2], 0))
  // roll then pitch about fixed axes: Rz*Ry*Rx applied to +Y
  const q = transformPoint(fromRpy([Math.PI / 2, Math.PI / 2, 0]), [0, 1, 0])
  assert.ok(near(q[0], 1) && near(q[1], 0) && near(q[2], 0))
})

test('rigid inverse undoes the transform', () => {
  const m = multiply(fromRpy([0.3, -0.7, 1.1]), axisAngle([0, 0, 1], 0.4))
  m[12] = 1; m[13] = -2; m[14] = 0.5
  const back = multiply(invertRigid(m), m)
  identity().forEach((v, i) => assert.ok(near(back[i], v, 1e-9)))
})

test('quaternion of a rotation matrix rotates the same way', () => {
  const q = toQuaternion(axisAngle([0, 0, 1], Math.PI / 2))
  assert.ok(near(q[2], Math.SQRT1_2) && near(q[3], Math.SQRT1_2))
})

test('forward kinematics: straight arm points up, bent arm reaches forward', () => {
  const up = tipOf({})
  assert.ok(near(up[0], 0) && near(up[2], 1.8))
  const bent = tipOf({ shoulder: Math.PI / 2, elbow: 0 })
  assert.ok(near(bent[0], 1.8) && near(bent[2], 0))
  const elbow = tipOf({ shoulder: 0, elbow: Math.PI / 2 })
  assert.ok(near(elbow[0], 0.8) && near(elbow[2], 1))
})

test('values beyond limits are clamped, unknown names ignored, inputs not changed', () => {
  const input = { shoulder: 10, elbow: -10, ghost: 3 }
  const v = resolveValues(planar, input)
  assert.deepEqual(v, { shoulder: 3, elbow: -2.5 })
  assert.deepEqual(input, { shoulder: 10, elbow: -10, ghost: 3 })
})

test('mimic joints follow their source, inside their own limits', () => {
  const v = resolveValues(wren, { gripper: 0.02 })
  assert.equal(v.gripper_mirror, 0.02)
  const w = resolveValues(wren, { gripper: 0.02, gripper_mirror: 0 })
  assert.equal(w.gripper_mirror, 0.02, 'a mimic value cannot be set directly')
})

test('continuous joints wrap instead of stopping', () => {
  const roll = wren.joints.find((j) => j.name === 'wrist_roll')
  assert.deepEqual(jointRange(roll), [-Math.PI, Math.PI])
  assert.ok(near(clampJoint(roll, Math.PI + 0.5), -Math.PI + 0.5))
  assert.ok(near(wrapAngle(-Math.PI - 0.25), Math.PI - 0.25))
  assert.equal(wrapAngle(Math.PI), Math.PI)
})

test('fixed joints have no range; non-numbers become 0 then clamp', () => {
  const tool = wren.joints.find((j) => j.name === 'tool_frame')
  assert.deepEqual(jointRange(tool), [0, 0])
  const g = wren.joints.find((j) => j.name === 'gripper')
  assert.equal(clampJoint(g, NaN), 0)
  assert.equal(clampJoint(g, 1), 0.026)
})

test('controllable joints leave out fixed and mimic joints', () => {
  assert.deepEqual(controllableJoints(wren).map((j) => j.name), ['base_yaw', 'shoulder', 'elbow', 'wrist_pitch', 'wrist_roll', 'gripper'])
})

test('the chain to a link runs from the root down', () => {
  assert.deepEqual(chainTo(wren, 'hand').map((j) => j.name), ['base_yaw', 'shoulder', 'elbow', 'wrist_pitch', 'wrist_roll'])
  assert.deepEqual(chainTo(wren, 'base'), [])
})

test('values are shown in degrees or millimetres', () => {
  const g = wren.joints.find((j) => j.name === 'gripper')
  assert.equal(formatValue(g, 0.0125, 1), '12.5 mm')
  assert.equal(formatValue(wren.joints[0], Math.PI / 4), '45°')
})
