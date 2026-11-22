// Bundle the component with esbuild: a small loader (robot-viewer.js) and the 3D engine it imports when needed
// (robot-viewer-engine.js), plus the stylesheet as a file for browsers without constructed stylesheets.
import { build } from 'esbuild'
import { mkdirSync, copyFileSync, readFileSync } from 'node:fs'
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

export const FILES = { entry: 'robot-viewer.js', engine: 'robot-viewer-engine.js', css: 'robot-viewer.css' }

function versions() {
  const v = (n) => JSON.parse(readFileSync(join(packageDir(n), 'package.json'), 'utf8')).version
  return { three: v('three'), meshoptimizer: v('meshoptimizer') }
}

/** Build the component into `out`. Returns the paths written. */
export async function bundle(out, { minify = true } = {}) {
  mkdirSync(out, { recursive: true })
  const ver = versions()
  const own = `/* robot-viewer (MIT). https://github.com/VinVirtual/robot-viewer */`
  const thirdParty = `/* Includes three.js r${ver.three.split('.')[1]} (MIT, Copyright 2010-2026 three.js authors) and the meshoptimizer ${ver.meshoptimizer} reference decoder (MIT, Copyright 2016-2026 Arseny Kapoulkine). */`
  const common = { bundle: true, format: 'esm', target: ['es2020', 'chrome90', 'firefox90', 'safari15'], minify, legalComments: 'none', logLevel: 'silent', charset: 'utf8' }
  await build({
    ...common,
    entryPoints: [join(WEB, 'element.js')],
    outfile: join(out, FILES.entry),
    loader: { '.css': 'text' },
    banner: { js: own },
  })
  await build({
    ...common,
    entryPoints: [join(WEB, 'engine.js')],
    outfile: join(out, FILES.engine),
    alias: { 'meshopt-js-decoder': join(packageDir('meshoptimizer'), 'meshopt_decoder_reference.js') },
    banner: { js: `${own}\n${thirdParty}` },
  })
  copyFileSync(join(WEB, 'styles.css'), join(out, FILES.css))
  return Object.values(FILES).map((f) => join(out, f))
}

export { pathToFileURL }
