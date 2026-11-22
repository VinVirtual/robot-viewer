// Where a URDF mesh reference may point. A URDF from someone else is untrusted input:
// meshes are read only from inside the URDF's folder or the package folder, after following links.
import { realpathSync, existsSync, statSync } from 'node:fs'
import { resolve, sep, extname, isAbsolute } from 'node:path'
import { MESH_FORMATS } from '../core/urdf.js'

export class PathError extends Error {}

const inside = (dir, file) => file === dir || file.startsWith(dir.endsWith(sep) ? dir : dir + sep)

/**
 * Resolve a mesh filename from a URDF.
 * @param {string} filename as written in the URDF (relative, or package://name/rest)
 * @param {{ urdfDir: string, packageDir?: string }} roots
 * @returns {string} absolute real path of an existing mesh file
 */
export function resolveMeshPath(filename, { urdfDir, packageDir } = {}) {
  if (typeof filename !== 'string' || !filename.trim()) throw new PathError('empty mesh filename')
  const name = filename.trim()
  if (name.includes('\0')) throw new PathError(`"${name}" contains a null byte`)
  let candidates
  const pkg = /^package:\/\/([^/]+)\/(.+)$/.exec(name)
  if (pkg) {
    const rest = pkg[2]
    candidates = [packageDir && resolve(packageDir, rest), resolve(urdfDir, rest), resolve(urdfDir, '..', rest)].filter(Boolean)
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(name)) {
    throw new PathError(`"${name}" uses a URL scheme; only relative paths and package:// are read`)
  } else if (isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name)) {
    throw new PathError(`"${name}" is an absolute path; use a path relative to the URDF`)
  } else {
    candidates = [resolve(urdfDir, name)]
  }
  const ext = extname(name).slice(1).toLowerCase()
  if (!MESH_FORMATS.includes(ext)) throw new PathError(`"${name}" is a .${ext || '?'} file; supported meshes are ${MESH_FORMATS.map((e) => '.' + e).join(', ')}`)
  const roots = [urdfDir, packageDir].filter(Boolean).map((d) => realpathSync(d))
  // package:// may also look one folder up from the URDF (the usual urdf/ + meshes/ layout), when that folder is the package
  if (pkg && !packageDir) roots.push(realpathSync(resolve(urdfDir, '..')))
  for (const c of candidates) {
    if (!existsSync(c)) continue
    const real = realpathSync(c)
    if (!roots.some((r) => inside(r, real))) throw new PathError(`"${name}" leads outside the URDF and package folders; refused`)
    if (!statSync(real).isFile()) throw new PathError(`"${name}" is not a file`)
    return real
  }
  throw new PathError(`"${name}" was not found${pkg ? ` (looked in ${candidates.join(', ')}; pass --package <folder> if the package lives elsewhere)` : ''}`)
}
