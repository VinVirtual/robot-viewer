// Smooth moves between joint states. Pure: the caller owns the clock.
import { MOVING } from './kinematics.js'

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Seconds for a move: longer for bigger moves, between `min` and `max`. Distances are radians (or metres x 10 for slides). */
export function tweenDuration(robot, from, to, { min = 0.35, max = 1.6, radPerSecond = 2.2 } = {}) {
  let far = 0
  for (const j of robot.joints) {
    if (!MOVING.has(j.type) || j.mimic) continue
    const d = Math.abs((to[j.name] ?? 0) - (from[j.name] ?? 0)) * (j.type === 'prismatic' ? 10 : 1)
    if (d > far) far = d
  }
  if (far === 0) return 0
  return Math.min(max, Math.max(min, 0.25 + far / radPerSecond))
}

/** A move that starts at `start` (ms). Holds copies of both states, so later changes to the inputs do not affect it. */
export function createTween(from, to, start, durationMs) {
  return { from: { ...from }, to: { ...to }, start, duration: Math.max(0, durationMs) }
}

/** Values at time `now` (ms) and whether the move has finished. */
export function sampleTween(tween, now) {
  const t = tween.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - tween.start) / tween.duration))
  const k = easeInOutCubic(t)
  const values = {}
  for (const name of new Set([...Object.keys(tween.from), ...Object.keys(tween.to)])) {
    const a = tween.from[name] ?? 0, b = tween.to[name] ?? a
    values[name] = t >= 1 ? b : a + (b - a) * k
  }
  return { values, done: t >= 1 }
}
