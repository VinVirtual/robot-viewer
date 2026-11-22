// The demo page (index.html + demo.css + demo.js) and the copy-paste snippet.
// The page has no inline script or style, so it runs under Content-Security-Policy: default-src 'self'.
import { writeFileSync, copyFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FILES } from './bundle.js'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web')
export const DEMO_CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'"

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const join2 = (base, file) => (base ? base.replace(/\/?$/, '/') : '') + file

/** The <robot-viewer> element for one robot. */
export function viewerTag(r, { base = '', indent = '' } = {}) {
  const attrs = [
    ['src', join2(base, r.glb)],
    r.poster && ['poster', join2(base, r.poster)],
    ['alt', r.alt],
    r.defaultPose && ['pose', r.defaultPose],
    r.orbit && ['orbit', r.orbit],
    r.ar?.glb && ['ar-glb', join2(base, r.ar.glb)],
    r.ar?.usdz && ['ar-usdz', join2(base, r.ar.usdz)],
  ].filter(Boolean)
  const flags = r.ik ? ' ik' : ''
  return `${indent}<robot-viewer ${attrs.map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ')}${flags}></robot-viewer>`
}

/** What to paste into a page: one module script (once per page) and the element. */
export function snippetFor(r, { base = '' } = {}) {
  return [
    `<!-- ${r.title}: load the component once per page -->`,
    `<script type="module" src="${escapeHtml(join2(base, FILES.entry))}"></script>`,
    viewerTag(r, { base }),
  ].join('\n')
}

const human = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)

export function demoHtml(manifest, { sizes = {} } = {}) {
  const robots = manifest.robots
  const title = robots.map((r) => r.title).join(' and ') || 'robot-viewer'
  const sections = robots.map((r, i) => {
    const id = `robot-${escapeHtml(r.name)}`
    const facts = [
      ['Moving joints', r.stats.moving],
      ['Links', r.stats.links],
      ['Triangles', r.stats.triangles.toLocaleString('en-US')],
      sizes[r.glb] && ['Model file', human(sizes[r.glb])],
    ].filter(Boolean)
    return `    <section class="robot" aria-labelledby="${id}">
      <header class="robot-head">
        <p class="index">${String(i + 1).padStart(2, '0')}</p>
        <h2 id="${id}">${escapeHtml(r.title)}</h2>
        <dl class="facts">
${facts.map(([k, v]) => `          <div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('\n')}
        </dl>
        <p class="how">${r.poses.length ? `Pick a pose, or set each joint with its slider. ` : 'Set each joint with its slider. '}${r.ik ? 'Drag a part of the robot to move it. ' : ''}Drag the background to turn the view.</p>
      </header>
${viewerTag(r, { indent: '      ' })}
      <details class="embed">
        <summary>Embed this robot</summary>
        <pre><code>${escapeHtml(snippetFor(r))}</code></pre>
      </details>
    </section>`
  }).join('\n\n')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${DEMO_CSP}">
  <title>${escapeHtml(title)} | robot-viewer</title>
  <link rel="stylesheet" href="demo.css">
  <script type="module" src="${FILES.entry}"></script>
  <script type="module" src="demo.js"></script>
</head>
<body>
  <header class="masthead">
    <p class="kicker">robot-viewer <span>demo</span></p>
    <h1>${escapeHtml(title)}</h1>
    <p class="lede">Each robot below is one compressed GLB file and one web component, served from this folder with no other site involved. The page runs under <code>${escapeHtml(DEMO_CSP)}</code>.</p>
    <button type="button" class="theme" aria-pressed="false">Dark</button>
  </header>
  <main>
${sections}
  </main>
  <footer class="colophon">
    <p>Joint limits come from each robot's URDF. Motion is illustrative: no collisions, torque or speed are checked.</p>
  </footer>
</body>
</html>
`
}

export function writeDemo(out, manifest) {
  const sizes = {}
  for (const r of manifest.robots) if (existsSync(join(out, r.glb))) sizes[r.glb] = statSync(join(out, r.glb)).size
  writeFileSync(join(out, 'index.html'), demoHtml(manifest, { sizes }))
  copyFileSync(join(WEB, 'demo.css'), join(out, 'demo.css'))
  copyFileSync(join(WEB, 'demo.js'), join(out, 'demo.js'))
}
