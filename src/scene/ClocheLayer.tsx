/**
 * La cloche de l'horloge de la nef : une petite cloche de bronze doré posée sur
 * le cartouche (`build-nef.py` : cadran centré en x 24, y 14,80, z 12,6, rayon
 * 1,95), et son marteau.
 *
 * Elle frappe les heures — autant de coups que l'heure du cadran — et, quand le
 * visiteur entre, un coup par version publiée cette semaine, que le tableau des
 * départs affiche au même moment. Chaque coup d'annonce est publié dans
 * `gameStore.annonce`, pour qui voudrait l'entendre. Le son n'est pas ici.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { versionsRecentes } from '../domain/departs'
import { useCatalogue } from '../hooks/useCatalogue'
import { useGameStore } from '../stores/gameStore'
import { ENTRE_COUPS, coupDeCloche, coupsDeLHeure } from './horloge'

/**
 * Le pied de la cloche : à hauteur du haut du cartouche doré (16,75), assez
 * devant le cadran pour que la cloche (0,68 m de rayon) et son battement ne
 * mordent ni la couronne du cadran (z ≤ 12,72) ni la console dorée qui monte du
 * cartouche vers l'arc nord (x 23,88–24,12, z 12,25–12,58) : c'est à elle que la
 * potence est scellée.
 */
const PIED: [number, number, number] = [24, 16.75, 13.45]
/** Tout est modelé à l'échelle d'une clochette, puis agrandi pour se lire depuis l'entrée. */
const ECHELLE = 2.2
/** Dans le repère du pied : l'axe de la cloche (le pivot du battement), et l'axe du marteau à sa droite. */
const SOMMET: [number, number, number] = [0, 0.52, 0]
/** L'anse qui passe sur l'axe : le cerveau de la cloche est d'autant plus bas. */
const ANSE = 0.06
/** La potence, dans l'axe de la nef : du nu de la console (z 12,58) jusqu'au-dessus de la cloche. */
const POTENCE_Y = SOMMET[1] + 0.12
const CONSOLE_Z = (12.58 - PIED[2]) / ECHELLE
const AXE: [number, number, number] = [0.62, 0.36, 0]
/** Le coup frappe `0,43 s` après son départ : on publie l'annonce à l'impact. */
const IMPACT = 0.43

/** Le profil de la cloche, du cerveau à la pince, en (rayon, hauteur sous le sommet). */
const PROFIL = [
  [0, 0], [0.12, 0], [0.17, -0.03], [0.19, -0.1], [0.2, -0.2], [0.23, -0.3], [0.29, -0.38], [0.31, -0.42], [0.28, -0.42], [0.25, -0.39], [0.19, -0.32], [0, -0.3],
].map(([r, y]) => new THREE.Vector2(r, y))

export function ClocheLayer() {
  const catalogue = useCatalogue()
  const cloche = useRef<THREE.Group>(null)
  const marteau = useRef<THREE.Group>(null)
  /** Les départs des coups, en secondes de l'horloge de rendu ; un coup d'annonce porte sa version. */
  const coups = useRef<{ t: number; annonce?: { key: string; tag: string } }[]>([])
  const maintenant = useRef(0)
  const heure = useRef<number | null>(null)

  // L'arrivée du visiteur : la première fois qu'il quitte l'écran d'accueil, catalogue en main.
  const enVisite = useGameStore((s) => !s.paused)
  const annoncee = useRef(false)
  useEffect(() => {
    if (!enVisite || catalogue === null || annoncee.current) return
    annoncee.current = true
    versionsRecentes(catalogue.values(), new Date(), location.search).forEach((a, i) =>
      coups.current.push({ t: maintenant.current + 1.2 + i * ENTRE_COUPS * 1.5, annonce: { key: a.key, tag: a.release!.tag } }),
    )
  }, [enVisite, catalogue])

  /* eslint-disable react-hooks/immutability -- la cloche et son marteau, tournés en place */
  useFrame(({ clock }) => {
    const t = (maintenant.current = clock.elapsedTime)
    // L'heure pile : autant de coups que d'heures au cadran.
    const d = new Date()
    if (heure.current !== null && d.getHours() !== heure.current && d.getMinutes() === 0) {
      for (let k = 0; k < coupsDeLHeure(d); k++) coups.current.push({ t: t + k * ENTRE_COUPS })
    }
    heure.current = d.getHours()

    // Le dernier coup commencé mène la danse ; les annonces partent à l'impact.
    let dernier = -Infinity
    for (const c of coups.current) {
      if (c.t <= t) dernier = Math.max(dernier, c.t)
      if (c.annonce && t - c.t >= IMPACT) {
        useGameStore.setState({ annonce: { ...c.annonce, at: Date.now() } })
        delete c.annonce
      }
    }
    coups.current = coups.current.filter((c) => c.t > t - 5)
    const { marteau: m, cloche: b } = coupDeCloche(t - dernier)
    if (marteau.current) marteau.current.rotation.z = -m
    if (cloche.current) cloche.current.rotation.z = b
  })
  /* eslint-enable react-hooks/immutability */

  const bronze = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d2a54a', metalness: 0.6, roughness: 0.3, emissive: '#5a3c10', emissiveIntensity: 0.6, side: THREE.DoubleSide }), [])
  const fer = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2622', metalness: 0.7, roughness: 0.45 }), [])
  useEffect(() => () => {
    bronze.dispose()
    fer.dispose()
  }, [bronze, fer])

  return (
    <group position={PIED} scale={ECHELLE}>
      {/* La potence : un bras de fer forgé scellé dans la console dorée, qui avance au-dessus de la cloche. */}
      <mesh position={[0, POTENCE_Y, (CONSOLE_Z - 0.05 + 0.1) / 2]} material={fer}>
        <boxGeometry args={[0.06, 0.06, 0.1 - CONSOLE_Z + 0.05]} />
      </mesh>
      {/* La chape : deux joues pendues au bras, et l'axe qui les traverse, dans le sens du bras. */}
      {[-0.08, 0.08].map((z) => (
        <mesh key={z} position={[0, (POTENCE_Y + SOMMET[1] - 0.04) / 2, z]} material={fer}>
          <boxGeometry args={[0.07, POTENCE_Y - SOMMET[1] + 0.04, 0.02]} />
        </mesh>
      ))}
      <mesh position={SOMMET} rotation-x={Math.PI / 2} material={fer}>
        <cylinderGeometry args={[0.016, 0.016, 0.2, 8]} />
      </mesh>
      {/* La cloche tourne autour de l'axe : son anse l'enserre, le cerveau pend dessous. */}
      <group ref={cloche} position={SOMMET}>
        <mesh material={bronze}>
          <torusGeometry args={[0.035, 0.014, 8, 20]} />
        </mesh>
        <group position={[0, -ANSE, 0]}>
          <mesh material={bronze}>
            <latheGeometry args={[PROFIL, 40]} />
          </mesh>
          {/* Le battant, qu'on devine sous la pince. */}
          <mesh position={[0, -0.36, 0]} material={bronze}>
            <sphereGeometry args={[0.045, 12, 8]} />
          </mesh>
        </group>
      </group>
      {/* Le marteau : une traverse sous la potence, une patte, l'axe, un bras de laiton et sa tête. */}
      <mesh position={[(AXE[0] + 0.05) / 2, POTENCE_Y, 0]} material={fer}>
        <boxGeometry args={[AXE[0] + 0.05, 0.05, 0.05]} />
      </mesh>
      <mesh position={[AXE[0] + 0.02, (AXE[1] + POTENCE_Y) / 2, 0]} material={fer}>
        <boxGeometry args={[0.05, POTENCE_Y - AXE[1] + 0.05, 0.05]} />
      </mesh>
      <group ref={marteau} position={AXE}>
        {/* Le bras part de l'axe vers la cloche, en bas à gauche ; la tête, en travers, frappe la pince. */}
        <mesh position={[-0.13, -0.13, 0]} rotation-z={-Math.PI / 4} material={bronze}>
          <boxGeometry args={[0.035, 0.37, 0.035]} />
        </mesh>
        <mesh position={[-0.27, -0.27, 0]} rotation-z={Math.PI / 4} material={bronze}>
          <cylinderGeometry args={[0.055, 0.055, 0.14, 16]} />
        </mesh>
      </group>
    </group>
  )
}
