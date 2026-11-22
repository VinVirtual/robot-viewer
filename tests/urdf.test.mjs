import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseUrdf, UrdfError } from '../engine/core/urdf.js'
import { PLANAR, oneJoint, WREN, SO100 } from './helpers.mjs'

test('reads links, joints, origins and axes of a simple arm', () => {
  const r = parseUrdf(PLANAR)
  assert.equal(r.name, 'planar')
  assert.equal(r.root, 'base')
  assert.deepEqual(r.links.map((l) => l.name), ['base', 'upper', 'lower', 'tip'])
  const elbow = r.joints.find((j) => j.name === 'elbow')
  assert.deepEqual(elbow.origin, { xyz: [0, 0, 1], rpy: [0, 0, 0] })
  assert.deepEqual(elbow.axis, [0, 1, 0])
  assert.deepEqual([elbow.limit.lower, elbow.limit.upper], [-2.5, 2.5])
  assert.deepEqual(r.warnings, [])
})

test('reads the example robots without warnings', () => {
  const wren = parseUrdf(readFileSync(join(WREN, 'wren.urdf'), 'utf8'))
  assert.equal(wren.joints.length, 8)
  assert.deepEqual(wren.warnings, [])
  const so = parseUrdf(readFileSync(join(SO100, 'so100.urdf'), 'utf8'))
  assert.equal(so.name, 'so_arm100')
  assert.deepEqual(so.joints.map((j) => j.name), ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'])
  assert.deepEqual(so.warnings, [])
})

test('defaults: origin zero, axis 1 0 0', () => {
  const r = parseUrdf(oneJoint('type="revolute"', '<limit lower="-1" upper="1"/>'))
  assert.deepEqual(r.joints[0].origin, { xyz: [0, 0, 0], rpy: [0, 0, 0] })
  assert.deepEqual(r.joints[0].axis, [1, 0, 0])
})

test('axes are normalised to unit length', () => {
  const r = parseUrdf(oneJoint('type="revolute"', '<axis xyz="0 0 2"/><limit lower="-1" upper="1"/>'))
  assert.deepEqual(r.joints[0].axis, [0, 0, 1])
})

test('a moving joint with a zero axis is refused', () => {
  assert.throws(() => parseUrdf(oneJoint('type="revolute"', '<axis xyz="0 0 0"/><limit lower="-1" upper="1"/>')), /zero axis/)
})

test('revolute without <limit> gets -180..180 degrees with a warning; prismatic is locked', () => {
  const r = parseUrdf(oneJoint('type="revolute"'))
  assert.deepEqual([r.joints[0].limit.lower, r.joints[0].limit.upper], [-Math.PI, Math.PI])
  assert.match(r.warnings[0], /no <limit>/)
  const p = parseUrdf(oneJoint('type="prismatic"'))
  assert.deepEqual([p.joints[0].limit.lower, p.joints[0].limit.upper], [0, 0])
  assert.match(p.warnings[0], /locked/)
})

test('lower limit above upper limit is an error', () => {
  assert.throws(() => parseUrdf(oneJoint('type="revolute"', '<limit lower="1" upper="-1"/>')), /lower limit 1 above upper limit -1/)
})

test('continuous joints keep velocity but no position limits', () => {
  const r = parseUrdf(oneJoint('type="continuous"', '<limit lower="-1" upper="1" velocity="3"/>'))
  assert.equal(r.joints[0].limit.lower, null)
  assert.equal(r.joints[0].limit.velocity, 3)
})

test('floating and planar joints are shown as fixed, with a warning', () => {
  const r = parseUrdf(oneJoint('type="floating"'))
  assert.equal(r.joints[0].type, 'fixed')
  assert.match(r.warnings[0], /floating; it is shown as fixed/)
})

test('unknown joint type is an error', () => {
  assert.throws(() => parseUrdf(oneJoint('type="ball"')), /type "ball"/)
})

test('malformed numbers are reported and replaced', () => {
  const r = parseUrdf(oneJoint('type="revolute"', '<origin xyz="0 zero 1"/><limit lower="-1" upper="1"/>'))
  assert.deepEqual(r.joints[0].origin.xyz, [0, 0, 0])
  assert.match(r.warnings[0], /origin xyz is "0 zero 1"/)
})

test('unexpanded xacro expressions get a hint', () => {
  const r = parseUrdf(oneJoint('type="revolute"', '<origin xyz="0 0 ${l}"/><limit lower="-1" upper="1"/>'))
  assert.match(r.warnings[0], /xacro/)
})

test('a xacro file is refused with the command to run', () => {
  assert.throws(() => parseUrdf('<robot name="x" xmlns:xacro="http://www.ros.org/wiki/xacro"><xacro:macro name="m"/><link name="a"/></robot>'), /run `xacro/)
})

test('mimic joints are read with multiplier and offset', () => {
  const r = parseUrdf(readFileSync(join(WREN, 'wren.urdf'), 'utf8'))
  const m = r.joints.find((j) => j.name === 'gripper_mirror')
  assert.deepEqual(m.mimic, { joint: 'gripper', multiplier: 1, offset: 0 })
})

test('mimic of a missing joint, and mimic loops, are errors', () => {
  const base = (a, b) => `<robot name="m"><link name="r"/><link name="x"/><link name="y"/>
    <joint name="a" type="revolute"><parent link="r"/><child link="x"/><limit lower="-1" upper="1"/>${a}</joint>
    <joint name="b" type="revolute"><parent link="r"/><child link="y"/><limit lower="-1" upper="1"/>${b}</joint></robot>`
  assert.throws(() => parseUrdf(base('<mimic joint="nope"/>', '')), /mimics "nope", which does not exist/)
  assert.throws(() => parseUrdf(base('<mimic joint="b"/>', '<mimic joint="a"/>')), /mimic each other in a loop/)
})

test('two root links are an error that names them', () => {
  assert.throws(() => parseUrdf('<robot name="x"><link name="a"/><link name="b"/></robot>'), /2 separate parts \(root links: a, b\)/)
})

test('a link with two parents (closed loop) is an error', () => {
  const t = `<robot name="x"><link name="a"/><link name="b"/><link name="c"/>
    <joint name="j1" type="fixed"><parent link="a"/><child link="c"/></joint>
    <joint name="j2" type="fixed"><parent link="b"/><child link="c"/></joint></robot>`
  assert.throws(() => parseUrdf(t), /two parent joints/)
})

test('joints that refer to missing links are errors', () => {
  assert.throws(() => parseUrdf('<robot name="x"><link name="a"/><joint name="j" type="fixed"><parent link="a"/><child link="ghost"/></joint></robot>'), /link "ghost", which does not exist/)
})

test('duplicate link and joint names are errors', () => {
  assert.throws(() => parseUrdf('<robot name="x"><link name="a"/><link name="a"/></robot>'), /defined twice/)
})

test('DOCTYPE and ENTITY declarations are refused', () => {
  const bomb = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><robot name="&b;"><link name="a"/></robot>'
  assert.throws(() => parseUrdf(bomb), (e) => e instanceof UrdfError && /DOCTYPE or ENTITY/.test(e.message))
})

test('not XML, wrong root, empty robot and non-text input are errors', () => {
  assert.throws(() => parseUrdf('<robot><link name="a">'), /not well-formed XML/)
  assert.throws(() => parseUrdf('<sdf/>'), /root element is <sdf>/)
  assert.throws(() => parseUrdf('<robot name="x"/>'), /no <link>/)
  assert.throws(() => parseUrdf(42), /must be text/)
})

test('very large files are refused before parsing', () => {
  assert.throws(() => parseUrdf('<robot>' + ' '.repeat(9 * 1024 * 1024) + '</robot>'), /larger than 8 MB/)
})

test('visual materials: inline colour, named colour, unknown name falls back with a warning', () => {
  const t = `<robot name="c"><material name="red"><color rgba="1 0 0 1"/></material>
    <link name="a">
      <visual><geometry><box size="1 1 1"/></geometry><material name="red"/></visual>
      <visual><geometry><sphere radius="1"/></geometry><material name="x"><color rgba="0 1 0 0.5"/></material></visual>
      <visual><geometry><sphere radius="1"/></geometry><material name="nope"/></visual>
    </link></robot>`
  const r = parseUrdf(t)
  assert.deepEqual(r.links[0].visuals.map((v) => v.color), [[1, 0, 0, 1], [0, 1, 0, 0.5], null])
  assert.match(r.warnings[0], /material "nope", which is not defined/)
})

test('mesh scale accepts one or three numbers; unknown shapes are skipped with a warning', () => {
  const t = `<robot name="s"><link name="a">
      <visual><geometry><mesh filename="a.stl" scale="0.001"/></geometry></visual>
      <visual><geometry><mesh filename="b.stl" scale="1 2 3"/></geometry></visual>
      <visual><geometry><capsule radius="1" length="2"/></geometry></visual>
    </link></robot>`
  const r = parseUrdf(t)
  assert.deepEqual(r.links[0].visuals.map((v) => v.geometry.scale), [[0.001, 0.001, 0.001], [1, 2, 3]])
  assert.match(r.warnings[0], /<capsule> shape, which is not supported/)
})
