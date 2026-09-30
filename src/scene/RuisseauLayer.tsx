/**
 * Le lit du ruisseau à l'écran : les galets de rivière, les vieilles souches
 * moussues et la branche morte (`ruisseau.glb`), posés par `plan/ruisseau.ts`.
 *
 * Un lot d'instances par modèle de galet (sept, un seul matériau), un pour les
 * souches, un maillage pour la branche : neuf appels de dessin. Le galet est
 * mouillé sous le fil de l'eau — plus sombre, plus saturé, luisant —, imbibé
 * sur quelques centimètres au-dessus, sec et mat plus haut ; certains, hors de
 * l'eau, prennent la mousse sur le dessus.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { JARDIN } from '../plan/jardin'
import { GALETS_DU_RUISSEAU, SOUCHES } from '../plan/ruisseau'
import { PARC } from '../plan/visibilite'
import { intemperer } from './intemperies'
import type { PiecesDuRuisseau } from './parkAssets'

export function Ruisseau({ pieces }: { pieces: PiecesDuRuisseau }) {
  const materiaux = useMemo(() => {
    const galet = pieces.galets.flat()[0]?.material
    const souche = pieces.souche[0]?.material
    const branche = pieces.branche[0]?.material
    if (galet) mouiller(galet)
    if (souche) moussue(souche)
    for (const m of [galet, souche, branche]) if (m) intemperer(m)
    return { galet, souche, branche }
  }, [pieces])

  const branche = useMemo(() => {
    const { de, a } = JARDIN.souches.branche
    const d = new THREE.Vector3(a[0] - de[0], a[1] - de[1], a[2] - de[2])
    const l = d.length()
    // La branche est modelée le long de +x, 3 m depuis son pied (build-ruisseau.py).
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize())
    return new THREE.Matrix4().compose(new THREE.Vector3(...de), q, new THREE.Vector3().setScalar(l / 3))
  }, [])

  return (
    <group name="ruisseau">
      {pieces.galets.map((lots, modele) =>
        lots.map((p, i) => <Galets key={`${modele}:${i}`} piece={p} modele={modele} />))}
      {pieces.souche.map((p, i) => <Souches key={i} piece={p} />)}
      {pieces.branche.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={materiaux.branche ?? p.material} matrixAutoUpdate={false} matrix={branche} userData={{ zone: PARC }} />
      ))}
    </group>
  )
}

const HAUT = new THREE.Vector3(0, 1, 0)

function Galets({ piece, modele }: { piece: { geometry: THREE.BufferGeometry; material: THREE.Material }; modele: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const sujets = useMemo(() => GALETS_DU_RUISSEAU.filter((g) => g.modele === modele), [modele])
  // Par instance : la teinte, la cote de l'eau où il baigne, et s'il prend la mousse.
  const geometrie = useMemo(() => {
    const g = piece.geometry.clone()
    const attr = new Float32Array(sujets.length * 4)
    sujets.forEach((s, i) => {
      const niveau = s.etang ? JARDIN.etang.niveau : JARDIN.ruisseau.niveau
      // w : le basalte (modèle 5), dont la texture Meshy porte une tache blanche qu’on repeint en noir.
      attr.set([s.teinte, niveau, (s.teinte * 7.31) % 1 < 0.35 ? 1 : 0, s.modele === 4 ? 1 : 0], 4 * i)
    })
    g.setAttribute('aGalet', new THREE.InstancedBufferAttribute(attr, 4))
    return g
  }, [piece, sujets])
  useEffect(() => () => geometrie.dispose(), [geometrie])
  useLayoutEffect(() => {
    const m = ref.current
    if (m === null) return
    const q = new THREE.Quaternion()
    sujets.forEach((s, i) => m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(HAUT, s.lacet), new THREE.Vector3().setScalar(s.echelle))))
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [sujets])
  return <instancedMesh ref={ref} args={[geometrie, undefined, sujets.length]} material={piece.material} userData={{ zone: PARC }} />
}

function Souches({ piece }: { piece: { geometry: THREE.BufferGeometry; material: THREE.Material } }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (m === null) return
    const q = new THREE.Quaternion()
    SOUCHES.forEach((s, i) => m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(HAUT, s.lacet), new THREE.Vector3().setScalar(s.echelle))))
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [])
  return <instancedMesh ref={ref} args={[piece.geometry, undefined, SOUCHES.length]} material={piece.material} userData={{ zone: PARC }} />
}

/**
 * Le galet mouillé sous le fil de l'eau (la cote de `aGalet.y`), imbibé sur
 * trois centimètres au-dessus — un liseré qui ondule —, sec et mat plus haut,
 * moussu sur le dessus pour un sur trois des galets hors de l'eau.
 */
function mouiller(m: THREE.Material): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aGalet;\nvarying vec4 vGalet;\nvarying vec4 vGaletMonde;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vGalet = aGalet;
  {
    vec4 gP = vec4(transformed, 1.0);
    vec3 gN = objectNormal;
    #ifdef USE_INSTANCING
      gP = instanceMatrix * gP;
      gN = mat3(instanceMatrix) * gN;
    #endif
    vGaletMonde = vec4((modelMatrix * gP).xyz, normalize(mat3(modelMatrix) * gN).y);
  }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vGalet;\nvarying vec4 vGaletMonde;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  float gSous = vGalet.y - vGaletMonde.y + 0.008 * sin(vGaletMonde.x * 37.0 + 3.0 * sin(vGaletMonde.z * 23.0));
  float gMouille = smoothstep(-0.035, 0.0, gSous);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.052, 0.048) * (0.8 + 0.4 * diffuseColor.g), vGalet.w * smoothstep(0.18, 0.4, dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))));
  diffuseColor.rgb *= vGalet.x;
  float gLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  vec3 gSec = mix(diffuseColor.rgb, vec3(gLum), 0.2);
  vec3 gHumide = pow(diffuseColor.rgb, vec3(1.3)) * 0.7;
  diffuseColor.rgb = mix(gSec, gHumide, gMouille);
  float gMousse = vGalet.z * smoothstep(0.5, 0.85, vGaletMonde.w) * (1.0 - smoothstep(-0.07, -0.03, gSous));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.23, 0.07) * (0.7 + 1.2 * gLum), gMousse);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(0.75, 0.2, gMouille), 0.95, gMousse);',
      )
  }
  m.customProgramCacheKey = () => 'ruisseau:galet'
  m.needsUpdate = true
}

/**
 * La mousse de la souche, plus drue que la texture Meshy ne la rend : les
 * verts pâles saturés, un coussin de mousse sur ce qui regarde le ciel (la
 * cassure pâle du fût, les dos des racines), et le pied, qui trempe, foncé.
 */
function moussue(m: THREE.Material): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vSouche;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  {
    vec4 sP = vec4(transformed, 1.0);
    vec3 sN = objectNormal;
    #ifdef USE_INSTANCING
      sP = instanceMatrix * sP;
      sN = mat3(instanceMatrix) * sN;
    #endif
    vSouche = vec4((modelMatrix * sP).xyz, normalize(mat3(modelMatrix) * sN).y);
  }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vSouche;\nconst float NIVEAU_SOUCHE = ${JARDIN.ruisseau.niveau.toFixed(3)};`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  {
    vec3 c = diffuseColor.rgb;
    float vert = clamp((c.g - max(c.r, c.b)) * 6.0, 0.0, 1.0);
    diffuseColor.rgb = mix(c, c * vec3(0.72, 1.0, 0.45), vert * 0.7);
    float lum = dot(c, vec3(0.3, 0.59, 0.11));
    float coussin = smoothstep(0.45, 0.85, vSouche.w + 0.35 * sin(vSouche.x * 23.0 + 2.0 * sin(vSouche.z * 17.0)));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.22, 0.05) * (0.7 + 1.3 * lum), coussin * 0.85);
    diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(NIVEAU_SOUCHE - 0.01, NIVEAU_SOUCHE + 0.08, vSouche.y));
  }`,
      )
  }
  m.customProgramCacheKey = () => 'ruisseau:souche'
  m.needsUpdate = true
}
