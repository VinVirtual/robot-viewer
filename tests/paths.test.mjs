import { test } from 'node:test'
import assert from 'node:assert/strict'
import { symlinkSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveMeshPath, PathError } from '../engine/lib/paths.js'
import { tempDir, writeFiles } from './helpers.mjs'

function layout(t) {
  const root = tempDir(t)
  writeFiles(root, { 'pkg/urdf/r.urdf': '<robot/>', 'pkg/meshes/a.stl': 'x', 'pkg/urdf/meshes/b.obj': 'x', 'outside/secret.stl': 'x', 'pkg/meshes/model.glb': 'x' })
  return { root, urdfDir: join(root, 'pkg', 'urdf'), pkgDir: join(root, 'pkg') }
}

test('relative paths resolve inside the URDF folder', (t) => {
  const { urdfDir } = layout(t)
  assert.equal(resolveMeshPath('meshes/b.obj', { urdfDir }), join(urdfDir, 'meshes', 'b.obj'))
})

test('package:// resolves in the package folder, or one folder up from the URDF', (t) => {
  const { urdfDir, pkgDir } = layout(t)
  assert.equal(resolveMeshPath('package://pkg/meshes/a.stl', { urdfDir, packageDir: pkgDir }), join(pkgDir, 'meshes', 'a.stl'))
  assert.equal(resolveMeshPath('package://pkg/meshes/a.stl', { urdfDir }), join(pkgDir, 'meshes', 'a.stl'))
})

test('climbing out with .. is refused', (t) => {
  const { urdfDir } = layout(t)
  assert.throws(() => resolveMeshPath('../../outside/secret.stl', { urdfDir }), /leads outside/)
  assert.throws(() => resolveMeshPath('package://pkg/../../outside/secret.stl', { urdfDir }), /leads outside|not found/)
})

test('absolute paths, file:// and http(s) URLs are refused', (t) => {
  const { urdfDir, root } = layout(t)
  assert.throws(() => resolveMeshPath(join(root, 'outside', 'secret.stl'), { urdfDir }), /absolute path/)
  assert.throws(() => resolveMeshPath('file:///etc/passwd.stl', { urdfDir }), /URL scheme/)
  assert.throws(() => resolveMeshPath('https://example.org/a.stl', { urdfDir }), /URL scheme/)
  assert.throws(() => resolveMeshPath('C:\\meshes\\a.stl', { urdfDir }), /URL scheme|absolute/)
})

test('a symbolic link that points outside is refused', (t) => {
  const { urdfDir, root } = layout(t)
  symlinkSync(join(root, 'outside', 'secret.stl'), join(urdfDir, 'meshes', 'link.stl'))
  assert.throws(() => resolveMeshPath('meshes/link.stl', { urdfDir }), /leads outside/)
})

test('unsupported formats, missing files, folders and empty names are refused with reasons', (t) => {
  const { urdfDir, pkgDir } = layout(t)
  mkdirSync(join(urdfDir, 'dir.stl'))
  assert.throws(() => resolveMeshPath('package://pkg/meshes/model.glb', { urdfDir, packageDir: pkgDir }), /\.glb file; supported meshes are \.stl, \.obj, \.dae/)
  assert.throws(() => resolveMeshPath('meshes/missing.stl', { urdfDir }), /not found/)
  assert.throws(() => resolveMeshPath('dir.stl', { urdfDir }), /not a file/)
  assert.throws(() => resolveMeshPath('  ', { urdfDir }), PathError)
  assert.throws(() => resolveMeshPath('a\0.stl', { urdfDir }), /null byte/)
})

test('extensions are matched without regard to case', (t) => {
  const { urdfDir } = layout(t)
  writeFileSync(join(urdfDir, 'UP.STL'), 'x')
  assert.equal(resolveMeshPath('UP.STL', { urdfDir }), join(urdfDir, 'UP.STL'))
})

test('package:// without --package only works when a nearby folder has the package name', (t) => {
  const root = tempDir(t)
  writeFiles(root, { 'repo/urdf/r.urdf': '<robot/>', 'repo/meshes/a.stl': 'x', 'repo/other/b.stl': 'x' })
  const urdfDir = join(root, 'repo', 'urdf')
  assert.throws(() => resolveMeshPath('package://robot_description/meshes/a.stl', { urdfDir }), /pass --package/)
  assert.throws(() => resolveMeshPath('package://repo2/other/b.stl', { urdfDir }), /pass --package/)
  assert.equal(resolveMeshPath('package://robot_description/meshes/a.stl', { urdfDir, packageDir: join(root, 'repo') }), join(root, 'repo', 'meshes', 'a.stl'))
})

test('the usual ../meshes/ layout is refused with a hint to pass --package, and works with it', (t) => {
  const { urdfDir, pkgDir } = layout(t)
  assert.throws(() => resolveMeshPath('../meshes/a.stl', { urdfDir }), /pass --package/)
  assert.equal(resolveMeshPath('../meshes/a.stl', { urdfDir, packageDir: pkgDir }), join(pkgDir, 'meshes', 'a.stl'))
})
