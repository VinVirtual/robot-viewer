// Which AR link to offer, if any. Pure: pass in what the browser says about itself.
// iPhone and iPad: AR Quick Look opens a .usdz from <a rel="ar">. Android: Scene Viewer opens a .glb through an intent URL.

/**
 * @param {{ glb?: string|null, usdz?: string|null, base: string, userAgent?: string, supportsRelAr?: boolean, title?: string }} o
 * @returns {{ mode: 'quicklook'|'sceneviewer'|'none', href: string|null }}
 */
export function arLink({ glb = null, usdz = null, base, userAgent = '', supportsRelAr = false, title = '' } = {}) {
  const abs = (u) => {
    try { return new URL(u, base) } catch { return null }
  }
  const safe = (url) => url && (url.protocol === 'https:' || url.protocol === 'http:') ? url : null
  if (usdz && supportsRelAr) {
    const u = safe(abs(usdz))
    if (u) return { mode: 'quicklook', href: u.href }
  }
  if (glb && /Android/i.test(userAgent) && !/Instagram|FBAN|FBAV/i.test(userAgent)) {
    const u = safe(abs(glb))
    if (u) {
      const params = new URLSearchParams({ file: u.href, mode: 'ar_preferred' })
      if (title) params.set('title', title)
      const fallback = abs('') ? abs('').href : u.href
      const href = `intent://arvr.google.com/scene-viewer/1.0?${params}#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(fallback)};end;`
      return { mode: 'sceneviewer', href }
    }
  }
  return { mode: 'none', href: null }
}
