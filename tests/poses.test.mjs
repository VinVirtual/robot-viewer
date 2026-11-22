import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseUrdf } from '../engine/core/urdf.js'
import { validatePoses, closest, MAX_POSES } from '../engine/core/poses.js'
import { WREN, SO100, near } from './helpers.mjs'

const wren = parseUrdf(readFileSync(join(WREN, 'wren.urdf'), 'utf8'))
const so100 = parseUrdf(readFileSync(join(SO100, 'so100.urdf'), 'utf8'))
const check = (input, o) => validatePoses(input, wren, o)

test('the example poses files are valid', () => {
  const w = validatePoses(JSON.parse(readFileSync(join(WREN, 'poses.json'), 'utf8')), wren)
  assert.deepEqual(w.errors, [])
  assert.deepEqual(w.order, ['home', 'reach', 'wave', 'inspect'])
  assert.equal(w.defaultPose, 'home')
  const s = validatePoses(JSON.parse(readFileSync(join(SO100, 'poses.json'), 'utf8')), so100)
  assert.deepEqual(s.errors, [])
  assert.equal(s.defaultPose, 'ready')
})

test('degrees become radians; sliding joints stay in metres', () => {
  const r = check({ units: 'deg', poses: { a: { shoulder: 90, gripper: 0.02 } } })
  assert.ok(near(r.poses.a.shoulder, Math.PI / 2))
  assert.equal(r.poses.a.gripper, 0.02)
})

test('radians are taken as they are', () => {
  const r = check({ units: 'rad', poses: { a: { elbow: 1.5 } } })
  assert.equal(r.poses.a.elbow, 1.5)
})

test('values beyond a limit are errors that show the limits in the file units', () => {
  const r = check({ poses: { a: { shoulder: 120 } } })
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /pose "a": joint "shoulder" = 120° is outside its limits -99.98° to 99.98°/)
})

test('with clamp, values beyond a limit are pulled in with a warning', () => {
  const r = check({ poses: { a: { gripper: 0.5 } } }, { clamp: true })
  assert.deepEqual(r.errors, [])
  assert.equal(r.poses.a.gripper, 0.026)
  assert.match(r.warnings[0], /clamped/)
})

test('a value exactly on a limit is accepted (rounding in degrees is tolerated)', () => {
  const r = check({ units: 'rad', poses: { a: { shoulder: 1.745, elbow: -2.53 } } })
  assert.deepEqual(r.errors, [])
})

test('unknown joints get a did-you-mean', () => {
  const r = check({ poses: { a: { sholder: 10 } } })
  assert.match(r.errors[0], /no joint "sholder" \(did you mean "shoulder"\?\)/)
  const s = check({ poses: { a: { zzzzzz: 10 } } })
  assert.doesNotMatch(s.errors[0], /did you mean/)
})

test('fixed joints and mimic joints cannot be posed', () => {
  const r = check({ poses: { a: { tool_frame: 0, gripper_mirror: 0.01 } } })
  assert.match(r.errors[0], /"tool_frame" is fixed and cannot move/)
  assert.match(r.errors[1], /"gripper_mirror" follows "gripper" \(mimic\); set "gripper" instead/)
})

test('values must be numbers, not strings or null', () => {
  const r = check({ poses: { a: { shoulder: '10', elbow: null, wrist_pitch: Infinity } } })
  assert.equal(r.errors.length, 3)
  assert.match(r.errors[0], /must be a number, not "10"/)
})

test('continuous joints accept any angle', () => {
  const r = check({ poses: { a: { wrist_roll: 720 } } })
  assert.deepEqual(r.errors, [])
})

test('pose names are checked (they become button labels)', () => {
  const r = check({ poses: { '<img src=x>': {}, '': {}, 'ok name-1': {} } })
  assert.equal(r.errors.length, 2)
  assert.deepEqual(r.order, ['ok name-1'])
})

test('default must name a pose; without one the first pose is used', () => {
  assert.match(check({ default: 'nope', poses: { a: {} } }).errors[0], /"default" is "nope"/)
  assert.equal(check({ poses: { b: {}, a: {} } }).defaultPose, 'b')
})

test('wrong shapes and units are reported', () => {
  assert.match(check([]).errors[0], /must be a JSON object/)
  assert.match(check({ poses: [] }).errors[0], /"poses" must be an object/)
  assert.match(check({ units: 'grad', poses: {} }).errors[0], /use "deg" or "rad"/)
  assert.match(check({ poses: { a: [1, 2] } }).errors[0], /must be an object/)
  assert.match(check({ pose: {}, poses: {} }).warnings[0], /unknown field "pose"/)
})

test('too many poses for the button row is an error', () => {
  const poses = Object.fromEntries(Array.from({ length: MAX_POSES + 1 }, (_, i) => [`p${i}`, {}]))
  assert.match(check({ poses }).errors[0], /at most 16/)
})

test('no poses file means no poses', () => {
  assert.deepEqual(validatePoses(undefined, wren), { poses: {}, order: [], defaultPose: null, errors: [], warnings: [] })
})

test('closest name finds small typos only', () => {
  assert.equal(closest('elbo', ['elbow', 'wrist']), 'elbow')
  assert.equal(closest('banana', ['elbow', 'wrist']), null)
})
