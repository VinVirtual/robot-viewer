import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseUrdf } from '../engine/core/urdf.js'
import { easeInOutCubic, tweenDuration, createTween, sampleTween } from '../engine/core/tween.js'
import { WREN, near } from './helpers.mjs'

const wren = parseUrdf(readFileSync(join(WREN, 'wren.urdf'), 'utf8'))

test('easing starts at 0, ends at 1, passes 0.5 at the middle and never overshoots', () => {
  assert.equal(easeInOutCubic(0), 0)
  assert.equal(easeInOutCubic(1), 1)
  assert.equal(easeInOutCubic(0.5), 0.5)
  for (let t = 0; t <= 1; t += 0.01) assert.ok(easeInOutCubic(t) >= 0 && easeInOutCubic(t) <= 1)
})

test('samples run from the start state to the end state', () => {
  const tw = createTween({ a: 0, b: 1 }, { a: 2, b: 1 }, 1000, 500)
  assert.deepEqual(sampleTween(tw, 900).values, { a: 0, b: 1 })
  assert.equal(sampleTween(tw, 1250).values.a, 1)
  const end = sampleTween(tw, 1500)
  assert.deepEqual(end, { values: { a: 2, b: 1 }, done: true })
})

test('a tween keeps its own copies, so later changes to the inputs do not move it', () => {
  const from = { a: 0 }, to = { a: 1 }
  const tw = createTween(from, to, 0, 100)
  from.a = 5; to.a = 9
  assert.equal(sampleTween(tw, 100).values.a, 1)
})

test('a zero-length tween jumps straight to the end', () => {
  assert.deepEqual(sampleTween(createTween({ a: 0 }, { a: 3 }, 0, 0), 0), { values: { a: 3 }, done: true })
})

test('bigger moves take longer, within the bounds, and no move takes no time', () => {
  const small = tweenDuration(wren, {}, { shoulder: 0.2 })
  const big = tweenDuration(wren, {}, { shoulder: 1.7, elbow: -2.5 })
  assert.ok(small >= 0.35 && big <= 1.6 && big > small)
  assert.equal(tweenDuration(wren, { shoulder: 1 }, { shoulder: 1 }), 0)
})

test('interrupting starts the new move from where the robot is', () => {
  const first = createTween({ a: 0 }, { a: 1 }, 0, 1000)
  const mid = sampleTween(first, 500).values
  const second = createTween(mid, { a: -1 }, 500, 1000)
  assert.ok(near(sampleTween(second, 500).values.a, 0.5))
})
