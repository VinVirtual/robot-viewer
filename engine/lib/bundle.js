// Bundle the component with esbuild: a small loader (robot-viewer.js) and the 3D engine it imports when needed
// (robot-viewer-engine.js), plus the stylesheet as a file for browsers without constructed stylesheets.
import { build } from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'
import { writeSafe } from './files.js'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
export const WEB = resolve(HERE, '..', 'web')
export const SKILL = resolve(HERE, '..', '..')
const require = createRequire(import.meta.url)

/** Folder of an installed package (works even when its exports map hides package.json). */
function packageDir(name) {
  const main = require.resolve(name)
  let dir = dirname(main)
  for (let i = 0; i < 6; i++) {
    try { if (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === name) return dir } catch {}
    dir = dirname(dir)
  }
  throw new Error(`cannot find the folder of ${name}`)
}

export const FILES = { entry: 'robot-viewer.js', engine: 'robot-viewer-engine.js', css: 'robot-viewer.css', licenses: 'robot-viewer-licenses.txt' }

function versions() {
  const v = (n) => JSON.parse(readFileSync(join(packageDir(n), 'package.json'), 'utf8')).version
  return { three: v('three'), meshoptimizer: v('meshoptimizer') }
}

/** Build the component into `out`. Returns the paths written. */
export async function bundle(out, { minify = true } = {}) {
  mkdirSync(out, { recursive: true })
  const ver = versions()
  const own = `/* robot-viewer (MIT). https://github.com/VinVirtual/robot-viewer . Licence texts: robot-viewer-licenses.txt */`
  const thirdParty = `/* Includes three.js r${ver.three.split('.')[1]} (MIT, Copyright 2010-2026 three.js authors) and the meshoptimizer ${ver.meshoptimizer} reference decoder (MIT, Copyright 2016-2026 Arseny Kapoulkine). */`
  const common = { write: false, bundle: true, format: 'esm', target: ['es2020', 'chrome90', 'firefox90', 'safari15'], minify, legalComments: 'none', logLevel: 'silent', charset: 'utf8' }
  const entry = await build({
    ...common,
    entryPoints: [join(WEB, 'element.js')],
    outfile: join(out, FILES.entry),
    loader: { '.css': 'text' },
    banner: { js: own },
  })
  const engine = await build({
    ...common,
    entryPoints: [join(WEB, 'engine.js')],
    outfile: join(out, FILES.engine),
    alias: { 'meshopt-js-decoder': join(packageDir('meshoptimizer'), 'meshopt_decoder_reference.js') },
    banner: { js: `${own}\n${thirdParty}` },
  })
  writeSafe(out, FILES.entry, entry.outputFiles[0].contents)
  writeSafe(out, FILES.engine, engine.outputFiles[0].contents)
  writeSafe(out, FILES.css, readFileSync(join(WEB, 'styles.css')))
  writeSafe(out, FILES.licenses, licenseText(ver))
  return Object.values(FILES).map((f) => join(out, f))
}

/** Full licence texts for everything in the two bundles, to ship next to them. */
export function licenseText(ver = versions()) {
  const read = (dir, names) => { for (const n of names) { try { return readFileSync(join(dir, n), 'utf8').trim() } catch {} } throw new Error(`no licence file in ${dir}`) }
  const rule = '='.repeat(72)
  return [
    'Licences for robot-viewer.js, robot-viewer-engine.js and robot-viewer.css.',
    'Keep this file next to them when you publish them.',
    '', rule, 'robot-viewer (all three files)', rule, read(SKILL, ['LICENSE']),
    '', rule, `three.js ${ver.three} (bundled in robot-viewer-engine.js)`, rule, read(packageDir('three'), ['LICENSE', 'LICENSE.md']),
    '', rule, `meshoptimizer ${ver.meshoptimizer}, reference decoder meshopt_decoder_reference.js (bundled in robot-viewer-engine.js)`, rule, read(packageDir('meshoptimizer'), ['LICENSE.md', 'LICENSE']),
    '',
  ].join('\n')
}

export { pathToFileURL }
