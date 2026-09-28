/**
 * Les vitrines de la salle d'honneur, à la manière du musée Cernuschi
 * (`plan/vitrines.ts`, modèle `assets/architecture/vitrines.glb`) : pour chacun
 * des trois meilleurs projets, un grand panneau bordeaux au texte crème — le
 * titre, un filet, le début du README en deux colonnes —, son image OpenGraph
 * dans un cadre doré sculpté, un cartel, et devant, une borne laquée dont
 * l'écran s'éclaire. La borne qu'on regarde de près est publiée dans le
 * magasin : `BorneOeuvre` ouvre alors le README entier.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { couleurDeLangage, partsDeLangages } from '../domain/langages'
import type { Artwork } from '../domain/types'
import { useReadme, useVitrines } from '../hooks/useCatalogue'
import { nearTextureUrl } from '../io/arrayTexture'
import { borneRegardee, chapeau, enColonnes, PANNEAU, readmeEnBlocs, TOILE, VITRINES, type Vitrine } from '../plan/vitrines'
import { useGameStore } from '../stores/gameStore'
import { CARTEL_FONT, TITRE_FONT } from './cartelStyle'

const CREME = '#efe3c8'
const ENCRE = '#2a2620'
/** Le dessus incliné de la borne (`build-vitrines.py` l'imprime) et l'écran qu'on y pose. */
const ECRAN = { y: 1.086, z: 0.005, inclinaison: (25.81 * Math.PI) / 180, largeur: 0.44, hauteur: 0.28 }
/** Les colonnes du panneau : de la marge gauche, deux colonnes de 88 cm, sous le filet. */
/** Le canevas de l'écran, et le bandeau de l'invite, en pixels. */
const W = 640
const H = Math.round((W * ECRAN.hauteur) / ECRAN.largeur)
const BANDEAU = 72
const COLONNES = { u: -1.8, largeur: 0.88, gouttiere: 0.1, haut: 2.66, corps: 0.056, interligne: 1.4, parLigne: 32, lignes: 24 }

type Pieces = Record<'Panneau' | 'Cadre' | 'Borne', THREE.Object3D>

let modele: Promise<Pieces | null> | null = null
function chargerModele(): Promise<Pieces | null> {
  const base = import.meta.env.BASE_URL
  modele ??= (async () => {
    const gltf = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(`${base}draco/`)
    gltf.setDRACOLoader(draco)
    try {
      const { scene } = await gltf.loadAsync(`${base}assets/architecture/vitrines.glb`)
      scene.updateMatrixWorld(true)
      const piece = (nom: string) => scene.getObjectByName(nom)!
      return { Panneau: piece('Panneau'), Cadre: piece('Cadre'), Borne: piece('Borne') }
    } catch (erreur) {
      console.error('vitrines indisponibles', erreur)
      return null
    } finally {
      draco.dispose()
    }
  })()
  return modele
}

/** Où poser chaque pièce, pour une vitrine : le panneau contre le lambris, le cadre sur le panneau, la borne devant. */
function poses(v: Vitrine): Record<keyof Pieces, THREE.Vector3> {
  const dos = v.z + PANNEAU.recul
  return {
    Panneau: new THREE.Vector3(v.x, v.y, dos),
    Cadre: new THREE.Vector3(v.x + TOILE.u, v.y + TOILE.v, dos + PANNEAU.epaisseur),
    Borne: new THREE.Vector3(v.borne.x, v.y, v.borne.z),
  }
}

export function VitrinesLayer() {
  const [pieces, setPieces] = useState<Pieces | null>(null)
  useEffect(() => {
    let vivant = true
    void chargerModele().then((p) => vivant && setPieces(p))
    return () => {
      vivant = false
    }
  }, [])
  const vitrines = useVitrines()

  // La borne regardée, publiée pour `BorneOeuvre` — comme `EveilLayer` publie la toile.
  const visiteur = useGameStore((s) => s.visiteur)
  const rang = useMemo(() => (visiteur ? borneRegardee(visiteur) : null), [visiteur])
  const borne = (rang !== null && vitrines?.[rang]?.key) || null
  useEffect(() => {
    if (useGameStore.getState().borne !== borne) useGameStore.setState({ borne })
  }, [borne])

  return (
    <group name="vitrines">
      {pieces &&
        (Object.keys(pieces) as (keyof Pieces)[]).map((nom) => (
          <Instances key={nom} objet={pieces[nom]} positions={VITRINES.map((v) => poses(v)[nom])} />
        ))}
      {vitrines?.map((a, i) => VITRINES[i] && <Exposition key={a.key} oeuvre={a} vitrine={VITRINES[i]} active={a.key === borne} />)}
    </group>
  )
}

/** Chaque maillage d'une pièce, en un lot d'instances : une par vitrine. */
function Instances({ objet, positions }: { objet: THREE.Object3D; positions: THREE.Vector3[] }) {
  const maillages = useMemo(() => {
    const out: THREE.Mesh[] = []
    objet.traverse((o) => o instanceof THREE.Mesh && out.push(o))
    return out
  }, [objet])
  return (
    <>
      {maillages.map((m) => (
        <Lot key={m.uuid} maillage={m} racine={objet} positions={positions} />
      ))}
    </>
  )
}

function Lot({ maillage, racine, positions }: { maillage: THREE.Mesh; racine: THREE.Object3D; positions: THREE.Vector3[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    // Le maillage relatif à la racine de sa pièce, puis déplacé au pied de chaque vitrine.
    const local = new THREE.Matrix4().copy(racine.matrixWorld).invert().multiply(maillage.matrixWorld)
    const m = new THREE.Matrix4()
    positions.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z).multiply(local)))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [maillage, racine, positions])
  // Le matériau en prop, jamais dans `args` (#35).
  return <instancedMesh key={positions.length} ref={ref} args={[maillage.geometry, undefined, positions.length]} material={maillage.material} />
}

/** Le texte, l'image, le cartel et l'écran d'une vitrine. */
function Exposition({ oeuvre, vitrine: v, active }: { oeuvre: Artwork; vitrine: Vitrine; active: boolean }) {
  const md = useReadme(oeuvre.key)
  const [col1, col2] = useMemo(() => {
    const texte = md ? chapeau(readmeEnBlocs(md), 1800) : oeuvre.description ?? ''
    return enColonnes(texte, COLONNES.parLigne, COLONNES.lignes)
  }, [md, oeuvre.description])
  const face = v.z + PANNEAU.recul + PANNEAU.epaisseur + 0.002
  const at = (u: number, h: number, dz = 0): [number, number, number] => [v.x + u, v.y + h, face + dz]
  const annee = new Date(oeuvre.createdAt).getFullYear()
  const langues = partsDeLangages(oeuvre.languages).slice(0, 3).map((p) => p.langage).join(' · ')
  const texte = { font: CARTEL_FONT, color: CREME, anchorX: 'left' as const, anchorY: 'top' as const }
  return (
    <>
      <Toile oeuvre={oeuvre} position={[v.toile.x, v.toile.y, v.toile.z]} />
      {/* Le filet du titre. */}
      <mesh position={at(0.05, 2.86)}>
        <boxGeometry args={[3.7, 0.006, 0.002]} />
        <meshStandardMaterial color={CREME} roughness={0.7} />
      </mesh>
      {/* Le cartel, sous le cadre : une plaque crème. */}
      <mesh position={at(0.52, 1.28, 0.003)}>
        <boxGeometry args={[0.5, 0.2, 0.006]} />
        <meshStandardMaterial color="#efe6d2" roughness={0.85} />
      </mesh>
      <Suspense fallback={null}>
        <Text {...texte} position={at(-1.8, 3.33)} fontSize={0.07} letterSpacing={0.2}>
          {`${oeuvre.owner.toUpperCase()}  ·  N° ${v.rang + 1}`}
        </Text>
        <Text {...texte} font={TITRE_FONT} position={at(-1.82, 3.2)} fontSize={0.3} maxWidth={3.7} whiteSpace="nowrap">
          {oeuvre.name}
        </Text>
        {[col1, col2].map((c, i) => (
          <Text
            key={i}
            {...texte}
            position={at(COLONNES.u + i * (COLONNES.largeur + COLONNES.gouttiere), COLONNES.haut)}
            fontSize={COLONNES.corps}
            lineHeight={COLONNES.interligne}
            maxWidth={COLONNES.largeur}
          >
            {c}
          </Text>
        ))}
        <Text {...texte} color={ENCRE} font={TITRE_FONT} position={at(0.3, 1.36, 0.007)} fontSize={0.04} maxWidth={0.44}>
          {oeuvre.name}
        </Text>
        <Text {...texte} color={ENCRE} position={at(0.3, 1.3, 0.007)} fontSize={0.026} lineHeight={1.35} maxWidth={0.44}>
          {`${langues || oeuvre.language || ''}\n★ ${oeuvre.stars.toLocaleString('fr-FR')}  ·  depuis ${annee}`}
        </Text>
      </Suspense>
      <Ecran oeuvre={oeuvre} vitrine={v} active={active} />
    </>
  )
}

/** L'image OpenGraph du dépôt, derrière la vue du cadre doré. */
function Toile({ oeuvre, position }: { oeuvre: Artwork; position: [number, number, number] }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let vivant = true
    let t: THREE.Texture | null = null
    new THREE.TextureLoader().loadAsync(nearTextureUrl(oeuvre.key)).then(
      (charge) => {
        charge.colorSpace = THREE.SRGBColorSpace
        charge.anisotropy = 4
        t = charge
        if (vivant) setTexture(charge)
        else charge.dispose()
      },
      () => undefined,
    )
    return () => {
      vivant = false
      t?.dispose()
    }
  }, [oeuvre.key])
  return (
    <mesh position={position}>
      <planeGeometry args={[TOILE.largeur, TOILE.hauteur]} />
      {/* Une clé : passer d'un aplat à une carte exige une matière recompilée, pas une prop de plus. */}
      {texture ? <meshStandardMaterial key="image" map={texture} roughness={0.55} /> : <meshStandardMaterial key="attente" color="#3a1416" roughness={0.9} />}
    </mesh>
  )
}

/** Un texte coupé en lignes d'au plus `largeur` pixels, sur le canevas. */
function lignes(ctx: CanvasRenderingContext2D, texte: string, largeur: number, max: number): string[] {
  const out: string[] = []
  let l = ''
  for (const mot of texte.split(/\s+/)) {
    if (l && ctx.measureText(`${l} ${mot}`).width > largeur) {
      out.push(l)
      l = mot
      if (out.length === max) break
    } else l = l ? `${l} ${mot}` : mot
  }
  if (out.length < max && l) out.push(l)
  else if (out.length === max) out[max - 1] = `${out[max - 1].replace(/[,.;:]?$/, '')}…`
  return out
}

/** L'écran de la borne : un canevas qui s'éclaire, et l'invite qui palpite en bas. */
function Ecran({ oeuvre, vitrine: v, active }: { oeuvre: Artwork; vitrine: Vitrine; active: boolean }) {
  const [ecran, invite] = useMemo(() => {
    const dessiner = (w: number, h: number, peindre: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (ctx === null) return null // jsdom
      peindre(ctx)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 4
      return t
    }
    const fond = dessiner(W, H, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, W, H)
      g.addColorStop(0, '#4a1519')
      g.addColorStop(1, '#1e0a0c')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#e0b060'
      ctx.font = '600 19px system-ui, sans-serif'
      ctx.fillText(`N° ${v.rang + 1}  ·  ${oeuvre.owner.toUpperCase()}`, 32, 46)
      ctx.fillStyle = CREME
      ctx.font = '66px Georgia, serif'
      ctx.fillText(oeuvre.name, 30, 118, W - 60)
      ctx.fillRect(32, 138, W - 64, 2)
      ctx.fillStyle = '#e6d6b6'
      ctx.font = '23px system-ui, sans-serif'
      lignes(ctx, oeuvre.description ?? '', W - 64, 3).forEach((l, i) => ctx.fillText(l, 32, 178 + i * 31))
      // La barre des langages, comme sur la carte de l'œuvre.
      let x = 32
      for (const { langage, part } of partsDeLangages(oeuvre.languages)) {
        ctx.fillStyle = couleurDeLangage(langage)
        ctx.fillRect(x, 282, (W - 64) * part, 8)
        x += (W - 64) * part
      }
      ctx.fillStyle = '#c9b89a'
      ctx.font = '22px system-ui, sans-serif'
      ctx.fillText(`★ ${oeuvre.stars.toLocaleString('fr-FR')}   ⑂ ${oeuvre.forks.toLocaleString('fr-FR')}   ·   README`, 32, 322)
    })
    const bandeau = dessiner(W, BANDEAU, (ctx) => {
      ctx.fillStyle = '#ffd98a'
      ctx.font = '600 24px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('APPROCHEZ-VOUS  ·  APPUYEZ SUR E', W / 2, BANDEAU * 0.64)
    })
    return [fond, bandeau]
  }, [oeuvre, v.rang])
  useEffect(() => () => {
    ecran?.dispose()
    invite?.dispose()
  }, [ecran, invite])

  const nuit = 1 - useGameStore((s) => s.ciel.jour)
  const lueur = useRef<THREE.MeshBasicMaterial>(null)
  const palpite = useRef<THREE.MeshBasicMaterial>(null)
  // L'éclat de l'écran suit le ciel ; l'invite palpite tant qu'on ne consulte pas la borne.
  useFrame(({ clock }) => {
    const e = lueur.current
    if (e) e.color.setScalar((active ? 1.25 : 1.0) + 0.35 * nuit)
    const p = palpite.current
    if (p) p.opacity = active ? 0 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.2))
  })
  if (ecran === null || invite === null) return null
  // Le plan de l'écran : couché sur le dessus incliné de la borne, 4 mm au-dessus.
  const [ny, nz] = [Math.cos(ECRAN.inclinaison), Math.sin(ECRAN.inclinaison)]
  const base = new THREE.Vector3(v.borne.x, v.y + ECRAN.y + ny * 0.004, v.borne.z + ECRAN.z + nz * 0.004)
  const rot: [number, number, number] = [-(Math.PI / 2 - ECRAN.inclinaison), 0, 0]
  const haut = (ECRAN.hauteur * BANDEAU) / H
  return (
    <group position={base} rotation={rot}>
      <mesh>
        <planeGeometry args={[ECRAN.largeur, ECRAN.hauteur]} />
        <meshBasicMaterial ref={lueur} map={ecran} toneMapped={false} />
      </mesh>
      <mesh position={[0, -(ECRAN.hauteur - haut) / 2, 0.001]}>
        <planeGeometry args={[ECRAN.largeur, haut]} />
        <meshBasicMaterial ref={palpite} map={invite} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
}
