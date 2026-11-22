// Shared fixtures for the tests.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const WREN = join(ROOT, 'examples', 'wren')
export const SO100 = join(ROOT, 'examples', 'so100')

export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'robot-viewer-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

export function writeFiles(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  return dir
}

/** A two-link planar arm in the X-Z plane: shoulder at the origin turning about Y, links 1 m and 0.8 m. */
export const PLANAR = `<?xml version="1.0"?>
<robot name="planar">
  <link name="base"/>
  <link name="upper"><visual><geometry><box size="0.1 0.1 1"/></geometry></visual></link>
  <link name="lower"><visual><geometry><cylinder radius="0.05" length="0.8"/></geometry></visual></link>
  <link name="tip"/>
  <joint name="shoulder" type="revolute"><parent link="base"/><child link="upper"/><axis xyz="0 1 0"/><limit lower="-3" upper="3"/></joint>
  <joint name="elbow" type="revolute"><parent link="upper"/><child link="lower"/><origin xyz="0 0 1"/><axis xyz="0 1 0"/><limit lower="-2.5" upper="2.5"/></joint>
  <joint name="tip_frame" type="fixed"><parent link="lower"/><child link="tip"/><origin xyz="0 0 0.8"/></joint>
</robot>`

/** URDF text with one joint and the given attributes, for limit and type tests. */
export const oneJoint = (joint, extra = '') => `<robot name="one"><link name="a"/><link name="b"/>
  <joint name="j" ${joint}><parent link="a"/><child link="b"/>${extra}</joint></robot>`

export const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
