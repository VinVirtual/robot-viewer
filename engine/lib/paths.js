// Where a URDF mesh reference may point. A URDF from someone else is untrusted input:
// meshes are read only from inside the URDF's folder or the package folder, after following links.
import { realpathSync, existsSync, statSync } from 'node:fs'
import { resolve, sep, extname, isAbsolute, basename, dirname } from 'node:path'
import { MESH_FORMATS } from '../core/urdf.js'

export class PathError extends Error {}

const inside = (dir, file) => file === dir || file.startsWith(dir.endsWith(sep) ? dir : dir + sep)
const HINT = 'if the meshes sit in the package folder above the URDF (the usual urdf/ + meshes/ layout), pass --package <that folder>'

/** The folder that package://<name>/ means, when --package is not given: the URDF's own folder or the one above it,
    and only when that folder is called <name>. Otherwise null, and the caller must ask for --package. */
export function guessPackageRoot(urdfDir, name) {
  for (const dir of [urdfDir, dirname(urdfDir)]) if (basename(dir) === name && existsSync(dir)) return dir
  return null
}

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
  const both = (d) => [resolve(d), realpathSync(d)]
  const roots = both(urdfDir)
  if (packageDir) roots.push(...both(packageDir))
  let candidate
  const pkg = /^package:\/\/([^/]+)\/(.+)$/.exec(name)
  if (pkg) {
    const root = packageDir || guessPackageRoot(urdfDir, pkg[1])
    if (!root) throw new PathError(`"${name}" names package "${pkg[1]}", but neither the URDF's folder nor the one above it is called "${pkg[1]}"; pass --package <the folder of package ${pkg[1]}>`)
    if (!packageDir) roots.push(...both(root))
    candidate = resolve(root, pkg[2])
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(name)) {
    throw new PathError(`"${name}" uses a URL scheme; only relative paths and package:// are read`)
  } else if (isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name)) {
    throw new PathError(`"${name}" is an absolute path; use a path relative to the URDF`)
  } else {
    candidate = resolve(urdfDir, name)
  }
  const ext = extname(name).slice(1).toLowerCase()
  if (!MESH_FORMATS.includes(ext)) throw new PathError(`"${name}" is a .${ext || '?'} file; supported meshes are ${MESH_FORMATS.map((e) => '.' + e).join(', ')}`)
  const outside = () => new PathError(`"${name}" leads outside the URDF${packageDir ? ' and package' : ''} folder${packageDir ? 's' : ''}; refused (${HINT})`)
  if (!roots.some((r) => inside(r, resolve(candidate)))) throw outside()
  if (!existsSync(candidate)) throw new PathError(`"${name}" was not found (looked for ${candidate})`)
  const real = realpathSync(candidate)
  // after following links, the file must still be inside a real root folder
  if (!roots.filter((r) => r === realpathSync(r)).some((r) => inside(r, real))) throw outside()
  if (!statSync(real).isFile()) throw new PathError(`"${name}" is not a file`)
  return real
}
