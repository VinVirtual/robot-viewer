// Drag a part of the robot to move it: a ray from the pointer picks a link, then each pointer move sets a target
// on a plane facing the camera and CCD inverse kinematics turns the joints above that link toward it.
import { Raycaster, Vector2, Vector3, Plane, Matrix4 } from 'three'
import { solveCCD } from '../core/ik.js'
import { chainTo, MOVING } from '../core/kinematics.js'

/** The link a scene object belongs to (its nearest ancestor marked as a link). */
export function linkOf(object) {
  for (let o = object; o; o = o.parent) if (o.userData && o.userData.rv === 'link') return o.userData.name
  return null
}

export function createDrag({ canvas, camera, setOrbit, robotNode, robot, index, getValues, apply, requestRender, marker, highlight, onEnd }) {
  const ray = new Raycaster()
  const ndc = new Vector2()
  const plane = new Plane()
  const hitWorld = new Vector3()
  const inv = new Matrix4()
  let drag = null
  let hoverFrame = 0, lastHover = null

  const movable = (link) => !!link && chainTo(robot, link, index).some((j) => MOVING.has(j.type) && !j.mimic)

  const pick = (e) => {
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    const hits = ray.intersectObject(robotNode, true).filter((h) => h.object.isMesh && h.object.visible && h.object !== marker)
    if (!hits.length) return null
    const link = linkOf(hits[0].object)
    return movable(link) ? { link, point: hits[0].point.clone() } : null
  }

  const onDown = (e) => {
    if (e.button !== 0 || !e.isPrimary) return
    const hit = pick(e)
    if (!hit) return
    // the part takes this gesture; orbit controls never see it
    e.stopImmediatePropagation()
    e.preventDefault()
    canvas.setPointerCapture(e.pointerId)
    const linkNode = index.linkNodes.get(hit.link)
    linkNode.updateWorldMatrix(true, false)
    const local = hit.point.clone().applyMatrix4(inv.copy(linkNode.matrixWorld).invert())
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), hit.point)
    drag = { id: e.pointerId, link: hit.link, local: [local.x, local.y, local.z] }
    setOrbit(false)
    canvas.classList.add('grabbing')
    marker.position.copy(hit.point)
    marker.visible = true
    highlight(hit.link)
    requestRender()
  }

  const onMove = (e) => {
    if (drag && e.pointerId === drag.id) {
      const r = canvas.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      if (!ray.ray.intersectPlane(plane, hitWorld)) return
      marker.position.copy(hitWorld)
      robotNode.updateWorldMatrix(true, false)
      const t = hitWorld.clone().applyMatrix4(inv.copy(robotNode.matrixWorld).invert())
      const res = solveCCD(robot, getValues(), { link: drag.link, point: drag.local, target: [t.x, t.y, t.z], iterations: 10, maxStep: 0.35 }, index)
      apply(res.values, 'drag')
      return
    }
    if (e.pointerType !== 'mouse' || hoverFrame) return
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0
      const hit = pick(e)
      const link = hit ? hit.link : null
      canvas.classList.toggle('grab', !!link)
      if (link !== lastHover) { lastHover = link; highlight(link); requestRender() }
    })
  }

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    drag = null
    setOrbit(true)
    canvas.classList.remove('grabbing')
    marker.visible = false
    highlight(lastHover)
    requestRender()
    onEnd()
  }

  const onLeave = () => { if (!drag && lastHover) { lastHover = null; canvas.classList.remove('grab'); highlight(null); requestRender() } }

  // a touch that grabbed a part must not scroll the page; other touches scroll as usual
  const onTouchStart = (e) => { if (drag) e.preventDefault() }
  canvas.addEventListener('touchstart', onTouchStart, { passive: false })
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('pointerleave', onLeave)
  return {
    dispose() {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', end)
      canvas.removeEventListener('pointercancel', end)
      canvas.removeEventListener('pointerleave', onLeave)
    },
  }
}
