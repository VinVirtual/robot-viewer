// <robot-viewer>: the small part that loads first. It shows the poster, waits until the element is near the
// viewport, and only then imports the 3D engine (robot-viewer-engine.js, next to this file).
// No inline scripts or styles are needed: styles go in through a constructed stylesheet, which a strict
// Content-Security-Policy allows, with a <link> to robot-viewer.css as the fallback.
import css from './styles.css'
import { arLink } from './ar.js'

const ENGINE_URL = new URL('./robot-viewer-engine.js', import.meta.url).href
const CSS_URL = new URL('./robot-viewer.css', import.meta.url).href
let sharedSheet = null

const el = (tag, props = {}, children = []) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v
    else if (k === 'text') e.textContent = v
    else if (k.startsWith('aria-') || k === 'role' || k === 'part' || k === 'for' || k === 'tabindex') e.setAttribute(k, v)
    else e[k] = v
  }
  for (const c of children) e.append(c)
  return e
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export class RobotViewerElement extends HTMLElement {
  static get observedAttributes() { return ['src', 'poster', 'alt', 'pose', 'theme', 'controls', 'ik', 'grid', 'ar-glb', 'ar-usdz'] }

  constructor() {
    super()
    this._root = this.attachShadow({ mode: 'open' })
    this._engine = null
    this._state = 'idle'
    this._observer = null
  }

  connectedCallback() {
    if (!this._built) this._build()
    this._updateAr()
    if (this.getAttribute('loading') === 'eager') this.activate('eager')
    else if (reducedMotion()) this._offerStart('Motion is reduced on this device. The 3D view opens only when you ask.')
    else this._observe()
  }

  disconnectedCallback() {
    this._observer?.disconnect()
    this._observer = null
  }

  attributeChangedCallback(name, oldValue, value) {
    if (!this._built || oldValue === value) return
    if (name === 'poster') this._setPoster()
    if (name === 'alt') { this._poster.alt = value || ''; this._stage.setAttribute('aria-label', value || 'Robot model') }
    if (name === 'ar-glb' || name === 'ar-usdz') this._updateAr()
    this._engine?.attributeChanged(name, value)
  }

  _build() {
    this._built = true
    if ('adoptedStyleSheets' in this._root && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
      if (!sharedSheet) { sharedSheet = new CSSStyleSheet(); sharedSheet.replaceSync(css) }
      this._root.adoptedStyleSheets = [sharedSheet]
    } else {
      this._root.append(el('link', { rel: 'stylesheet', href: CSS_URL }))
    }
    this._poster = el('img', { class: 'poster', part: 'poster', alt: this.getAttribute('alt') || '', decoding: 'async', draggable: false })
    this._status = el('p', { class: 'status', part: 'status', role: 'status', 'aria-live': 'polite' })
    this._start = el('button', { class: 'start', part: 'start-button', type: 'button', text: 'Open 3D view', hidden: true })
    this._start.addEventListener('click', () => this.activate('button'))
    this._ar = el('a', { class: 'ar', part: 'ar-button', hidden: true }, [el('img', { alt: '', class: 'ar-img' }), el('span', { text: 'View in your room' })])
    this._stage = el('div', { class: 'stage', part: 'stage', role: 'group', 'aria-label': this.getAttribute('alt') || 'Robot model' }, [this._poster, this._status, this._start, this._ar])
    this._panel = el('div', { class: 'panel', part: 'panel', hidden: true })
    this._frame = el('div', { class: 'frame', part: 'frame' }, [this._stage, this._panel])
    this._root.append(this._frame)
    this._setPoster()
  }

  _setPoster() {
    const p = this.getAttribute('poster')
    if (p) { this._poster.src = p; this._poster.hidden = false } else { this._poster.removeAttribute('src'); this._poster.hidden = true }
  }

  _updateAr() {
    const a = document.createElement('a')
    const link = arLink({
      glb: this.getAttribute('ar-glb'), usdz: this.getAttribute('ar-usdz'), base: document.baseURI,
      userAgent: navigator.userAgent, supportsRelAr: !!(a.relList && a.relList.supports && a.relList.supports('ar')),
      title: this.getAttribute('alt') || '',
    })
    this._ar.hidden = link.mode === 'none'
    if (link.mode === 'none') { this._ar.removeAttribute('href'); this._ar.removeAttribute('rel'); return }
    this._ar.href = link.href
    if (link.mode === 'quicklook') this._ar.setAttribute('rel', 'ar')
    else this._ar.removeAttribute('rel')
  }

  _say(text) { this._status.textContent = text }

  _offerStart(reason) {
    this._say(reason)
    this._start.hidden = false
  }

  _observe() {
    if (typeof IntersectionObserver !== 'function') { this.activate('no-observer'); return }
    this._observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { this._observer.disconnect(); this._observer = null; this.activate('visible') }
    }, { rootMargin: '200px 0px' })
    this._observer.observe(this)
  }

  /** Load the 3D view now. Resolves when the robot is shown (or the still image stays because 3D is not possible). */
  async activate(reason = 'api') {
    if (this._state !== 'idle') return this._ready
    this._state = 'loading'
    this._start.hidden = true
    this._ready = (async () => {
      if (!webglAvailable()) {
        this._state = 'still'
        this._say('3D needs WebGL, which this browser has turned off. Showing a still image.')
        this.dispatchEvent(new CustomEvent('fallback', { detail: { reason: 'no-webgl' } }))
        return
      }
      if (!this.getAttribute('src')) { this._state = 'error'; this._say('No robot file given (set the src attribute).'); return }
      this._say('Loading the 3D model…')
      this.setAttribute('aria-busy', 'true')
      try {
        const mod = await import(ENGINE_URL)
        this._engine = await mod.mount(this, { stage: this._stage, panel: this._panel, poster: this._poster, status: this._status, reducedMotion: reducedMotion(), reason })
        this._state = 'ready'
        this._say('')
      } catch (e) {
        this._state = 'error'
        this._say('The 3D model could not be loaded. Showing a still image.')
        this.dispatchEvent(new CustomEvent('error', { detail: { message: String(e && e.message || e) } }))
      } finally {
        this.removeAttribute('aria-busy')
      }
    })()
    return this._ready
  }

  // ---- public API (available after the "load" event) ----
  get joints() { return this._engine ? this._engine.joints() : [] }
  get poses() { return this._engine ? this._engine.poseNames() : [] }
  get values() { return this._engine ? this._engine.values() : {} }
  setJoint(name, value) { this._engine?.setJoint(name, value) }
  setJoints(values) { this._engine?.setJoints(values) }
  fitView(options) { this._engine?.fitView(options) }
  linkScreenPoint(name, local) { return this._engine ? this._engine.linkScreenPoint(name, local) : null }
  goToPose(name, options) { return this._engine ? this._engine.goToPose(name, options) : Promise.resolve(false) }
}

if (typeof customElements !== 'undefined' && !customElements.get('robot-viewer')) customElements.define('robot-viewer', RobotViewerElement)
