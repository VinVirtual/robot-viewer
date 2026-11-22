import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arLink } from '../engine/web/ar.js'

const base = 'https://example.org/robots/page.html'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'

test('iPhone and iPad with Quick Look get the .usdz', () => {
  assert.deepEqual(arLink({ usdz: 'wren.usdz', glb: 'wren.glb', base, userAgent: IPHONE, supportsRelAr: true }), { mode: 'quicklook', href: 'https://example.org/robots/wren.usdz' })
})

test('Android gets a Scene Viewer intent with the absolute .glb address', () => {
  const r = arLink({ glb: 'wren.glb', base, userAgent: ANDROID, title: 'Wren arm' })
  assert.equal(r.mode, 'sceneviewer')
  assert.match(r.href, /^intent:\/\/arvr\.google\.com\/scene-viewer\/1\.0\?file=https%3A%2F%2Fexample\.org%2Frobots%2Fwren\.glb&mode=ar_preferred&title=Wren\+arm#Intent;/)
  assert.match(r.href, /package=com\.google\.ar\.core;.*S\.browser_fallback_url=https%3A%2F%2Fexample\.org/)
})

test('desktops, and phones without the files, get no AR link', () => {
  assert.equal(arLink({ glb: 'a.glb', usdz: 'a.usdz', base, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140' }).mode, 'none')
  assert.equal(arLink({ base, userAgent: ANDROID }).mode, 'none')
  assert.equal(arLink({ glb: 'a.glb', base, userAgent: IPHONE, supportsRelAr: true }).mode, 'none')
})

test('in-app browsers on Android are skipped (Scene Viewer does not open from them)', () => {
  assert.equal(arLink({ glb: 'a.glb', base, userAgent: ANDROID + ' Instagram 300' }).mode, 'none')
})

test('only http(s) model addresses are used', () => {
  assert.equal(arLink({ glb: 'javascript:alert(1)', base, userAgent: ANDROID }).mode, 'none')
  assert.equal(arLink({ usdz: 'data:model/usd,AAAA', base, userAgent: IPHONE, supportsRelAr: true }).mode, 'none')
})

test('Scene Viewer is offered only for https model addresses', () => {
  assert.equal(arLink({ glb: 'wren.glb', base: 'http://example.org/page.html', userAgent: ANDROID }).mode, 'none')
  assert.equal(arLink({ glb: 'http://example.org/wren.glb', base, userAgent: ANDROID }).mode, 'none')
  assert.equal(arLink({ glb: 'https://cdn.example.org/wren.glb', base: 'http://example.org/', userAgent: ANDROID }).mode, 'sceneviewer')
})
