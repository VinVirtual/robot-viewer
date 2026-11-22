// Writes the meshes of Wren, the small made-up desk arm used as robot-viewer's example.
// One file in each format the converter reads: COLLADA (base), OBJ (shoulder), binary STL (upper arm),
// ASCII STL (forearm). Run from anywhere: node examples/wren/make-meshes.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LatheGeometry, ExtrudeGeometry, Shape, Vector2, Matrix4 } from 'three'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'meshes')
mkdirSync(OUT, { recursive: true })

/** Triangles of a geometry as [[a,b,c], ...] with face normals. */
function triangles(g) {
  const geo = g.index ? g.toNonIndexed() : g
  const p = geo.getAttribute('position').array
  const tris = []
  for (let i = 0; i < p.length; i += 9) {
    const a = [p[i], p[i + 1], p[i + 2]], b = [p[i + 3], p[i + 4], p[i + 5]], c = [p[i + 6], p[i + 7], p[i + 8]]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const l = Math.hypot(...n) || 1
    tris.push({ n: n.map((x) => x / l), v: [a, b, c] })
  }
  return tris
}

const f = (x) => (Math.abs(x) < 5e-7 ? '0' : x.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''))

function binaryStl(g, file) {
  const t = triangles(g)
  const buf = Buffer.alloc(84 + t.length * 50)
  buf.write('Wren example mesh, MIT', 0, 'ascii')
  buf.writeUInt32LE(t.length, 80)
  t.forEach((tri, i) => {
    const o = 84 + i * 50
    ;[tri.n, ...tri.v].forEach((vec, k) => vec.forEach((x, d) => buf.writeFloatLE(x, o + k * 12 + d * 4)))
  })
  writeFileSync(join(OUT, file), buf)
}

function asciiStl(g, file) {
  const lines = ['solid wren_forearm']
  for (const tri of triangles(g)) {
    lines.push(`  facet normal ${tri.n.map(f).join(' ')}`, '    outer loop')
    for (const v of tri.v) lines.push(`      vertex ${v.map(f).join(' ')}`)
    lines.push('    endloop', '  endfacet')
  }
  lines.push('endsolid wren_forearm')
  writeFileSync(join(OUT, file), lines.join('\n') + '\n')
}

function obj(g, file) {
  const lines = ['# Wren shoulder housing (example mesh, MIT)', 'o shoulder']
  const t = triangles(g)
  for (const tri of t) for (const v of tri.v) lines.push(`v ${v.map(f).join(' ')}`)
  for (const tri of t) lines.push(`vn ${tri.n.map(f).join(' ')}`)
  t.forEach((_, i) => lines.push(`f ${i * 3 + 1}//${i + 1} ${i * 3 + 2}//${i + 1} ${i * 3 + 3}//${i + 1}`))
  writeFileSync(join(OUT, file), lines.join('\n') + '\n')
}

/** Minimal COLLADA 1.4.1 file, Z up, metres, one material colour. */
function dae(g, file, rgb) {
  const t = triangles(g)
  const pos = t.flatMap((tri) => tri.v.flat())
  const nor = t.flatMap((tri) => [...tri.n, ...tri.n, ...tri.n])
  const idx = t.flatMap((_, i) => [i * 3, i * 3, i * 3 + 1, i * 3 + 1, i * 3 + 2, i * 3 + 2])
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><contributor><authoring_tool>robot-viewer example</authoring_tool></contributor><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>
  <library_effects><effect id="graphite-fx"><profile_COMMON><technique sid="common"><phong>
    <diffuse><color sid="diffuse">${rgb.map(f).join(' ')} 1</color></diffuse>
  </phong></technique></profile_COMMON></effect></library_effects>
  <library_materials><material id="graphite" name="graphite"><instance_effect url="#graphite-fx"/></material></library_materials>
  <library_geometries><geometry id="base-mesh" name="base"><mesh>
    <source id="base-pos"><float_array id="base-pos-array" count="${pos.length}">${pos.map(f).join(' ')}</float_array>
      <technique_common><accessor source="#base-pos-array" count="${pos.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <source id="base-nor"><float_array id="base-nor-array" count="${nor.length}">${nor.map(f).join(' ')}</float_array>
      <technique_common><accessor source="#base-nor-array" count="${nor.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <vertices id="base-vtx"><input semantic="POSITION" source="#base-pos"/></vertices>
    <triangles material="graphite" count="${t.length}">
      <input semantic="VERTEX" source="#base-vtx" offset="0"/><input semantic="NORMAL" source="#base-nor" offset="1"/>
      <p>${idx.join(' ')}</p>
    </triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="scene"><node id="base" name="base">
    <instance_geometry url="#base-mesh"><bind_material><technique_common><instance_material symbol="graphite" target="#graphite"/></technique_common></bind_material></instance_geometry>
  </node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`
  writeFileSync(join(OUT, file), xml)
}

// base: a stepped turntable, lathed around Z (three lathes around Y, so turn it)
const profile = [[0, 0], [0.095, 0], [0.098, 0.004], [0.098, 0.022], [0.09, 0.026], [0.07, 0.03], [0.066, 0.042], [0, 0.042]].map(([r, z]) => new Vector2(r, z))
const base = new LatheGeometry(profile, 72).applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2))
dae(base, 'base.dae', [0.16, 0.17, 0.19])

/** A flat plate with round ends, `length` long along Z, `width` across X, `thick` along Y, centred on Y. */
function plate(length, rStart, rEnd, thick) {
  const s = new Shape()
  s.absarc(0, 0, rStart, Math.PI, 0, true)
  s.lineTo(rEnd, length)
  s.absarc(0, length, rEnd, 0, Math.PI, false)
  s.lineTo(-rStart, 0)
  const g = new ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 28 })
  // shape is in X-Y with extrusion along Z: turn it so the length runs along Z and the thickness along Y
  return g.applyMatrix4(new Matrix4().makeTranslation(0, 0, -thick / 2)).applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2))
}
// after rotateX(+90): shape Y -> Z, extrusion Z -> -Y
binaryStl(plate(0.22, 0.032, 0.026, 0.036), 'upper_arm.stl')
asciiStl(plate(0.18, 0.026, 0.021, 0.03), 'forearm.stl')

// shoulder: a rounded yoke housing
const yoke = new Shape()
yoke.moveTo(-0.045, 0)
yoke.lineTo(0.045, 0)
yoke.lineTo(0.045, 0.05)
yoke.absarc(0, 0.05, 0.045, 0, Math.PI, false)
yoke.lineTo(-0.045, 0)
const shoulder = new ExtrudeGeometry(yoke, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 3, curveSegments: 32 })
  .applyMatrix4(new Matrix4().makeTranslation(0, 0, -0.035)).applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2))
obj(shoulder, 'shoulder.obj')
console.log(`wrote ${OUT}`)
