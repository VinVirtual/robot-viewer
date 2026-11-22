// Static Content-Security-Policy checks for generated pages and bundles.
// An HTML page passes when, under the policy it declares (or "default-src 'self'"), nothing in it would be blocked:
// no inline script unless its sha256 hash is allowed, no inline event handlers, no style attributes or <style>
// blocks unless allowed, no javascript: URLs, and every script, style, image and model comes from the same origin.
import { createHash } from 'node:crypto'

export const STRICT = "default-src 'self'"

/** Parse a policy string into { directive: [sources] } (lower-case directive names). */
export function parseCsp(text) {
  const out = {}
  for (const part of String(text || '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean)
    if (name && !(name.toLowerCase() in out)) out[name.toLowerCase()] = sources
  }
  return out
}

/** Sources for a fetch directive, falling back to default-src as browsers do. */
export function sourcesFor(policy, directive) {
  const chain = { 'script-src-elem': ['script-src-elem', 'script-src', 'default-src'], 'script-src-attr': ['script-src-attr', 'script-src', 'default-src'],
    'style-src-elem': ['style-src-elem', 'style-src', 'default-src'], 'style-src-attr': ['style-src-attr', 'style-src', 'default-src'] }[directive] || [directive, 'default-src']
  for (const d of chain) if (policy[d]) return policy[d]
  return null
}

export const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

function allowsInline(sources, content) {
  if (!sources) return true
  const hashes = sources.filter((s) => /^'sha(256|384|512)-/.test(s))
  const nonces = sources.filter((s) => /^'nonce-/.test(s))
  if (sources.includes("'unsafe-inline'") && !hashes.length && !nonces.length) return true
  return content !== null && hashes.includes(sha256(content))
}

/** Same-origin URL? Relative paths are; absolute ones and other schemes are not. data: and blob: are reported separately. */
export function isSameOrigin(url) {
  const u = String(url || '').trim()
  if (!u) return true
  if (/^\/\//.test(u)) return false
  return !/^[a-z][a-z0-9+.-]*:/i.test(u)
}

function allowsUrl(sources, url) {
  if (!sources) return true
  if (sources.includes("'none'")) return false
  const u = String(url).trim()
  if (/^data:/i.test(u)) return sources.includes('data:')
  if (/^blob:/i.test(u)) return sources.includes('blob:')
  if (isSameOrigin(u)) return sources.includes("'self'") || sources.includes('*')
  const origin = (() => { try { return new URL(u).origin } catch { return null } })()
  return !!origin && (sources.includes('*') || sources.some((s) => s.replace(/\/$/, '') === origin))
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Tags with their attributes, plus the text of <script> and <style> elements. Comments are skipped. */
export function scanHtml(html) {
  const tags = []
  const text = String(html).replace(/<!--[\s\S]*?-->/g, '')
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g
  let m
  while ((m = re.exec(text))) {
    const name = m[1].toLowerCase()
    const attrs = {}
    const ar = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    let a
    while ((a = ar.exec(m[2]))) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '')
    const tag = { name, attrs, content: null }
    if (name === 'script' || name === 'style') {
      const close = text.toLowerCase().indexOf(`</${name}`, re.lastIndex)
      tag.content = close === -1 ? text.slice(re.lastIndex) : text.slice(re.lastIndex, close)
      if (close !== -1) re.lastIndex = close
    }
    tags.push(tag)
  }
  return tags
}

/**
 * Check a page. `policy` defaults to the page's own <meta http-equiv="Content-Security-Policy">, else STRICT.
 * @returns {{ ok: boolean, policy: string, problems: string[] }}
 */
export function checkHtml(html, { policy = null } = {}) {
  const tags = scanHtml(html)
  const meta = tags.find((t) => t.name === 'meta' && (t.attrs['http-equiv'] || '').toLowerCase() === 'content-security-policy')
  const text = policy || meta?.attrs.content || STRICT
  const p = parseCsp(text)
  const problems = []
  for (const t of tags) {
    for (const [k, v] of Object.entries(t.attrs)) {
      if (/^on[a-z]+$/.test(k) && !allowsInline(sourcesFor(p, 'script-src-attr'), null)) problems.push(`<${t.name} ${k}="..."> is an inline event handler; the policy blocks it`)
      if (k === 'style' && !allowsInline(sourcesFor(p, 'style-src-attr'), null)) problems.push(`<${t.name} style="..."> is an inline style; the policy blocks it`)
      if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(k) && /^\s*javascript:/i.test(v)) problems.push(`<${t.name} ${k}="javascript:..."> runs inline script; the policy blocks it`)
    }
    if (t.name === 'script') {
      const type = (t.attrs.type || '').toLowerCase()
      const isData = type && !['module', 'text/javascript', 'application/javascript'].includes(type)
      if (t.attrs.src !== undefined) {
        if (!allowsUrl(sourcesFor(p, 'script-src-elem'), t.attrs.src)) problems.push(`<script src="${t.attrs.src}"> is not allowed by the policy`)
      } else if (!isData && t.content.trim() && !allowsInline(sourcesFor(p, 'script-src-elem'), t.content)) {
        problems.push(`inline <script> (${t.content.trim().slice(0, 40)}...) is blocked: move it to a file or allow its hash ${sha256(t.content)}`)
      }
    }
    if (t.name === 'style' && t.content.trim() && !allowsInline(sourcesFor(p, 'style-src-elem'), t.content)) problems.push(`inline <style> is blocked: move it to a .css file or allow its hash ${sha256(t.content)}`)
    if (t.name === 'link' && /stylesheet/i.test(t.attrs.rel || '') && !allowsUrl(sourcesFor(p, 'style-src-elem'), t.attrs.href)) problems.push(`stylesheet ${t.attrs.href} is not allowed by the policy`)
    if (t.name === 'link' && /modulepreload|preload/i.test(t.attrs.rel || '') && t.attrs.href && !isSameOrigin(t.attrs.href)) problems.push(`preload of ${t.attrs.href} is from another origin`)
    if (t.name === 'img' && t.attrs.src && !allowsUrl(sourcesFor(p, 'img-src'), t.attrs.src)) problems.push(`<img src="${t.attrs.src}"> is not allowed by the policy`)
    if (t.name === 'robot-viewer') {
      for (const k of ['src', 'ar-glb', 'ar-usdz']) if (t.attrs[k] && !allowsUrl(sourcesFor(p, 'connect-src'), t.attrs[k])) problems.push(`<robot-viewer ${k}="${t.attrs[k]}"> cannot be fetched under the policy (connect-src)`)
      if (t.attrs.poster && !allowsUrl(sourcesFor(p, 'img-src'), t.attrs.poster)) problems.push(`<robot-viewer poster="${t.attrs.poster}"> is not allowed by the policy (img-src)`)
    }
    if (['iframe', 'object', 'embed'].includes(t.name)) problems.push(`<${t.name}> is not expected in a robot-viewer page`)
  }
  return { ok: problems.length === 0, policy: text, problems }
}

export const SCRIPT_RULES = [
  { id: 'eval', re: /(^|[^.\w$])eval\s*\(/, message: "calls eval(), which needs 'unsafe-eval'" },
  { id: 'function', re: /new\s+Function\s*\(/, message: "uses new Function(), which needs 'unsafe-eval'" },
  { id: 'wasm', re: /WebAssembly\s*\.\s*(instantiate|compile|Module)\b/, message: "compiles WebAssembly, which needs 'wasm-unsafe-eval'" },
  { id: 'worker', re: /new\s+Worker\s*\(/, message: 'starts a Worker, which needs worker-src (and often blob:)' },
  { id: 'blob', re: /createObjectURL\s*\(/, message: "makes blob: URLs, which default-src 'self' does not allow" },
  { id: 'write', re: /document\s*\.\s*write\s*\(/, message: 'calls document.write()' },
  { id: 'innerHTML', re: /\.innerHTML\s*=(?!=)/, message: 'assigns innerHTML (inline handlers inside it would be blocked, and it risks injection)' },
  { id: 'string-timer', re: /set(Timeout|Interval)\s*\(\s*["'`]/, message: 'passes a string to setTimeout or setInterval' },
]

/** Things in a script bundle that a policy without 'unsafe-eval', 'wasm-unsafe-eval' or blob: would block.
    `allow` lists rule ids known to sit on code paths that never run (each with a reason in the caller). */
export function checkScript(js, { allow = [] } = {}) {
  const code = String(js)
  const hits = SCRIPT_RULES.filter((r) => r.re.test(code))
  const problems = hits.filter((r) => !allow.includes(r.id)).map((r) => r.message)
  return { ok: problems.length === 0, problems, allowed: hits.filter((r) => allow.includes(r.id)).map((r) => r.id) }
}

/** The one known blob: path in the engine bundle: GLTFLoader turns embedded images into blob: URLs.
    GLB files made by robot-viewer build carry no images, so that path never runs. */
export const ENGINE_ALLOW = ['blob']
