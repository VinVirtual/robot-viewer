// The 3D part of <robot-viewer>, loaded on demand by element.js.
// three.js draws the robot from its GLB; joints are moved by setting the transform of each joint's child link node.
import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Box3, Vector3, Sphere,
  Mesh, PlaneGeometry, ShadowMaterial, SphereGeometry, MeshBasicMaterial, Color,
  PCFShadowMap, NeutralToneMapping, LineSegments, LineBasicMaterial, BufferGeometry, Float32BufferAttribute, SRGBColorSpace, PMREMGenerator, Spherical, MathUtils,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'meshopt-js-decoder'
import { resolveValues, indexRobot, controllableJoints, MOVING } from '../core/kinematics.js'
import { createTween, sampleTween, tweenDuration } from '../core/tween.js'
import { buildPanel } from './panel.js'
import { createDrag } from './drag.js'

const FORMAT = 'robot-viewer/1'
let uidCounter = 0

/** Read a CSS colour (any syntax the browser knows, oklch included) as linear-ready sRGB through a 1x1 canvas. */
function cssColor(value, fallback) {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = fallback
    ctx.fillStyle = value.trim() || fallback
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
  } catch { return new Color(fallback) }
}

/** Check the description stored in the GLB before trusting it. */
export function checkDescription(d) {
  if (!d || d.format !== FORMAT) throw new Error('this GLB was not made by robot-viewer build (no joints description inside)')
  if (!Array.isArray(d.joints) || !Array.isArray(d.links) || typeof d.root !== 'string') throw new Error('the joints description in this GLB is incomplete')
  for (const j of d.joints) {
    if (typeof j.name !== 'string' || !Array.isArray(j.axis) || j.axis.length !== 3) throw new Error(`joint ${JSON.stringify(j.name)} is malformed`)
  }
  return d
}

/** Floor grid in round-number steps (1, 2 or 5 x 10^n metres) that fades out away from the robot. */
export function gridStep(radius) {
  const raw = radius / 4
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw * 0.75) || p * 10
}

function fadingGrid(radius) {
  const step = gridStep(radius)
  const reach = radius * 3
  const n = Math.ceil(reach / step)
  const pos = [], col = []
  const alpha = (x, z) => Math.max(0, 1 - Math.hypot(x, z) / reach) ** 1.6
  const seg = (x1, z1, x2, z2) => {
    // split long lines so the fade follows the distance from the centre
    const parts = 16
    for (let k = 0; k < parts; k++) {
      const a = k / parts, b = (k + 1) / parts
      const ax = x1 + (x2 - x1) * a, az = z1 + (z2 - z1) * a, bx = x1 + (x2 - x1) * b, bz = z1 + (z2 - z1) * b
      pos.push(ax, 0, az, bx, 0, bz)
      col.push(1, 1, 1, alpha(ax, az), 1, 1, 1, alpha(bx, bz))
    }
  }
  for (let i = -n; i <= n; i++) { seg(i * step, -n * step, i * step, n * step); seg(-n * step, i * step, n * step, i * step) }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 4))
  const m = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0.9 })
  return new LineSegments(g, m)
}

function parseOrbit(text) {
  const [az, el] = String(text || '').trim().split(/\s+/).map(Number)
  return { az: Number.isFinite(az) ? az : 35, el: Number.isFinite(el) ? Math.max(-5, Math.min(85, el)) : 18 }
}

export async function mount(host, ui) {
  const { stage, panel, poster, reducedMotion } = ui
  const controlsMode = ['poses', 'none'].includes(host.getAttribute('controls')) ? host.getAttribute('controls') : 'full'
  const canIk = host.hasAttribute('ik')

  // ---- load first, so a broken file leaves the poster untouched ----
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync(new URL(host.getAttribute('src'), document.baseURI).href)
  let robotNode = null
  const linkNodes = new Map()
  gltf.scene.traverse((o) => {
    const rv = o.userData && o.userData.rv
    if (rv === 'robot') robotNode = o
    if (rv === 'link') linkNodes.set(o.userData.name, o)
  })
  if (!robotNode) throw new Error('this GLB was not made by robot-viewer build')
  const robot = checkDescription(robotNode.userData.robotViewer)
  const index = { ...indexRobot(robot), linkNodes }
  const moving = robot.joints.filter((j) => MOVING.has(j.type) && linkNodes.has(j.child))
  const axes = new Map(moving.map((j) => [j.name, new Vector3(...j.axis)]))
  const poseNames = Object.keys(robot.poses || {})
  const defaultValues = () => resolveValues(robot, (robot.defaultPose && robot.poses[robot.defaultPose]) || {}, index)

  // each link gets its own copy of its materials so one part can light up on hover
  const linkMeshes = new Map()
  for (const [name, node] of linkNodes) {
    const meshes = []
    for (const child of node.children) {
      if (child.userData && child.userData.rv === 'joint') continue
      child.traverse((o) => {
        if (!o.isMesh) return
        o.material = o.material.clone()
        o.castShadow = true
        o.receiveShadow = true
        meshes.push(o)
      })
    }
    linkMeshes.set(name, meshes)
  }

  // ---- renderer, scene, light ----
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.setAttribute('tabindex', '0')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', `${host.getAttribute('alt') || robot.robot}. 3D view: arrow keys turn it, plus and minus zoom, Home resets.`)

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.45
  pmrem.dispose()
  scene.add(new HemisphereLight(0xffffff, 0x8a8478, 0.4))
  const key = new DirectionalLight(0xffffff, 2.4)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.02
  key.shadow.radius = 5
  scene.add(key, key.target)
  const rim = new DirectionalLight(0xdfe8ff, 0.8)
  scene.add(rim)
  scene.add(gltf.scene)

  // ---- joint state ----
  let values = defaultValues()
  const setNodes = (v) => {
    for (const j of moving) {
      const node = linkNodes.get(j.child)
      const x = v[j.name] ?? 0
      if (j.type === 'prismatic') node.position.copy(axes.get(j.name)).multiplyScalar(x)
      else node.quaternion.setFromAxisAngle(axes.get(j.name), x)
    }
  }
  setNodes(values)

  // ---- framing: the floor sits under the default pose; the view fits every named pose ----
  const boxAt = (valueSets) => {
    const box = new Box3()
    for (const v of valueSets) {
      setNodes(v)
      gltf.scene.updateMatrixWorld(true)
      box.union(new Box3().setFromObject(robotNode, true))
    }
    setNodes(values)
    gltf.scene.updateMatrixWorld(true)
    return box
  }
  const restBox = boxAt([values])
  const allBox = boxAt([values, ...poseNames.map((n) => resolveValues(robot, robot.poses[n], index))])
  // frame the robot as it first appears, leaving some room toward where its other poses reach
  const poseBox = new Box3(restBox.min.clone().lerp(allBox.min, 0.5), restBox.max.clone().lerp(allBox.max, 0.5))
  const radius = Math.max(allBox.getBoundingSphere(new Sphere()).radius, 1e-3)
  const floorY = restBox.min.y
  const target = new Vector3()
  const camera = new PerspectiveCamera(30, 1, radius / 100, radius * 60)
  const orbit = parseOrbit(host.getAttribute('orbit'))
  let fitDistance = radius * 4
  /** Aim at a box's centre and find the distance at which all 8 corners fit inside `fill` of the view. */
  const fit = (box, fill = 0.86) => {
    box.getCenter(target)
    const dir = new Vector3().setFromSpherical(new Spherical(1, MathUtils.degToRad(90 - orbit.el), MathUtils.degToRad(orbit.az)))
    const back = dir.clone().normalize()
    const right = new Vector3(0, 1, 0).cross(back).normalize()
    const up = back.clone().cross(right)
    const tanV = Math.tan(MathUtils.degToRad(camera.fov) / 2) * fill
    const tanH = tanV * Math.max(0.2, camera.aspect)
    let d = 0
    for (let i = 0; i < 8; i++) {
      const p = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target)
      d = Math.max(d, Math.abs(p.dot(right)) / tanH + p.dot(back), Math.abs(p.dot(up)) / tanV + p.dot(back))
    }
    fitDistance = Math.max(d, radius * 0.6)
  }
  const placeCamera = (az, el, dist = fitDistance) => {
    const s = new Spherical(dist, MathUtils.degToRad(90 - el), MathUtils.degToRad(az))
    camera.position.setFromSpherical(s).add(target)
    camera.lookAt(target)
  }
  key.position.set(radius * 2.2, floorY + radius * 4, radius * 2.6)
  key.target.position.set(poseBox.getCenter(new Vector3()).x, floorY, poseBox.getCenter(new Vector3()).z)
  const sc = key.shadow.camera
  sc.left = sc.bottom = -radius * 2.5
  sc.right = sc.top = radius * 2.5
  sc.near = radius * 0.5
  sc.far = radius * 14
  sc.updateProjectionMatrix()
  rim.position.set(-radius * 3, floorY + radius * 1.5, -radius * 3)

  const shadowMat = new ShadowMaterial({ opacity: 0.22 })
  const floor = new Mesh(new PlaneGeometry(radius * 10, radius * 10), shadowMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(key.target.position.x, floorY, key.target.position.z)
  floor.receiveShadow = true
  scene.add(floor)
  const grid = fadingGrid(radius)
  grid.position.set(key.target.position.x, floorY + radius * 0.0005, key.target.position.z)
  grid.visible = host.getAttribute('grid') !== 'off'
  scene.add(grid)

  const marker = new Mesh(new SphereGeometry(radius * 0.025, 20, 12), new MeshBasicMaterial({ color: 0xff6a00, depthTest: false, transparent: true, opacity: 0.95 }))
  marker.renderOrder = 10
  marker.visible = false
  scene.add(marker)

  const applyTheme = () => {
    const cs = getComputedStyle(host)
    grid.material.color.copy(cssColor(cs.getPropertyValue('--rv-grid'), '#bbbbbb'))
    const accent = cssColor(cs.getPropertyValue('--rv-accent'), '#ff6a00')
    marker.material.color.copy(accent)
    hoverColor.copy(accent)
    const s = parseFloat(cs.getPropertyValue('--rv-shadow'))
    shadowMat.opacity = Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 0.22
    requestRender()
  }
  const hoverColor = new Color(0xff6a00)

  // ---- controls ----
  stage.prepend(canvas)
  let frame = 0
  let tween = null
  let tweenDone = null
  let shown = false
  const requestRender = () => { if (!frame) frame = requestAnimationFrame(tick) }

  let panelApi = null
  let activePose = null
  const emit = (type, detail) => host.dispatchEvent(new CustomEvent(type, { detail }))
  const apply = (v, source = 'api', skip = null) => {
    values = resolveValues(robot, v, index)
    setNodes(values)
    panelApi && panelApi.update(values, skip)
    requestRender()
    emit('joint-change', { values: { ...values }, source })
  }
  const stopTween = () => {
    if (!tween) return
    tween = null
    if (tweenDone) { tweenDone(false); tweenDone = null }
  }
  const setActive = (name) => { activePose = name; panelApi && panelApi.setActivePose(name) }

  let highlighted = null
  const highlight = (link) => {
    if (link === highlighted) return
    for (const m of linkMeshes.get(highlighted) || []) m.material.emissive && m.material.emissive.setRGB(0, 0, 0)
    highlighted = link
    for (const m of linkMeshes.get(link) || []) if (m.material.emissive) { m.material.emissive.copy(hoverColor); m.material.emissiveIntensity = 0.22 }
  }

  const drag = canIk ? createDrag({
    canvas, camera, robotNode, robot, index, marker, highlight, requestRender,
    setOrbit: (on) => { controls.enabled = on },
    getValues: () => values,
    apply: (v, source) => { stopTween(); setActive(null); apply(v, source) },
    onEnd: () => emit('drag-end', { values: { ...values } }),
  }) : null

  // created after the drag handler, so a press on a part reaches the drag handler first
  const controls = new OrbitControls(camera, canvas)
  controls.target.copy(target)
  controls.enableDamping = !reducedMotion
  controls.dampingFactor = 0.09
  controls.rotateSpeed = 0.8
  controls.minDistance = radius * 0.5
  controls.maxDistance = radius * 14
  controls.maxPolarAngle = Math.PI * 0.495
  controls.update()
  controls.addEventListener('change', requestRender)

  canvas.addEventListener('keydown', (e) => {
    const off = camera.position.clone().sub(controls.target)
    const s = new Spherical().setFromVector3(off)
    const step = MathUtils.degToRad(e.shiftKey ? 2 : 10)
    if (e.key === 'ArrowLeft') s.theta -= step
    else if (e.key === 'ArrowRight') s.theta += step
    else if (e.key === 'ArrowUp') s.phi = Math.max(0.05, s.phi - step)
    else if (e.key === 'ArrowDown') s.phi = Math.min(controls.maxPolarAngle, s.phi + step)
    else if (e.key === '+' || e.key === '=') s.radius = Math.max(controls.minDistance, s.radius * 0.9)
    else if (e.key === '-' || e.key === '_') s.radius = Math.min(controls.maxDistance, s.radius * 1.1)
    else if (e.key === 'Home') { touched = false; fit(poseBox); placeCamera(orbit.az, orbit.el); controls.target.copy(target); controls.update(); requestRender(); e.preventDefault(); return }
    else return
    e.preventDefault()
    touched = true
    camera.position.setFromSpherical(s).add(controls.target)
    camera.lookAt(controls.target)
    controls.update()
    requestRender()
  })

  function tick(now) {
    frame = 0
    let again = false
    if (tween) {
      const s = sampleTween(tween, now)
      apply(s.values, 'pose')
      if (s.done) { tween = null; if (tweenDone) { tweenDone(true); tweenDone = null } } else again = true
    }
    if (controls.enableDamping && controls.update()) again = true
    renderer.render(scene, camera)
    if (!shown) {
      shown = true
      canvas.classList.add('shown')
      poster.classList.add('gone')
      emit('load', { robot: robot.robot, joints: controllableJoints(robot).map((j) => j.name), poses: poseNames })
    }
    if (again) requestRender()
  }

  const goToPose = (name, { animate = true } = {}) => {
    if (!(name in (robot.poses || {}))) return Promise.resolve(false)
    stopTween()
    setActive(name)
    const to = resolveValues(robot, robot.poses[name], index)
    const seconds = animate && !reducedMotion ? tweenDuration(robot, values, to) : 0
    emit('pose-change', { pose: name })
    if (seconds === 0) { apply(to, 'pose'); return Promise.resolve(true) }
    tween = createTween(values, to, performance.now(), seconds * 1000)
    requestRender()
    return new Promise((resolve) => { tweenDone = resolve })
  }

  const uid = `rv${++uidCounter}`
  panelApi = buildPanel(panel, robot, {
    poses: poseNames, mode: controlsMode, ik: canIk, uid,
    onJoint: (name, v) => { stopTween(); setActive(null); apply({ ...values, [name]: v }, 'slider', name) },
    onPose: (name) => { goToPose(name) },
    onReset: () => {
      touched = false
      fit(poseBox)
      placeCamera(orbit.az, orbit.el)
      controls.target.copy(target)
      controls.update()
      if (robot.defaultPose) goToPose(robot.defaultPose)
      else { stopTween(); setActive(null); apply({}, 'reset') }
    },
  })
  panelApi.update(values)
  if (robot.defaultPose) setActive(robot.defaultPose)

  // ---- size, theme, start ----
  let touched = false
  controls.addEventListener('start', () => { touched = true })
  const resize = () => {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // until someone turns the view, keep the robot fitted to the new shape
    if (!touched) { fit(poseBox); placeCamera(orbit.az, orbit.el); controls.target.copy(target); controls.update() }
    requestRender()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(stage)
  resize()
  const media = matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', applyTheme)
  applyTheme()

  const initial = host.getAttribute('pose')
  if (initial && initial in (robot.poses || {})) goToPose(initial, { animate: false })
  requestRender()

  return {
    joints: () => controllableJoints(robot).map((j) => ({ name: j.name, type: j.type, lower: j.type === 'continuous' ? -Math.PI : j.limit?.lower ?? 0, upper: j.type === 'continuous' ? Math.PI : j.limit?.upper ?? 0 })),
    poseNames: () => [...poseNames],
    values: () => ({ ...values }),
    setJoint: (name, v) => { stopTween(); setActive(null); apply({ ...values, [name]: Number(v) }, 'api') },
    setJoints: (v) => { stopTween(); setActive(null); apply({ ...values, ...v }, 'api') },
    goToPose,
    /** Fit the view to the pose shown now (used for stills), or to every named pose. */
    /** Where a link's origin is on screen, in page pixels (for tools that drive the viewer, such as the recorder). */
    linkScreenPoint(name, local = [0, 0, 0]) {
      const node = linkNodes.get(name)
      if (!node) return null
      node.updateWorldMatrix(true, false)
      const p = new Vector3(...local).applyMatrix4(node.matrixWorld).project(camera)
      const r = canvas.getBoundingClientRect()
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
    },
    fitView({ current = false } = {}) {
      touched = current
      fit(current ? boxAt([values]) : poseBox, current ? 0.92 : 0.86)
      placeCamera(orbit.az, orbit.el)
      controls.target.copy(target)
      controls.update()
      requestRender()
    },
    attributeChanged(name, value) {
      if (name === 'theme') applyTheme()
      if (name === 'grid') { grid.visible = value !== 'off'; requestRender() }
      if (name === 'pose' && value) goToPose(value)
    },
    dispose() {
      ro.disconnect()
      media.removeEventListener('change', applyTheme)
      drag && drag.dispose()
      controls.dispose()
      renderer.dispose()
    },
  }
}
