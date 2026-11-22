// Writing into an output folder that may hold files left by someone else: never follow a symbolic link
// placed where an output file goes, and never leave a half-written file behind (write a temp file, then rename).
import { writeFileSync, renameSync, lstatSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

/** Write `data` to `dir/name`. Refuses names with folders in them and refuses to write through a symbolic link. */
export function writeSafe(dir, name, data) {
  if (!FILE_NAME.test(name) || name.includes('..')) throw new Error(`refusing to write "${name}": output names are plain file names`)
  const target = join(dir, name)
  let st = null
  try { st = lstatSync(target) } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (st && st.isSymbolicLink()) throw new Error(`refusing to write ${target}: it is a symbolic link (remove it and build again)`)
  if (st && !st.isFile()) throw new Error(`refusing to write ${target}: it is not a regular file`)
  const tmp = join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    writeFileSync(tmp, data, { flag: 'wx' })
    renameSync(tmp, target)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  return target
}

/** Copy a file into `dir` under `name`, with the same rules. */
export const copySafe = (from, dir, name) => writeSafe(dir, name, readFileSync(from))
