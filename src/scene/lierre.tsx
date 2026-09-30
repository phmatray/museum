/**
 * Le lierre du mur d'enceinte à l'écran (`plan/lierre.ts` l'a fait pousser) :
 * une carte par feuille, par rameau ou par bout de tige, toutes instanciées —
 * un appel de dessin par côté du parc, que le cône de vue écarte d'un bloc.
 *
 * Les feuilles sont dessinées sur un canevas : la feuille adulte du lierre
 * commun, à cinq lobes, ses nervures pâles en éventail ; la jeune, à trois
 * lobes, plus claire ; un rameau de cinq feuilles ; un bout de tige ligneuse
 * hérissée de crampons. Le lierre est persistant : l'automne n'en rougit
 * qu'une feuille sur cinq, l'hiver le fonce et la neige poudre celles qui
 * regardent le ciel ; la pluie le fait luire.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import type { PlaqueDeLierre } from '../plan/enceinte'
import { lierreDuMur, type Feuille } from '../plan/lierre'
import { PARC } from '../plan/visibilite'
import { avecMonde, greffer } from './intemperies'

const CELLULE = 256

/** Une feuille de lierre, pétiole en (0, 0), pointe vers +y ; `lobes` 5 ou 3, `r` sa longueur. */
function contourDeFeuille(ctx: CanvasRenderingContext2D, lobes: 3 | 5, r: number, alea: () => number) {
  // Les pointes des lobes (angle depuis la pointe, longueur), et entre elles les sinus.
  const pointes: [number, number][] = lobes === 5
    ? [[-2.05, 0.46], [-1.15, 0.72], [0, 1], [1.15, 0.72], [2.05, 0.46]]
    : [[-1.25, 0.66], [0, 1], [1.25, 0.66]]
  const centre = { x: 0, y: r * 0.36 }
  const point = (a: number, l: number) => ({ x: centre.x + Math.sin(a) * l * r * 0.64, y: centre.y + Math.cos(a) * l * r * 0.64 })
  const j = () => 1 + (alea() - 0.5) * 0.12
  ctx.beginPath()
  ctx.moveTo(0, r * 0.06)
  const debut = point(-2.75, 0.3)
  ctx.quadraticCurveTo(-r * 0.12, r * 0.02, debut.x, debut.y)
  pointes.forEach(([a, l], k) => {
    const p = point(a * j(), l * j())
    const avant = k === 0 ? -2.75 : (pointes[k - 1][0] + a) / 2
    const s = point(avant, (lobes === 5 ? 0.42 : 0.5) * j())
    const c1 = point((avant + a) / 2 - 0.12, (s.y + p.y) / (2 * r * 0.64) + 0.25)
    ctx.quadraticCurveTo(s.x, s.y, (s.x + p.x) / 2 + (c1.x - (s.x + p.x) / 2) * 0.2, (s.y + p.y) / 2)
    ctx.quadraticCurveTo(p.x * 0.97, p.y * 0.97, p.x, p.y)
  })
  const fin = point(2.75, 0.3)
  const s = point((pointes[pointes.length - 1][0] + 2.75) / 2, 0.42)
  ctx.quadraticCurveTo(s.x, s.y, fin.x, fin.y)
  ctx.quadraticCurveTo(r * 0.12, r * 0.02, 0, r * 0.06)
  ctx.closePath()
  return { pointes: pointes.map(([a, l]) => point(a, l * 0.92)), centre }
}

/** Une feuille peinte : le limbe sombre et luisant, ses nervures pâles, son pétiole. */
function peindreFeuille(ctx: CanvasRenderingContext2D, lobes: 3 | 5, r: number, teinte: [string, string], alea: () => number) {
  ctx.save()
  const { pointes, centre } = contourDeFeuille(ctx, lobes, r, alea)
  const g = ctx.createRadialGradient(centre.x, centre.y * 0.8, r * 0.05, centre.x, centre.y, r * 0.75)
  g.addColorStop(0, teinte[1])
  g.addColorStop(1, teinte[0])
  ctx.fillStyle = g
  ctx.fill()
  ctx.clip()
  // Le grain du limbe, et un reflet cireux d'un côté de la nervure.
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = alea() < 0.5 ? 'rgba(10, 25, 5, 0.16)' : 'rgba(170, 200, 120, 0.1)'
    ctx.fillRect((alea() - 0.5) * r * 1.4, alea() * r * 1.1, 2, 2)
  }
  const reflet = ctx.createLinearGradient(-r * 0.4, 0, r * 0.4, r)
  reflet.addColorStop(0, 'rgba(255,255,240,0)')
  reflet.addColorStop(0.45, 'rgba(255,255,240,0.1)')
  reflet.addColorStop(0.7, 'rgba(255,255,240,0)')
  ctx.fillStyle = reflet
  ctx.fillRect(-r, 0, 2 * r, 1.2 * r)
  // Les nervures, en éventail depuis le point d'attache.
  ctx.strokeStyle = 'rgba(190, 210, 160, 0.55)'
  ctx.lineCap = 'round'
  for (const p of pointes) {
    ctx.lineWidth = Math.max(1, r * 0.022)
    ctx.beginPath()
    ctx.moveTo(0, r * 0.08)
    ctx.quadraticCurveTo(p.x * 0.4, p.y * 0.55, p.x, p.y)
    ctx.stroke()
  }
  ctx.restore()
  // Le pétiole, qui part vers le haut de la carte.
  ctx.strokeStyle = '#4d3f28'
  ctx.lineWidth = Math.max(1.5, r * 0.035)
  ctx.beginPath()
  ctx.moveTo(0, r * 0.08)
  ctx.lineTo(0, -r * 0.25)
  ctx.stroke()
}

/** Les quatre cartes du lierre, 2 × 2 : feuille adulte, jeune feuille, rameau, tige. */
function atlas(): THREE.Texture | null {
  const c = document.createElement('canvas')
  c.width = c.height = 2 * CELLULE
  const ctx = c.getContext('2d')
  if (ctx === null) return null // jsdom
  let s = 97
  const alea = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const cellule = (k: number, dessin: () => void) => {
    ctx.save()
    ctx.translate((k % 2) * CELLULE, Math.floor(k / 2) * CELLULE)
    ctx.beginPath()
    ctx.rect(4, 4, CELLULE - 8, CELLULE - 8)
    ctx.clip()
    dessin()
    ctx.restore()
  }
  // La carte pend de son pétiole : le haut du canevas est le haut de la carte.
  cellule(0, () => {
    ctx.translate(CELLULE / 2, 30)
    peindreFeuille(ctx, 5, 205, ['#1b3314', '#2f5222'], alea)
  })
  cellule(1, () => {
    ctx.translate(CELLULE / 2, 30)
    peindreFeuille(ctx, 3, 200, ['#2d5219', '#4f7d2c'], alea)
  })
  cellule(2, () => {
    // Un rameau : sa tige qui descend, cinq feuilles de part et d'autre.
    ctx.strokeStyle = '#4a3b27'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(CELLULE / 2, 6)
    ctx.bezierCurveTo(CELLULE * 0.45, 80, CELLULE * 0.58, 160, CELLULE * 0.5, 240)
    ctx.stroke()
    const feuilles: [number, number, number, number, 3 | 5][] = [
      [0.5, 0.1, 0.25, 95, 5], [0.42, 0.3, -0.9, 80, 5], [0.58, 0.42, 0.95, 85, 5], [0.45, 0.62, -0.7, 68, 3], [0.56, 0.75, 0.6, 60, 3], [0.5, 0.86, 0.1, 50, 3],
    ]
    for (const [x, y, a, r, l] of feuilles) {
      ctx.save()
      ctx.translate(x * CELLULE, y * CELLULE)
      ctx.rotate(a)
      peindreFeuille(ctx, l, r, l === 5 ? ['#1d3615', '#335a25'] : ['#28491a', '#44702a'], alea)
      ctx.restore()
    }
  })
  cellule(3, () => {
    // La tige : écorce brun-gris, plus claire au milieu, et ses crampons en poils courts.
    const g = ctx.createLinearGradient(CELLULE * 0.25, 0, CELLULE * 0.75, 0)
    g.addColorStop(0, '#554a3e')
    g.addColorStop(0.5, '#8c7c68')
    g.addColorStop(1, '#554a3e')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(CELLULE * 0.3, 0)
    for (let y = 0; y <= CELLULE; y += 16) ctx.lineTo(CELLULE * (0.28 + 0.04 * alea()), y)
    for (let y = CELLULE; y >= 0; y -= 16) ctx.lineTo(CELLULE * (0.68 + 0.04 * alea()), y)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(120, 100, 75, 0.9)'
    ctx.lineWidth = 3
    for (let i = 0; i < 40; i++) {
      const y = alea() * CELLULE
      const cote = alea() < 0.5 ? -1 : 1
      const x = CELLULE * (0.5 + cote * 0.2)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + cote * (8 + alea() * 16), y + (alea() - 0.3) * 14)
      ctx.stroke()
    }
  })
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** La carte : un carré unité pendu à son bord haut, face +z. */
function carte(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(1, 1)
  g.translate(0, -0.5, 0)
  return g
}

/** Le quart de l'atlas de chaque instance, et le coup de vent sur la pointe des feuilles. */
const VERTEX_UV = /* glsl */ `
  #ifdef USE_MAP
    vMapUv = (vec2(mod(aFeuille.x, 2.0), 1.0 - floor(aFeuille.x / 2.0)) + uv) * 0.5;
  #endif`

function greffeAtlas(s: THREE.WebGLProgramParametersWithUniforms) {
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aFeuille;\nvarying vec3 vFeuille;')
    .replace('#include <uv_vertex>', `#include <uv_vertex>\n${VERTEX_UV}\n  vFeuille = aFeuille;`)
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFeuille;')
    // Le test d'alpha tenu au loin : les mips moyennent l'alpha et les feuilles fondraient.
    .replace(
      '#include <alphatest_fragment>',
      `#ifdef USE_MAP
  {
    vec2 lT = vMapUv * vec2(${2 * CELLULE}.0);
    float lLod = 0.5 * log2(max(dot(dFdx(lT), dFdx(lT)), dot(dFdy(lT), dFdy(lT))));
    diffuseColor.a *= 1.0 + max(0.0, lLod) * 0.3;
  }
  #endif
  #include <alphatest_fragment>`,
    )
}

function matiereDuLierre(map: THREE.Texture | null): { matiere: THREE.MeshStandardMaterial; ombre: THREE.MeshDepthMaterial } {
  const matiere = new THREE.MeshStandardMaterial({ name: 'lierre', map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62, color: map ? '#ffffff' : '#27461c' })
  greffer(matiere, 'lierre', (s) => {
    avecMonde(s)
    greffeAtlas(s)
    s.vertexShader = s.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  {
    // La pointe tremble au vent ; le pétiole (y = 0) reste accroché.
    float lPhase = uTemps * (2.1 + aFeuille.z) + aFeuille.z * 40.0;
    float lAmp = (0.012 + 0.018 * uVent) * step(aFeuille.x, 2.5);
    transformed.z += sin(lPhase) * lAmp * -transformed.y;
    transformed.x += cos(lPhase * 1.3) * lAmp * 0.5 * -transformed.y;
  }`,
    )
    s.fragmentShader = s.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
  if (vFeuille.x < 2.5) {
    // Au fond de la plaque, les feuilles sont dans l'ombre des autres.
    diffuseColor.rgb *= 0.45 + 0.6 * vFeuille.y;
    // Chacune sa nuance ; l'automne en bronze une sur cinq, l'hiver les fonce, pourprées.
    float lA = vFeuille.z;
    diffuseColor.rgb *= mix(vec3(1.08, 1.04, 0.86), vec3(0.88, 1.0, 1.06), fract(lA * 7.3)) * (0.85 + 0.3 * fract(lA * 3.1));
    float lL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    float lBronze = step(lA, 0.2) * clamp(max(uFeuillage, uChute * 0.7), 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lL) * vec3(2.2, 1.0, 0.55), lBronze * 0.75);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85, 0.75, 0.82), uChute * 0.45);
    // Sous la neige, un peu de blanc sur le haut des feuilles tournées vers le ciel, pas des cartes blanches.
    float lNeige = uEnneige * smoothstep(0.45, 0.9, vHaut) * smoothstep(0.35, 0.75, iBruit(vMonde.xz * 9.0 + vMonde.y * 7.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.93), lNeige * 0.65);
  } else {
    // La tige : l'écorce grise des vieux pieds, plus claire que l'ombre des feuilles.
    diffuseColor.rgb *= 0.85 + 0.3 * vFeuille.y;
  }`,
    )
  })
  // La pluie : le lierre fonce et luit (la neige, elle, est dosée plus haut : `intemperer`
  // blanchissait des cartes entières).
  greffer(matiere, 'lierre:pluie', (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `diffuseColor.rgb *= 1.0 - 0.3 * uMouille;
  roughnessFactor = mix(roughnessFactor, 0.25, uMouille);
  #include <emissivemap_fragment>`,
    )
  })
  // L'ombre portée découpe la même feuille : même quart de l'atlas, même test d'alpha.
  const ombre = new THREE.MeshDepthMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide })
  ombre.onBeforeCompile = greffeAtlas
  ombre.customProgramCacheKey = () => 'lierre:ombre'
  return { matiere, ombre }
}

export function Lierre({ plaques }: { plaques: readonly PlaqueDeLierre[] }) {
  const feuilles = useMemo(() => lierreDuMur(plaques), [plaques])
  const map = useMemo(() => atlas(), [])
  const { matiere, ombre } = useMemo(() => matiereDuLierre(map), [map])
  const geometrie = useMemo(() => carte(), [])
  useEffect(() => () => {
    map?.dispose()
    matiere.dispose()
    ombre.dispose()
    geometrie.dispose()
  }, [map, matiere, ombre, geometrie])
  const cotes = useMemo(() => {
    const par = new Map<number, Feuille[]>()
    for (const f of feuilles) par.set(f.cote, [...(par.get(f.cote) ?? []), f])
    return [...par.values()].map((liste) => lot(liste, geometrie))
  }, [feuilles, geometrie])
  useEffect(() => () => cotes.forEach((m) => {
    m.geometry.dispose()
    m.dispose()
  }), [cotes])
  return (
    <>
      {cotes.map((m, i) => (
        <primitive key={i} object={m} material={matiere} customDepthMaterial={ombre} userData={{ zone: PARC }} />
      ))}
    </>
  )
}

/** Un lot d'instances pour un côté du parc : une matrice par carte, et (sorte, jour, aléa). */
function lot(liste: Feuille[], geometrie: THREE.PlaneGeometry): THREE.InstancedMesh {
  const g = geometrie.clone()
  const attr = new Float32Array(liste.length * 3)
  const mesh = new THREE.InstancedMesh(g, undefined, liste.length)
  const m = new THREE.Matrix4()
  const [x, y, z] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  liste.forEach((f, i) => {
    z.set(...f.normale)
    y.set(...f.haut)
    x.crossVectors(y, z).normalize()
    m.makeBasis(x.multiplyScalar(f.largeur), y.multiplyScalar(f.longueur), z)
    m.setPosition(...f.position)
    mesh.setMatrixAt(i, m)
    const alea = Math.abs(Math.sin(f.position[0] * 12.9898 + f.position[1] * 78.233 + f.position[2] * 37.719) * 43758.5453) % 1
    attr.set([f.sorte, f.jour, alea], 3 * i)
  })
  g.setAttribute('aFeuille', new THREE.InstancedBufferAttribute(attr, 3))
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.name = 'lierre'
  return mesh
}
