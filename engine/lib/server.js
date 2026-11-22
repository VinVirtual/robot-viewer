// A static file server for one folder, on 127.0.0.1 and a random free port, that sends a strict
// Content-Security-Policy header. Used for posters, recordings and the live CSP check.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve, extname, sep } from 'node:path'
import { realpathSync } from 'node:fs'

export const STRICT_CSP = "default-src 'self'"
export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.usdz': 'model/vnd.usdz+zip',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
}

/** Serve `dir`; `extra` maps URL paths to absolute files, `pages` maps URL paths to HTML text. Returns { url, close }. */
export async function serve(dir, { csp = STRICT_CSP, extra = {}, pages = {} } = {}) {
  const root = realpathSync(resolve(dir))
  const server = createServer(async (req, res) => {
    try {
      const host = (req.headers.host || '').replace(/:\d+$/, '')
      if (host !== '127.0.0.1' && host !== 'localhost') { res.writeHead(403).end(); return }
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      if (typeof pages[path] === 'string') {
        res.writeHead(200, { 'content-type': TYPES['.html'], 'content-security-policy': csp, 'cache-control': 'no-store' })
        res.end(pages[path])
        return
      }
      let file = extra[path]
      if (!file) {
        file = resolve(join(root, path.endsWith('/') ? path + 'index.html' : path))
        if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return }
        file = realpathSync(file)
        if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return }
      }
      if (!(await stat(file)).isFile()) throw new Error('not a file')
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-security-policy': csp, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      res.end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
    }
  })
  const port = await new Promise((ok, fail) => {
    const tryPort = (n) => {
      const p = 41000 + Math.floor(Math.random() * 9000)
      server.once('error', (e) => (n > 0 && e.code === 'EADDRINUSE' ? tryPort(n - 1) : fail(e)))
      server.listen(p, '127.0.0.1', () => ok(p))
    }
    tryPort(20)
  })
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(() => r())) }
}
