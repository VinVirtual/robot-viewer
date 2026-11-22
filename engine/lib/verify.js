// Open the demo page in headless Chrome under a strict CSP header and check that every robot loads,
// nothing breaks the policy, and the canvas really shows something.
import { serve } from './server.js'
import { launchBrowser } from './env.js'

/** Collect policy violations and errors from a page, before any of its own scripts run. */
export async function watchPage(page) {
  const found = { violations: [], errors: [], console: [] }
  await page.addInitScript(() => {
    window.__rvViolations = []
    document.addEventListener('securitypolicyviolation', (e) => window.__rvViolations.push(`${e.violatedDirective} blocked ${e.blockedURI || 'inline'}`))
  })
  page.on('pageerror', (e) => found.errors.push(String(e.message || e)))
  page.on('console', (m) => {
    const t = m.text()
    if (/Content Security Policy|Refused to/i.test(t)) found.violations.push(t)
    else if (m.type() === 'error' && !/Failed to load resource/.test(t)) found.errors.push(t)
  })
  // missing files are reported by address; the browser's own favicon request is not the page's doing
  page.on('response', (r) => { if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url())) found.errors.push(`${r.status()} ${r.url()}`) })
  return found
}

/** Wait until every <robot-viewer> on the page has loaded (or one failed). */
export async function waitForViewers(page, timeout = 120000) {
  await page.waitForFunction(() => {
    const els = [...document.querySelectorAll('robot-viewer')]
    return els.length > 0 && els.every((e) => e._state === 'ready' || e._state === 'error' || e._state === 'still')
  }, null, { timeout, polling: 250 })
  return page.evaluate(() => [...document.querySelectorAll('robot-viewer')].map((e) => ({ src: e.getAttribute('src'), state: e._state, joints: e.joints.length, poses: e.poses })))
}

export async function verifyDist(dir, { page: pageName = 'index.html', screenshot = null, viewport = { width: 1280, height: 900 } } = {}) {
  const server = await serve(dir)
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage({ viewport })
    const found = await watchPage(page)
    await page.goto(server.url + pageName, { waitUntil: 'load' })
    // lazy loading: bring each viewer into view
    const count = await page.evaluate(() => document.querySelectorAll('robot-viewer').length)
    for (let i = 0; i < count; i++) {
      await page.evaluate((k) => document.querySelectorAll('robot-viewer')[k].scrollIntoView({ block: 'center' }), i)
      await page.waitForTimeout(150)
    }
    const viewers = await waitForViewers(page)
    await page.evaluate(() => document.querySelector('robot-viewer').scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(600)
    const violations = [...found.violations, ...(await page.evaluate(() => window.__rvViolations))]
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: false })
    return { viewers, violations, errors: found.errors, ok: violations.length === 0 && found.errors.length === 0 && viewers.every((v) => v.state === 'ready') }
  } finally {
    await browser.close()
    await server.close()
  }
}
