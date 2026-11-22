// Bytes per file in dist/, compressed sizes, and the budgets each file is held to.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'

const KB = 1024
/** Budgets in bytes. JS and CSS are judged gzipped (as servers send them); models and images as stored. */
export const BUDGETS = [
  { match: /^robot-viewer\.js$/, gzip: 10 * KB, why: 'loads on every page with a viewer, before anything is visible' },
  { match: /^robot-viewer-engine\.js$/, gzip: 200 * KB, why: 'three.js and the viewer, loaded only when the robot scrolls into view' },
  { match: /^robot-viewer\.css$/, gzip: 6 * KB, why: 'fallback stylesheet' },
  { match: /\.glb$/, bytes: 4 * KB * KB, why: 'a robot model; over 4 MB is slow on mobile data' },
  { match: /\.poster\.webp$/, bytes: 250 * KB, why: 'shown before the 3D view, and as the still for reduced motion and no WebGL' },
  { match: /\.poster\.png$/, bytes: 1200 * KB, why: 'full-quality still for your own pages (not loaded by the viewer)' },
]

export const budgetFor = (file) => BUDGETS.find((b) => b.match.test(file)) || null

export function measure(buf) {
  return {
    bytes: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  }
}

/** Measure `files` (names inside `dir`). */
export function sizeReport(dir, files) {
  const rows = files.map((file) => {
    const m = measure(readFileSync(join(dir, file)))
    const b = budgetFor(file)
    const limit = b ? (b.gzip !== undefined ? { kind: 'gzip', bytes: b.gzip } : { kind: 'bytes', bytes: b.bytes }) : null
    const actual = limit ? m[limit.kind] : null
    return { file, ...m, budget: limit, over: limit ? actual > limit.bytes : false }
  })
  const sum = (names, key) => rows.filter((r) => names.some((n) => n.test(r.file))).reduce((a, r) => a + r[key], 0)
  return {
    files: rows,
    firstLoadGzip: sum([/^robot-viewer\.js$/], 'gzip'),
    viewerGzip: sum([/^robot-viewer\.js$/, /^robot-viewer-engine\.js$/], 'gzip'),
    over: rows.filter((r) => r.over).map((r) => r.file),
  }
}

const human = (n) => (n >= KB * KB ? `${(n / KB / KB).toFixed(2)} MB` : n >= KB ? `${(n / KB).toFixed(1)} KB` : `${n} B`)

export function formatSizeReport(report) {
  const w = Math.max(4, ...report.files.map((r) => r.file.length))
  const lines = [`${'file'.padEnd(w)}  ${'bytes'.padStart(10)}  ${'gzip'.padStart(10)}  ${'brotli'.padStart(10)}  budget`]
  for (const r of report.files) {
    const budget = r.budget ? `${r.over ? 'OVER ' : 'ok   '}${human(r.budget.bytes)} ${r.budget.kind === 'gzip' ? 'gzipped' : ''}`.trimEnd() : ''
    lines.push(`${r.file.padEnd(w)}  ${String(r.bytes).padStart(10)}  ${String(r.gzip).padStart(10)}  ${String(r.brotli).padStart(10)}  ${budget}`)
  }
  lines.push('', `first load (loader only, gzipped): ${human(report.firstLoadGzip)}`, `viewer code when shown (gzipped): ${human(report.viewerGzip)}`)
  if (report.over.length) lines.push(`over budget: ${report.over.join(', ')}`)
  return lines.join('\n')
}

export { human }
