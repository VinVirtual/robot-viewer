// The control panel: pose buttons and one slider per joint. Plain DOM, built with createElement only.
import { controllableJoints, jointRange, MOVING } from '../core/kinematics.js'

const DEG = 180 / Math.PI
const NEAR = 0.04 // within 4% of a limit counts as "near"

/** Display units for a joint: degrees for rotation, millimetres for slides. */
export function displayUnits(joint) {
  return joint.type === 'prismatic'
    ? { toUi: (v) => v * 1000, fromUi: (u) => u / 1000, suffix: ' mm', word: 'millimetres', step: 0.5, digits: 1 }
    : { toUi: (v) => v * DEG, fromUi: (u) => u / DEG, suffix: '°', word: 'degrees', step: 0.5, digits: 0 }
}

const make = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const fmt = (u, digits) => {
  const s = u.toFixed(digits)
  return s === '-0' || /^-0\.0+$/.test(s) ? s.slice(1) : s
}

/**
 * @param {HTMLElement} panel
 * @param {object} robot joints description
 * @param {{ poses: string[], mode: string, ik: boolean, onJoint: (name: string, value: number) => void, onPose: (name: string) => void, onReset: () => void, uid: string }} o
 */
export function buildPanel(panel, robot, { poses, mode, ik, onJoint, onPose, onReset, uid }) {
  panel.replaceChildren()
  const rows = new Map()
  const poseButtons = new Map()
  if (mode === 'none') { panel.hidden = true; return { update() {}, setActivePose() {} } }
  panel.hidden = false

  if (poses.length) {
    const head = make('p', 'heading')
    head.append(make('span', '', 'Poses'), make('b', '', String(poses.length)))
    const group = make('div', 'poses')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', 'Poses')
    for (const name of poses) {
      const b = make('button', 'pose', name)
      b.type = 'button'
      b.setAttribute('aria-pressed', 'false')
      b.addEventListener('click', () => onPose(name))
      poseButtons.set(name, b)
      group.append(b)
    }
    panel.append(head, group)
  }

  if (mode !== 'poses') {
    // mimic joints follow another joint, so they get no slider of their own
    const joints = robot.joints.filter((j) => MOVING.has(j.type) && !j.mimic)
    const head = make('p', 'heading')
    head.append(make('span', '', 'Joints'), make('b', '', String(controllableJoints(robot).length)))
    const list = make('fieldset', 'joints')
    const legend = make('legend', 'sr', 'Joint angles')
    list.append(legend)
    joints.forEach((j, i) => {
      const u = displayUnits(j)
      const [lo, hi] = jointRange(j)
      const row = make('div', 'joint')
      const id = `${uid}-j${i}`
      const label = make('label', '', j.name)
      label.htmlFor = id
      label.title = j.name
      const out = make('output')
      out.htmlFor = id
      const input = document.createElement('input')
      input.type = 'range'
      input.id = id
      // keep zero on the step grid (a range steps from its min); the engine clamps the small overhang to the real limit
      input.min = String(Math.floor(u.toUi(lo) / u.step + 1e-9) * u.step)
      input.max = String(Math.ceil(u.toUi(hi) / u.step - 1e-9) * u.step)
      input.step = String(u.step)
      if (j.mimic) {
        input.disabled = true
        row.classList.add('mimic')
        input.title = `follows ${j.mimic.joint}`
      }
      input.addEventListener('input', () => onJoint(j.name, u.fromUi(Number(input.value))))
      const limits = make('div', 'limits')
      limits.setAttribute('aria-hidden', 'true')
      limits.append(make('span', '', fmt(u.toUi(lo), u.digits) + u.suffix), make('span', '', j.type === 'continuous' ? 'continuous' : ''), make('span', '', fmt(u.toUi(hi), u.digits) + u.suffix))
      row.append(label, out, input, limits)
      list.append(row)
      rows.set(j.name, { row, input, out, u, lo, hi, joint: j })
    })
    panel.append(head, list)
  }

  const foot = make('div', 'foot')
  const hint = make('p', 'hint', ik ? 'Drag a part to move it. Drag empty space to turn.' : 'Drag to turn, scroll or pinch to zoom.')
  const reset = make('button', 'reset', 'Reset')
  reset.type = 'button'
  reset.addEventListener('click', onReset)
  foot.append(hint, reset)
  panel.append(foot)

  return {
    /** Show new values. Leaves the slider being dragged alone so it does not fight the pointer. */
    update(values, skip = null) {
      for (const [name, r] of rows) {
        const v = values[name] ?? 0
        const ui = r.u.toUi(v)
        if (name !== skip) r.input.value = String(ui)
        r.out.textContent = fmt(ui, r.u.digits) + r.u.suffix
        r.input.setAttribute('aria-valuetext', `${fmt(ui, r.u.digits)} ${r.u.word}`)
        const span = r.hi - r.lo
        const pct = (x) => (span > 0 ? ((x - r.lo) / span) * 100 : 50)
        const zero = Math.min(r.hi, Math.max(r.lo, 0))
        r.input.style.setProperty('--from', `${Math.min(pct(zero), pct(v)).toFixed(2)}%`)
        r.input.style.setProperty('--to', `${Math.max(pct(zero), pct(v)).toFixed(2)}%`)
        r.row.classList.toggle('near', r.joint.type !== 'continuous' && span > 0 && (v - r.lo < span * NEAR || r.hi - v < span * NEAR))
      }
    },
    setActivePose(name) {
      for (const [n, b] of poseButtons) b.setAttribute('aria-pressed', String(n === name))
    },
  }
}
