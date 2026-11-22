import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkHtml, checkScript, parseCsp, sourcesFor, sha256, scanHtml, isSameOrigin } from '../engine/core/csp.js'
import { demoHtml, snippetFor, DEMO_CSP, escapeHtml } from '../engine/lib/html.js'

const page = (head, body = '', csp = "default-src 'self'") => `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}">${head}</head><body>${body}</body></html>`
const robot = { name: 'wren', title: 'Wren', alt: 'Wren arm', glb: 'wren.glb', poster: 'wren.poster.webp', ik: true, ar: {}, poses: ['home'], defaultPose: 'home', stats: { links: 9, joints: 8, moving: 6, triangles: 6860 } }

test('parses directives and falls back to default-src', () => {
  const p = parseCsp("default-src 'self'; img-src 'self' data:;  script-src 'self' 'sha256-abc='")
  assert.deepEqual(sourcesFor(p, 'img-src'), ["'self'", 'data:'])
  assert.deepEqual(sourcesFor(p, 'connect-src'), ["'self'"])
  assert.deepEqual(sourcesFor(p, 'script-src-elem'), ["'self'", "'sha256-abc='"])
})

test('the generated demo page passes under its own strict policy and under bare default-src self', () => {
  const html = demoHtml({ robots: [robot, { ...robot, name: 'so100', title: 'SO-ARM100', ar: { glb: 'so100.ar.glb', usdz: 'so100.ar.usdz' } }] })
  const own = checkHtml(html)
  assert.deepEqual(own.problems, [])
  assert.equal(own.policy, DEMO_CSP)
  assert.ok(own.policy.startsWith("default-src 'self'"))
  assert.deepEqual(checkHtml(html, { policy: "default-src 'self'" }).problems, [])
})

test('the snippet passes under default-src self', () => {
  assert.deepEqual(checkHtml(snippetFor(robot), { policy: "default-src 'self'" }).problems, [])
  assert.deepEqual(checkHtml(snippetFor(robot, { base: '/robots/' }), { policy: "default-src 'self'" }).problems, [])
})

test('an inline script is blocked unless its exact hash is allowed', () => {
  const js = 'console.log(1)'
  assert.match(checkHtml(page(`<script>${js}</script>`)).problems[0], /inline <script>.*allow its hash 'sha256-/)
  assert.deepEqual(checkHtml(page(`<script>${js}</script>`, '', `default-src 'self'; script-src 'self' ${sha256(js)}`)).problems, [])
  assert.equal(checkHtml(page(`<script>${js} </script>`, '', `default-src 'self'; script-src 'self' ${sha256(js)}`)).problems.length, 1)
})

test("'unsafe-inline' is ignored when a hash is present, as browsers do", () => {
  const r = checkHtml(page('<script>x()</script>', '', "default-src 'self'; script-src 'self' 'unsafe-inline' 'sha256-AAAA'"))
  assert.equal(r.problems.length, 1)
})

test('JSON data blocks are not scripts', () => {
  assert.deepEqual(checkHtml(page('<script type="application/json">{"a":1}</script>')).problems, [])
})

test('inline event handlers, style attributes, <style> blocks and javascript: URLs are blocked', () => {
  const r = checkHtml(page('<style>p{}</style>', '<button onclick="go()">x</button><p style="color:red">y</p><a href="javascript:alert(1)">z</a>'))
  assert.equal(r.problems.length, 4)
  assert.ok(r.problems.some((p) => /inline <style>/.test(p)))
  assert.ok(r.problems.some((p) => /onclick/.test(p)))
  assert.ok(r.problems.some((p) => /style=/.test(p)))
  assert.ok(r.problems.some((p) => /javascript:/.test(p)))
})

test('scripts, styles and models from other sites are blocked; a CDN is reported', () => {
  const r = checkHtml(page('<script type="module" src="https://cdn.jsdelivr.net/npm/three/build/three.module.js"></script><link rel="stylesheet" href="https://fonts.googleapis.com/css2">',
    '<robot-viewer src="https://example.org/r.glb" poster="data:image/png;base64,AAAA"></robot-viewer>'))
  assert.equal(r.problems.length, 4)
})

test('a page with no policy is checked against the strict default', () => {
  const r = checkHtml('<html><body><img src="https://example.org/a.png"></body></html>')
  assert.equal(r.policy, "default-src 'self'")
  assert.equal(r.problems.length, 1)
})

test('comments are skipped and attribute values are decoded', () => {
  const tags = scanHtml('<!-- <script>bad()</script> --><a title="a &amp; b" data-x=\'1\'>')
  assert.equal(tags.length, 1)
  assert.equal(tags[0].attrs.title, 'a & b')
  assert.equal(tags[0].attrs['data-x'], '1')
})

test('same-origin URLs are relative paths; protocol-relative and schemes are not', () => {
  assert.ok(isSameOrigin('robots/a.glb') && isSameOrigin('/a.js') && isSameOrigin('./a.js'))
  assert.ok(!isSameOrigin('//cdn.example/a.js') && !isSameOrigin('https://x/a.js') && !isSameOrigin('blob:abc'))
})

test('script check finds eval, Function, WebAssembly, workers, blob URLs, innerHTML and string timers', () => {
  const bad = 'eval("1"); new Function("x"); WebAssembly.instantiate(b); new Worker(u); URL.createObjectURL(b); el.innerHTML = s; setTimeout("go()", 1)'
  const r = checkScript(bad)
  assert.equal(r.problems.length, 7)
  assert.deepEqual(checkScript('obj.evaluate(1); x.innerHTML === y; retrieval(2)').problems, [])
})

test('allowed script findings are listed separately', () => {
  const r = checkScript('URL.createObjectURL(b)', { allow: ['blob'] })
  assert.ok(r.ok)
  assert.deepEqual(r.allowed, ['blob'])
})

test('HTML escaping covers the five characters', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
})

test('robot titles cannot inject markup into the demo page', () => {
  const html = demoHtml({ robots: [{ ...robot, title: '<script>alert(1)</script>', alt: '" onmouseover="x' }] })
  assert.doesNotMatch(html, /<script>alert/)
  assert.deepEqual(checkHtml(html).problems, [])
})
