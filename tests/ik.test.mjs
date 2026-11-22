import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseUrdf } from '../engine/core/urdf.js'
import { solveCCD } from '../engine/core/ik.js'
import { forwardKinematics, jointRange } from '../engine/core/kinematics.js'
import { transformPoint, distance } from '../engine/core/mat.js'
import { PLANAR, WREN, oneJoint } from './helpers.mjs'

const planar = parseUrdf(PLANAR)
const wren = parseUrdf(readFileSync(join(WREN, 'wren.urdf'), 'utf8'))
const tip = (robot, v, link, point = [0, 0, 0]) => transformPoint(forwardKinematics(robot, v).links[link], point)

test('reaches a reachable point on a two-link arm', () => {
  const target = tip(planar, { shoulder: 0.7, elbow: 1.1 }, 'tip')
  const r = solveCCD(planar, {}, { link: 'tip', target, iterations: 200, tolerance: 1e-5 })
  assert.ok(r.reached, `error ${r.error}`)
  assert.ok(distance(tip(planar, r.values, 'tip'), target) < 1e-4)
  assert.deepEqual(r.chain, ['shoulder', 'elbow'])
})

test('an out-of-reach target stretches the arm toward it', () => {
  const r = solveCCD(planar, {}, { link: 'tip', target: [5, 0, 0], iterations: 60 })
  assert.equal(r.reached, false)
  const p = tip(planar, r.values, 'tip')
  assert.ok(Math.abs(r.error - (5 - 1.8)) < 1e-3, `error ${r.error}`)
  assert.ok(p[0] > 1.79)
})

test('joint limits always hold', () => {
  const tight = parseUrdf(PLANAR.replace('lower="-3" upper="3"', 'lower="-0.2" upper="0.2"'))
  const r = solveCCD(tight, {}, { link: 'tip', target: [1.8, 0, 0], iterations: 50 })
  assert.ok(Math.abs(r.values.shoulder) <= 0.2 + 1e-12)
  assert.ok(Math.abs(r.values.elbow) <= 2.5 + 1e-12)
})

test('a point offset on the link is moved, not the link origin', () => {
  const point = [0, 0, 0.4]
  const target = tip(planar, { shoulder: -0.5, elbow: 0.9 }, 'lower', point)
  const r = solveCCD(planar, {}, { link: 'lower', point, target, iterations: 200, tolerance: 1e-5 })
  assert.ok(r.reached)
})

test('does not change the values passed in', () => {
  const start = { shoulder: 0.1, elbow: 0.2 }
  solveCCD(planar, start, { link: 'tip', target: [1, 0, 1] })
  assert.deepEqual(start, { shoulder: 0.1, elbow: 0.2 })
})

test('slides prismatic joints along their axis', () => {
  const slider = parseUrdf(oneJoint('type="prismatic"', '<axis xyz="1 0 0"/><limit lower="0" upper="0.5"/>'))
  const r = solveCCD(slider, {}, { link: 'b', target: [0.3, 0, 0] })
  assert.ok(Math.abs(r.values.j - 0.3) < 1e-9)
  const far = solveCCD(slider, {}, { link: 'b', target: [2, 0, 0] })
  assert.equal(far.values.j, 0.5)
})

test('skips mimic, fixed and locked joints; mimic joints still follow', () => {
  const r = solveCCD(wren, { gripper: 0.01 }, { link: 'finger_left', target: [0.2, 0.05, 0.3], locked: ['base_yaw'] })
  assert.ok(!r.chain.includes('gripper_mirror'))
  assert.ok(!r.chain.includes('base_yaw'))
  assert.equal(r.values.base_yaw, 0)
  assert.equal(r.values.gripper_mirror, r.values.gripper)
  for (const j of wren.joints) if (j.limit && j.limit.lower !== null) {
    const [lo, hi] = jointRange(j)
    assert.ok(r.values[j.name] === undefined || (r.values[j.name] >= lo && r.values[j.name] <= hi), j.name)
  }
})

test('moves the Wren hand closer to a target in front of it', () => {
  const start = { shoulder: -0.2, elbow: 2, wrist_pitch: 1.2 }
  const target = [0.3, 0.1, 0.15]
  const before = distance(tip(wren, start, 'hand'), target)
  const r = solveCCD(wren, start, { link: 'hand', target, iterations: 30 })
  assert.ok(r.error < before / 4, `${r.error} vs ${before}`)
})

test('maxStep limits how far one step turns a joint', () => {
  const r = solveCCD(planar, {}, { link: 'tip', target: [0, 0, -1.8], iterations: 1, maxStep: 0.1 })
  assert.ok(Math.abs(r.values.shoulder) <= 0.1 + 1e-12 && Math.abs(r.values.elbow) <= 0.1 + 1e-12)
})

test('bad goals are refused', () => {
  assert.throws(() => solveCCD(planar, {}, { link: 'nope', target: [0, 0, 0] }), /unknown link/)
  assert.throws(() => solveCCD(planar, {}, { link: 'tip', target: [0, NaN, 0] }), /three finite numbers/)
  assert.throws(() => solveCCD(planar, {}, { link: 'tip', target: [0, 0] }), /three finite numbers/)
})
